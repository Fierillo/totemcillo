/** Injectable measurement (happy-dom has no layout). */
export interface Measurer {
  /** Fits without overflowing or clipping [data-clip] lines. */
  fits(el: HTMLElement): boolean;
  /** Box only (horizontal clipping with … allowed); defaults to fits. */
  fitsBox?(el: HTMLElement): boolean;
  setSize(el: HTMLElement, px: number): void;
}

const boxFits = (el: HTMLElement) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;

export const domMeasurer: Measurer = {
  fitsBox: boxFits,
  fits: (el) => boxFits(el) && [...el.querySelectorAll<HTMLElement>('[data-clip]')].every((c) => c.scrollWidth <= c.clientWidth + 1),
  setSize: (el, px) => { el.style.fontSize = `${px}px`; },
};

export interface FitRange { max: number; min: number }

/** Largest integer in [lo, hi] satisfying ok (monotonic), or null. */
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

/** Shrinks the font until the text fits; if it still doesn't at the minimum, truncates by words with '…'. */
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

/** Fixed list font: drops items from the end until the rest fits vertically (keeps at least one; long lines end in …). */
export function fitList(ul: HTMLElement, size: number, m: Measurer = domMeasurer) {
  m.setSize(ul, size);
  const boxOk = (el: HTMLElement) => (m.fitsBox ?? m.fits)(el);
  let removed = 0;
  while (!boxOk(ul) && ul.children.length > 1) { ul.lastElementChild!.remove(); removed++; }
  return { size, removed };
}
/** Fits [data-fit="text|list"]: data-max in vh, data-maxw (optional) in vw, data-min in px (text only; lists use the max as a fixed size). */
export function fitRegions(root: HTMLElement, m: Measurer = domMeasurer, vh = window.innerHeight, vw = window.innerWidth) {
  const qr = root.querySelector<HTMLElement>('.qr');
  const area = qr?.getBoundingClientRect();
  const gap = parseFloat(getComputedStyle(root).fontSize) || 16;
  const measurer: Measurer = area?.width ? { ...m, setSize(el, px) {
    m.setSize(el, px);
    if (el.dataset.fit === 'list') {
      for (const row of el.children) {
        const item = row as HTMLElement;
        item.style.width = '';
        // Use layout coordinates, not temporary new-post/zap animation transforms.
        const origin = item.offsetParent?.getBoundingClientRect();
        const top = (origin?.top ?? 0) + item.offsetTop;
        const left = (origin?.left ?? 0) + item.offsetLeft;
        if (top + item.offsetHeight > area.top - gap && top < area.bottom + gap)
          item.style.width = `${Math.max(0, area.left - gap - left)}px`;
      }
    } else {
      el.style.setProperty('--qr-flow-width', '0px');
      el.style.setProperty('--qr-flow-height', '0px');
      // Wrapping can change a centered paragraph's height and position.
      for (let i = 0; i < 3; i++) {
        const r = el.getBoundingClientRect();
        const overlaps = r.bottom > area.top - gap && r.top < area.bottom + gap;
        el.style.setProperty('--qr-flow-width', `${overlaps ? Math.max(0, r.right - area.left + gap) : 0}px`);
        el.style.setProperty('--qr-flow-height', `${r.height}px`);
        el.style.setProperty('--qr-flow-top', `${Math.max(0, area.top - gap - r.top)}px`);
      }
    }
  } } : m;
  root.querySelectorAll<HTMLElement>('[data-fit]').forEach((el) => {
    let max = (Number(el.dataset.max) * vh) / 100;
    if (el.dataset.maxw) max = Math.min(max, (Number(el.dataset.maxw) * vw) / 100);
    if (el.dataset.fit === 'list') fitList(el, Math.floor(max), measurer);
    else fitText(el, { max, min: Number(el.dataset.min ?? 12) }, measurer);
  });
}
