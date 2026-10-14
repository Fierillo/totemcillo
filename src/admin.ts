import './admin.css';
import { LIMITS, SCENES, DEFAULT_SCENE_MS, type Settings } from '../server/settings';

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
    <label>Anuncio <textarea name="announcement" maxlength="${LIMITS.maxAnnouncement}" rows="4">${s.announcement.replace(/</g, '&lt;')}</textarea>
    <small>${s.announcement.length}/${LIMITS.maxAnnouncement}</small></label>
    <fieldset><legend>Duración de cada escena (segundos)</legend>
      ${SCENES.map((n) => `<label>${n} <input type="number" name="dur-${n}" min="${LIMITS.minMs / 1000}" max="${LIMITS.maxMs / 1000}" step="1" value="${Math.round((durs[n] ?? 21000) / 1000)}" /></label>`).join('')}
    </fieldset>
    <label>Video: una de cada N vueltas <input type="number" name="videoEveryCycles" min="${LIMITS.minEveryCycles}" max="${LIMITS.maxEveryCycles}" step="1" value="${s.videoEveryCycles ?? 2}" /></label>
    <div class="row"><button type="button" class="save">Guardar</button>
      <button type="button" class="cmd-prev" title="Escena anterior">←</button>
      <button type="button" class="cmd-next" title="Escena siguiente">→</button></div>
    <p class="status"></p></section>`;
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
    const r = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ announcement, sceneDurations, videoEveryCycles: Number((root.querySelector('[name="videoEveryCycles"]') as HTMLInputElement).value) }) });
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

const s = await api('/api/session');
if (s.ok && (await s.json()).authed) await panel();
else loginForm();
