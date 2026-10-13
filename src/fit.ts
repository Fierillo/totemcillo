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

export const fitList = undefined as any;
export const fitRegions = undefined as any;
