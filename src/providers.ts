import { esc } from './util';

export interface ProvidersOptions {
  list: string[];
  /** Saves the full list (PUT /api/settings); returns the stored list or throws with the server error. */
  save: (list: string[]) => Promise<string[]>;
}

/** Admin card: LNURL domains whose zaps count (add / remove). */
export function renderProviders(root: HTMLElement, o: ProvidersOptions): void {
  let list = [...o.list];
  let error = '';
  const draw = () => {
    root.innerHTML = `<h2>Proveedores de zaps</h2>
      <p class="muted prov-help">Sólo cuentan los zaps firmados por estos dominios (o sus subdominios).</p>
      ${list.length ? `<ul class="prov-list">${list.map((d) => `<li class="prov-item" data-domain="${esc(d)}"><span class="prov-name">${esc(d)}</span><button type="button" class="prov-del" aria-label="Quitar ${esc(d)}">Quitar</button></li>`).join('')}</ul>`
        : '<p class="muted">Lista vacía: no cuenta ningún zap.</p>'}
      <form class="prov-add"><input name="prov-new" placeholder="ej. getalby.com" autocomplete="off" required /><button type="submit">Agregar</button></form>
      <p class="err prov-err"${error ? '' : ' hidden'}>${esc(error)}</p>`;
    root.querySelector('form.prov-add')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = (root.querySelector('input[name="prov-new"]') as HTMLInputElement).value.trim().toLowerCase();
      if (d) void commit([...list, d]);
    });
  };
  const commit = async (next: string[]) => {
    try { list = await o.save(next); error = ''; } catch (e) { error = (e as Error).message || 'error'; }
    draw();
  };
  root.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button.prov-del');
    const d = btn?.closest('li')?.getAttribute('data-domain');
    if (d) void commit(list.filter((x) => x !== d));
  });
  draw();
}
