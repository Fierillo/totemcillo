/** A box's spot in a masonry layout: its column and its top (px from the list's content edge). */
export interface Spot { col: number; top: number }

/**
 * Stacks boxes of the given heights, in order, each in the lowest open column where it fits before its limit (the QR's
 * columns end above it), `gap` apart, so a short box leaves no hole. Lower columns it had to skip close for good: no later
 * box goes back up there, so every box starts at or below the previous one (reading order: left→right, top→bottom).
 * A box that fits no column is left out (null) and closes nothing: the next ones keep filling.
 */
export function masonry(heights: number[], limits: number[], gap: number): (Spot | null)[] {
  const bottoms = limits.map(() => 0), open = limits.map(() => true);
  const byBottom = limits.map((_, c) => c);
  return heights.map((h) => {
    byBottom.sort((a, b) => bottoms[a] - bottoms[b] || a - b);
    const col = byBottom.find((c) => open[c] && bottoms[c] + h <= limits[c]);
    if (col === undefined) return null;
    byBottom.filter((c) => bottoms[c] < bottoms[col]).forEach((c) => { open[c] = false; });
    const spot = { col, top: bottoms[col] };
    bottoms[col] += h + gap;
    return spot;
  });
}
