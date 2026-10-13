/** Medición inyectable (happy-dom no tiene layout). */
export interface Measurer {
  fits(el: HTMLElement): boolean;
  setSize(el: HTMLElement, px: number): void;
}

export const domMeasurer: Measurer = {
  fits: (el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1,
  setSize: (el, px) => { el.style.fontSize = `${px}px`; },
};

export interface FitRange { max: number; min: number }

/** Mayor entero en [lo, hi] que cumple ok (monótono), o null. */
function largest(lo: number, hi: number, ok: (n: number) => boolean): number | null {
  let best: number | null = null;
  lo = Math.ceil(lo);
  hi = Math.floor(hi);
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ok(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

const originals = new WeakMap<HTMLElement, string>();

/** Achica la fuente hasta que el texto entre; si en el mínimo no entra, trunca por palabras con '…'. */
export function fitText(el: HTMLElement, { max, min }: FitRange, m: Measurer = domMeasurer) {
  if (!originals.has(el)) originals.set(el, el.textContent ?? '');
  const full = originals.get(el)!;
  el.textContent = full;
  const size = largest(min, max, (s) => { m.setSize(el, s); return m.fits(el); });
  if (size !== null) {
    m.setSize(el, size);
    return { size, truncated: false };
  }
  m.setSize(el, Math.ceil(min));
  const words = full.split(/\s+/).filter(Boolean);
  const cut = (n: number) => { el.textContent = words.slice(0, n).join(' ') + '…'; };
  cut(largest(0, words.length - 1, (n) => { cut(n); return m.fits(el); }) ?? 0);
  return { size: Math.ceil(min), truncated: true };
}

/** Achica la fuente de una lista; si en el mínimo no entra, saca items del final (deja al menos uno). */
export function fitList(ul: HTMLElement, { max, min }: FitRange, m: Measurer = domMeasurer) {
  const size = largest(min, max, (s) => { m.setSize(ul, s); return m.fits(ul); });
  if (size !== null) {
    m.setSize(ul, size);
    return { size, removed: 0 };
  }
  m.setSize(ul, Math.ceil(min));
  let removed = 0;
  while (!m.fits(ul) && ul.children.length > 1) { ul.lastElementChild!.remove(); removed++; }
  return { size: Math.ceil(min), removed };
}
export const fitRegions = undefined as any;
