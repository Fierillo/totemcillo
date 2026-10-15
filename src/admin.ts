import './admin.css';
import { LIMITS, SCENES, DEFAULT_SCENE_MS, type ModAction, type Settings } from '../server/settings';
import { SimplePool } from 'nostr-tools/pool';
import { loadConfig, postCutoff } from './config';
import { ZapStore } from './nostr/store';
import { startNostr, type PoolLike } from './nostr/pool';
import { installAvatarFallback, profiles } from './nostr/profiles';
import { moderationOf } from './moderation-lists';
import { renderModeration } from './moderation';

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
      videoClipSeconds: Number((root.querySelector('[name="videoClipSeconds"]') as HTMLInputElement).value) }) });
    say(r.ok ? 'Guardado' : `Error: ${(await r.json().catch(() => ({}))).error || r.status}`);
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
/** Moderación: los mismos posts que ve el tótem (relays, del lado del cliente) con Eliminar / Banear. */
async function startModeration(el: HTMLElement, s: Settings) {
  if (!modStore) {
    const cfg = await loadConfig();
    const cutoff = postCutoff(cfg);
    modStore = new ZapStore(undefined, { postMaxChars: cfg.postMaxChars, cutoff });
    const pool = new SimplePool() as unknown as PoolLike;
    profiles.configure({ query: (authors) => pool.querySync(cfg.relays, { kinds: [0], authors }, { maxWait: 4000 }), storage: window.localStorage });
    installAvatarFallback(document);
    startNostr(cfg, modStore, pool, undefined, undefined, cutoff);
  }
  const store = modStore;
  store.setModeration(moderationOf(s));
  renderModeration(el, {
    store,
    act: async (action: ModAction, id: string) => {
      const r = await api('/api/moderation', { method: 'POST', body: JSON.stringify({ action, id }) });
      if (!r.ok) { alert(`Error: ${(await r.json().catch(() => ({}))).error || r.status}`); return false; }
      store.setModeration(moderationOf(await r.json()));
      return true;
    },
  });
}

const s = await api('/api/session');
if (s.ok && (await s.json()).authed) await panel();
else loginForm();
