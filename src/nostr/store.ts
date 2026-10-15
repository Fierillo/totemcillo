import type { Post, Zap } from './types';
import { truncateText } from '../text';
import { feedFor } from '../livefeed';

export interface PostStats { post?: Post; postId: string; msats: number; zaps: Zap[] }

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const isPost = (x: any): x is Post =>
  !!x && str(x.id, 64) && str(x.pubkey, 64) && typeof x.content === 'string' && num(x.created_at);
export const isZap = (x: any): x is Zap =>
  !!x && str(x.id, 64) && str(x.postId, 64) && num(x.msats) && x.msats > 0 && typeof x.comment === 'string' &&
  num(x.created_at) && (x.sender === undefined || str(x.sender, 64)) &&
  (x.domain === undefined || str(x.domain, 253));

export const MAX_COMMENT = 280;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const clipZap = (z: Zap): Zap => ({ ...z, comment: clip(z.comment, MAX_COMMENT) });

export interface StoreOptions { key?: string; maxPosts?: number; maxZaps?: number; postMaxChars?: number; cutoff?: number;
  /** Reloj en segundos unix (inyectable) y antigüedad máxima (s) para considerar un evento "en vivo". */
  clock?: () => number; liveWindowSec?: number;
  /** Proveedores LNURL permitidos (dominio o subdominio); sin lista cuentan todos. */
  zapProviders?: string[] }

/** Post o zap que llegó en vivo (no historial): las escenas visibles lo animan. */
/** Listas de moderación que publica el servidor. */
export interface Moderation { hiddenPosts: string[]; bannedPubkeys: string[]; zapProviders?: string[] }

/** Dominio exacto o subdominio de alguno de la lista. */
export const providerAllowed = (domain: string | undefined, list: string[]) =>
  !!domain && list.some((d) => domain === d || domain.endsWith(`.${d}`));

export interface LiveEvent { type: 'post' | 'zap'; postId: string }

function trimOldest<T extends { id: string; created_at: number }>(m: Map<string, T>, max: number) {
  while (m.size > max) {
    let old: T | undefined;
    for (const v of m.values()) if (!old || v.created_at < old.created_at) old = v;
    m.delete(old!.id);
  }
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Store en memoria que agrega sats por post y persiste (localStorage) con debounce. */
export class ZapStore {
  posts = new Map<string, Post>();
  zaps = new Map<string, Zap>();
  private listeners = new Set<() => void>();
  private liveListeners = new Set<(e: LiveEvent) => void>();
  private clock: () => number;
  private liveWindowSec: number;
  /** Moderación (desde el servidor): se filtra al leer, así también aplica a lo que llegue después. */
  private hidden = new Set<string>();
  private banned = new Set<string>();
  private providers?: string[];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private key: string;
  private maxPosts: number;
  private maxZaps: number;
  private postMaxChars: number;
  /** Corte fijo (unix s): se ignoran posts anteriores. No se mueve con el tiempo. */
  private cutoff?: number;

  constructor(private storage?: KV, opts: StoreOptions = {}) {
    this.key = opts.key ?? 'totemcillo:v1';
    this.maxPosts = opts.maxPosts ?? 500;
    this.maxZaps = opts.maxZaps ?? 5000;
    this.postMaxChars = opts.postMaxChars ?? 210;
    this.cutoff = opts.cutoff;
    this.clock = opts.clock ?? (() => Math.floor(Date.now() / 1000));
    this.liveWindowSec = opts.liveWindowSec ?? 120;
    this.providers = opts.zapProviders;
    this.load();
    feedFor(this); // reparte eventos en vivo desde el arranque (indicador/pendientes)
  }

  addPost(p: Post) {
    if (this.posts.has(p.id) || !this.isFresh(p)) return;
    this.posts.set(p.id, this.clipPost(p));
    trimOldest(this.posts, this.maxPosts);
    if (!this.posts.has(p.id)) return;
    this.emitLive({ type: 'post', postId: p.id }, p.created_at);
    this.changed();
  }

  addZap(z: Zap) {
    if (this.zaps.has(z.id)) return;
    this.zaps.set(z.id, clipZap(z));
    trimOldest(this.zaps, this.maxZaps);
    if (!this.zaps.has(z.id)) return;
    if (this.zapVisible(z)) this.emitLive({ type: 'zap', postId: z.postId }, z.created_at);
    this.changed();
  }

  /** Avisa eventos recientes (lo cargado de localStorage no pasa por acá). Se emite antes de redibujar. */
  onLive(fn: (e: LiveEvent) => void): () => void {
    this.liveListeners.add(fn);
    return () => { this.liveListeners.delete(fn); };
  }

  private emitLive(e: LiveEvent, createdAt: number) {
    if (createdAt >= this.clock() - this.liveWindowSec) this.liveListeners.forEach((f) => f(e));
  }

  private dropOrphanZaps() {
    for (const z of [...this.zaps.values()]) if (!this.posts.has(z.postId)) this.zaps.delete(z.id);
  }

  private isFresh(p: Post) {
    return this.cutoff === undefined || p.created_at >= this.cutoff;
  }

  private clipPost(p: Post): Post {
    return { ...p, content: truncateText(p.content, this.postMaxChars) };
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  save() {
    this.storage?.setItem(this.key, JSON.stringify({ posts: [...this.posts.values()], zaps: [...this.zaps.values()] }));
  }

  private changed() {
    this.listeners.forEach((f) => f());
    if (!this.storage || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  private load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      arr(d?.posts).filter(isPost).filter((p) => this.isFresh(p)).forEach((p) => this.posts.set(p.id, this.clipPost(p)));
      arr(d?.zaps).filter(isZap).forEach((z) => this.zaps.set(z.id, clipZap(z)));
      trimOldest(this.posts, this.maxPosts);
      if (this.cutoff !== undefined) this.dropOrphanZaps();
      trimOldest(this.zaps, this.maxZaps);
    } catch (e) {
      console.warn('Historial corrupto, lo ignoro', e);
    }
  }

  /** Posts ocultos y autores baneados (desaparecen con sus zaps; los zaps que envían no cuentan). */
  setModeration(m: Moderation) {
    const h = new Set(m.hiddenPosts), b = new Set(m.bannedPubkeys);
    const same = (a: Set<string>, c: Set<string>) => a.size === c.size && [...a].every((x) => c.has(x));
    const pv = m.zapProviders ?? this.providers;
    const sameP = pv === this.providers || (!!pv && !!this.providers && same(new Set(pv), new Set(this.providers)));
    if (same(h, this.hidden) && same(b, this.banned) && sameP) return;
    this.hidden = h; this.banned = b; this.providers = pv;
    this.listeners.forEach((f) => f());
  }

  get moderation(): Moderation { return { hiddenPosts: [...this.hidden], bannedPubkeys: [...this.banned], ...(this.providers ? { zapProviders: [...this.providers] } : {}) }; }

  private postVisible(id: string) {
    if (this.hidden.has(id)) return false;
    const p = this.posts.get(id);
    return !p || !this.banned.has(p.pubkey);
  }

  private zapVisible(z: Zap) {
    if (this.providers && !providerAllowed(z.domain, this.providers)) return false;
    return !(z.sender && this.banned.has(z.sender)) && this.postVisible(z.postId);
  }

  stats(since = 0): PostStats[] {
    const map = new Map<string, PostStats>();
    const entry = (id: string) => {
      let s = map.get(id);
      if (!s) map.set(id, (s = { postId: id, post: this.posts.get(id), msats: 0, zaps: [] }));
      return s;
    };
    this.posts.forEach((p) => { if (this.postVisible(p.id)) entry(p.id); });
    for (const z of this.zaps.values()) {
      if (z.created_at < since || !this.zapVisible(z)) continue;
      const s = entry(z.postId);
      s.msats += z.msats;
      s.zaps.push(z);
    }
    map.forEach((s) => s.zaps.sort((a, b) => b.created_at - a.created_at));
    return [...map.values()].sort((a, b) => b.msats - a.msats || (b.post?.created_at ?? 0) - (a.post?.created_at ?? 0));
  }

  top(n: number, since = 0) {
    return this.stats(since).filter((s) => s.msats > 0 && s.post).slice(0, n);
  }

  latestZaps(n: number): Zap[] {
    return [...this.zaps.values()].filter((z) => this.zapVisible(z)).sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }

  latestPosts(n: number): Post[] {
    return [...this.posts.values()].filter((p) => this.postVisible(p.id)).sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }
}
