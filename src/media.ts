import { esc } from './util';

/** An image shown with a post: a safe https URL and its optional description (NIP-92 alt). */
export interface PostImage { url: string; alt?: string }
export const MAX_IMAGES = 4;
const EXT = /\.(?:jpe?g|png|gif|webp)$/i;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const trail = (u: string) => u.replace(/[.,;:!?)\]]+$/, '');

/** The URL normalized when it is https without credentials and short; anything else (http, javascript:, data:, junk) is undefined. */
export function safeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 2048) return undefined;
  let u: URL;
  try { u = new URL(raw); } catch { return undefined; }
  return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined;
}
const isImage = (url: string) => EXT.test(new URL(url).pathname);
/** Content image URL (https, image extension) normalized, or undefined. */
const contentImage = (m: string) => { const u = safeImageUrl(trail(m)); return u && isImage(u) ? u : undefined; };

/** Images of a note: NIP-92 imeta tags (url + image mime or extension, alt) first, then image URLs in the text; deduped, at most MAX_IMAGES. */
export function postImages(content: string, tags: string[][] = []): PostImage[] {
  const out = new Map<string, PostImage>();
  for (const t of tags) {
    if (!Array.isArray(t) || t[0] !== 'imeta') continue;
    const f = new Map(t.slice(1).filter((s) => typeof s === 'string').map((s) => [s.split(' ', 1)[0], s.slice(s.indexOf(' ') + 1)]));
    const url = safeImageUrl(f.get('url'));
    if (url && (isImage(url) || /^image\//.test(f.get('m') ?? '')) && !out.has(url)) out.set(url, f.get('alt') ? { url, alt: f.get('alt')!.slice(0, 300) } : { url });
  }
  for (const [m] of content.matchAll(URL_RE)) { const url = contentImage(m); if (url && !out.has(url)) out.set(url, { url }); }
  return [...out.values()].slice(0, MAX_IMAGES);
}

/** The post's text without the image URLs it shows (other links stay). */
export const textWithoutImages = (content: string) =>
  content.replace(URL_RE, (m) => (contentImage(m) ? m.slice(trail(m).length) : m)).replace(/[ \t]{2,}/g, ' ').trim();

/** Stored images (validated again: storage is untrusted) plus the ones in the text, deduped. */
export function imagesOf(p: { content: string; images?: unknown }): PostImage[] {
  const stored = Array.isArray(p.images) ? p.images.flatMap((i) => { const url = safeImageUrl(i?.url); return url ? [{ url, ...(typeof i.alt === 'string' ? { alt: i.alt.slice(0, 300) } : {}) }] : []; }) : [];
  const seen = new Set(stored.map((i) => i.url));
  return [...stored, ...postImages(p.content).filter((i) => !seen.has(i.url))].slice(0, MAX_IMAGES);
}

/** Through the server proxy (/api/avatar img=1): the stand's IP never reaches the image host, and huge images arrive bounded and re-encoded. */
export const proxied = (url: string) => `/api/avatar?img=1&url=${encodeURIComponent(url)}`;

/** Escaped <img> list (lazy, no referrer, no inline handlers); '' without images. */
export function imagesHtml(images: PostImage[], cls: string, max = MAX_IMAGES): string {
  const ok = images.flatMap((i) => { const url = safeImageUrl(i.url); return url ? [{ url, alt: i.alt ?? '' }] : []; }).slice(0, max);
  return ok.length ? `<div class="post-media ${esc(cls)}">${ok.map((i) => `<img src="${esc(proxied(i.url))}" alt="${esc(i.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`).join('')}</div>` : '';
}

/** Hides post images that fail to load (one capture listener: error doesn't bubble). */
export function hideBrokenImages(doc: Document) {
  doc.addEventListener('error', (e) => { const t = e.target; if (t instanceof HTMLImageElement && t.closest('.post-media')) t.hidden = true; }, true);
}
