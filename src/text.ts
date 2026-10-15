const segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** Perceived characters (graphemes); falls back to code points. */
export function graphemes(s: string): string[] {
  return segmenter ? Array.from(segmenter.segment(s), (x) => x.segment) : Array.from(s);
}

/** Truncates to `max` perceived characters ('…' included), at a word boundary unless that loses more than half. */
export function truncateText(s: string, max: number): string {
  const g = graphemes(s);
  if (g.length <= max) return s;
  const head = g.slice(0, Math.max(0, max - 1));
  let cut = head.length;
  for (let i = head.length; i > 0; i--) {
    if (/\s/.test(g[i])) { cut = i; break; }
  }
  if (cut < head.length / 2) cut = head.length;
  return head.slice(0, cut).join('').trimEnd() + '…';
}
