import './admin.css';
import { LIMITS, SCENES, DEFAULT_SCENE_MS, type ModAction, type Settings } from '../server/settings';
import { loadConfig, postCutoff } from './config';
import { ZapStore, type Moderation } from './nostr/store';
import { createPool, followCutoff, startNostr } from './nostr/pool';
import { installAvatarFallback, profiles } from './nostr/profiles';
import { moderationOf } from './moderation-lists';
import { renderModeration } from './moderation';
import { renderProviders } from './providers';
import { DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../server/settings';
import { fromArInput, toArInput } from './startline';

const root = document.getElementById('admin')!;
const api = (path: string, init?: RequestInit) => fetch(path, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });

const loginForm = () => {
  root.innerHTML = `<section class="panel"><h1>Admin · Totemcillo</h1>
    <form id="login"><label>Clave <input type="password" name="password" autocomplete="current-password" required /></label>
    <button type="submit">Entrar</button><p class="err" hidden></p></form></section>`;
  const form = root.querySelector('#login')!;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = new FormData(form as HTMLFormElement).get('password');
    const r = await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    const err = root.querySelector('.err') as HTMLElement;
    if (!r.ok) { err.hidden = false; err.textContent = (await r.json().catch(() => ({}))).error || 'clave incorrecta'; return; }
    await panel();
  });
};

async function panel() {
  const s = (await (await api('/api/settings')).json()) as Settings;
  const durs = { ...DEFAULT_SCENE_MS, ...s.sceneDurations };
  root.innerHTML = `<section class="panel"><header><h1>Admin · Totemcillo</h1><button type="button" class="logout">Salir</button></header>
    <nav class="tabs" role="tablist"><button type="button" role="tab" data-tab="config" aria-selected="true">Config</button><button type="button" role="tab" data-tab="mod" aria-selected="false">Mensajes</button></nav>
    <div class="cards" data-pane="config">
    <section class="card card-anuncio"><label>Anuncio <textarea name="announcement" maxlength="${LIMITS.maxAnnouncement}" rows="4">${s.announcement.replace(/</g, '&lt;')}</textarea>
    <small>${s.announcement.length}/${LIMITS.maxAnnouncement}</small></label></section>
    <section class="card card-dur"><fieldset><legend>Duración de cada escena (segundos)</legend>
      ${SCENES.map((n) => `<label>${n} <input type="number" name="dur-${n}" min="${LIMITS.minMs / 1000}" max="${LIMITS.maxMs / 1000}" step="1" value="${Math.round((durs[n] ?? 21000) / 1000)}" /></label>`).join('')}
    </fieldset></section>
    <section class="card card-video"><label>Video: una de cada N vueltas <input type="number" name="videoEveryCycles" min="${LIMITS.minEveryCycles}" max="${LIMITS.maxEveryCycles}" step="1" value="${s.videoEveryCycles ?? 2}" /></label>
    <label>Modo del video <select name="videoMode">${(['full', 'clip'] as const).map((m) => `<option value="${m}"${(s.videoMode ?? 'full') === m ? ' selected' : ''}>${m === 'full' ? 'Completo (desde 0)' : 'Clip al azar'}</option>`).join('')}</select></label>
    <label class="clip-len"${(s.videoMode ?? 'full') === 'clip' ? '' : ' hidden'}>Largo del clip (segundos) <input type="number" name="videoClipSeconds" min="${LIMITS.minClipSeconds}" max="${LIMITS.maxClipSeconds}" step="1" value="${s.videoClipSeconds ?? 21}" /></label></section>
    <section class="card card-start"><label>Inicio: posts y zaps desde (hora de Argentina) <input type="datetime-local" name="startLine" value="${toArInput(s.startLine ?? DEFAULT_START_LINE)}" required /></label>
    <small>Lo anterior no se muestra ni cuenta. Sin fecha de fin.</small></section>
    <section class="card card-prov"></section>
    <section class="card card-remote"><div class="row"><button type="button" class="save">Guardar</button>
      <button type="button" class="cmd-prev" title="Escena anterior">←</button>
      <button type="button" class="cmd-next" title="Escena siguiente">→</button></div>
    <p class="status"></p></section>
    </div>
    <section class="card card-mod" data-pane="mod"></section></section>`;
  const panelEl = root.querySelector('.panel') as HTMLElement;
  panelEl.dataset.tab = 'config';
  for (const t of root.querySelectorAll<HTMLButtonElement>('.tabs button')) t.addEventListener('click', () => {
    panelEl.dataset.tab = t.dataset.tab!;
    root.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
    window.scrollTo({ top: 0 });
  });
  renderProviders(root.querySelector('.card-prov') as HTMLElement, {
    list: s.zapProviders ?? DEFAULT_ZAP_PROVIDERS,
    save: async (zapProviders) => {
      const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ zapProviders }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || String(r.status));
      moderate(moderationOf(body));
      return body.zapProviders as string[];
    },
  });
  startModeration(root.querySelector('.card-mod') as HTMLElement, s);
  const modeSel = root.querySelector('[name="videoMode"]') as HTMLSelectElement;
  modeSel.addEventListener('change', () => { (root.querySelector('.clip-len') as HTMLElement).hidden = modeSel.value !== 'clip'; });
  const status = root.querySelector('.status')!;
  const say = (t: string) => { status.textContent = t; };
  root.querySelector('.logout')!.addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); loginForm(); });
  root.querySelector('.save')!.addEventListener('click', async () => {
    const announcement = (root.querySelector('textarea') as HTMLTextAreaElement).value;
    const sceneDurations: Record<string, number> = {};
    for (const n of SCENES) {
      const sec = Number((root.querySelector(`[name="dur-${n}"]`) as HTMLInputElement).value);
      sceneDurations[n] = Math.round(sec * 1000);
    }
    const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ announcement, sceneDurations, videoEveryCycles: Number((root.querySelector('[name="videoEveryCycles"]') as HTMLInputElement).value),
      videoMode: (root.querySelector('[name="videoMode"]') as HTMLSelectElement).value,
      videoClipSeconds: Number((root.querySelector('[name="videoClipSeconds"]') as HTMLInputElement).value),
      startLine: fromArInput((root.querySelector('[name="startLine"]') as HTMLInputElement).value) ?? undefined }) });
    const body = await r.json().catch(() => ({}));
    if (r.ok) moderate(moderationOf(body));
    say(r.ok ? 'Guardado' : `Error: ${body.error || r.status}`);
  });
  for (const [sel, command] of [['.cmd-next', 'next'], ['.cmd-prev', 'prev']] as const) {
    root.querySelector(sel)!.addEventListener('click', async () => {
      const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ command }) });
      say(r.ok ? `Comando ${command} enviado` : `Error: ${r.status}`);
    });
  }
  root.querySelector('textarea')!.addEventListener('input', (e) => {
    root.querySelector('small')!.textContent = `${(e.target as HTMLTextAreaElement).value.length}/${LIMITS.maxAnnouncement}`;
  });
}

let modStore: ZapStore | null = null;
let modFeed: ReturnType<typeof followCutoff> | null = null;
/** Applies lists and start line to the panel; if the line moves earlier, refetches from the relays. */
const moderate = (m: Moderation) => { modStore?.setModeration(m); modFeed?.setCutoff(postCutoff({ startLine: m.startLine ?? '' })); };
/** Moderation: the same posts the totem sees (relays, client-side) with Eliminar / Banear. */
async function startModeration(el: HTMLElement, s: Settings) {
  if (!modStore) {
    const cfg = await loadConfig();
    const cutoff = postCutoff(cfg);
    modStore = new ZapStore(undefined, { postMaxChars: cfg.postMaxChars, cutoff });
    const pool = createPool();
    profiles.configure({
      query: (authors) => pool.querySync(cfg.relays, { kinds: [0], authors }, { maxWait: 4000 }),
      // Live kind:0 for the authors on screen: newer profiles replace the cached ones and re-render.
      subscribe: (authors, onevent) => pool.subscribeMany(cfg.relays, { kinds: [0], authors }, { onevent }),
      storage: window.localStorage,
    });
    installAvatarFallback(document);
    const st = modStore;
    modFeed = followCutoff((c) => startNostr(cfg, st, pool, undefined, undefined, c), cutoff);
  }
  const store = modStore;
  moderate(moderationOf(s));
  renderModeration(el, {
    store,
    act: async (action: ModAction, id: string) => {
      const r = await api('/api/moderation', { method: 'POST', body: JSON.stringify({ action, id }) });
      if (!r.ok) { alert(`Error: ${(await r.json().catch(() => ({}))).error || r.status}`); return false; }
      moderate(moderationOf(await r.json()));
      return true;
    },
  });
}

const s = await api('/api/session');
if (s.ok && (await s.json()).authed) await panel();
else loginForm();
