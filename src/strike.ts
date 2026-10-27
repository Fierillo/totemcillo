/** Leader: the channel grows from the top to the post in this time; then the return stroke flashes. */
export const LEADER_MS = 250;
/** Total life of a strike: leader, return stroke, one flicker and fade (CSS keyframes use the same length). */
export const STRIKE_MS = 1080;
/** Life of the "+N sats" label left at the impact point (it outlives the bolt so it can be read). */
export const GAIN_MS = 2400;

type Pt = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;
const d = (pts: Pt[]) => `M${pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' L')}`;

/** Midpoint displacement: each level splits every segment and nudges the midpoint sideways, by half as much each time. */
function jagged(a: Pt, b: Pt, rnd: () => number, levels: number): Pt[] {
  let pts: Pt[] = [a, b];
  let spread = Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.25;
  for (let l = 0; l < levels; l++, spread /= 2) {
    pts = pts.flatMap((p, i) => {
      const q = pts[i + 1];
      return q ? [p, [(p[0] + q[0]) / 2 + (rnd() - 0.5) * spread, (p[1] + q[1]) / 2] as Pt] : [p];
    });
  }
  return pts;
}

/**
 * Real-looking lightning: a jagged streak that grows from the top of the viewport onto the target's top edge,
 * plus one or two short branches that sprout when the leader passes their fork. A fresh shape every time (Math.random); removes itself after `ms`.
 */
export function strike(target: Element, rnd = Math.random, ms = STRIKE_MS, gain?: string, center = false): SVGSVGElement | null {
  if (target.closest('[hidden]')) return null;
  const doc = target.ownerDocument;
  // Layout viewport (where position:fixed and getBoundingClientRect live); innerWidth/innerHeight follow a zoomed-out phone and would scale the bolt off target.
  const de = doc.documentElement, w = de.clientWidth || doc.defaultView!.innerWidth, h = de.clientHeight || doc.defaultView!.innerHeight;
  const box = target.getBoundingClientRect();
  // Totem: a random spot on the top edge; phone (`center`): the middle of the message box.
  const end: Pt = center ? [box.left + box.width / 2, box.top + box.height / 2] : [box.left + box.width * (0.2 + 0.6 * rnd()), box.top];
  const start: Pt = [Math.min(w, Math.max(0, end[0] + (rnd() - 0.5) * 0.4 * w)), 0];
  const main = jagged(start, end, rnd, 5);
  const branches = Array.from({ length: rnd() < 0.5 ? 1 : 2 }, () => {
    const fork = Math.floor((0.2 + 0.5 * rnd()) * main.length);
    const from = main[fork];
    const len = (end[1] - start[1]) * (0.15 + 0.15 * rnd());
    const delay = Math.round((LEADER_MS * fork) / (main.length - 1)); // the main points are evenly spaced top→bottom
    return `<path class="branch" pathLength="1" style="animation-delay:${delay}ms" d="${d(jagged(from, [from[0] + (rnd() - 0.5) * len, from[1] + len], rnd, 3))}"/>`;
  }).join('');
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'strike');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  Object.assign(svg.style, { width: `${w}px`, height: `${h}px` }); // 1 unit = 1 CSS px, never rescaled
  svg.style.setProperty('--leader', `${LEADER_MS}ms`);
  svg.innerHTML = `<path class="glow" pathLength="1" d="${d(main)}"/>${branches}<path class="core" pathLength="1" d="${d(main)}"/>`
    + `<circle class="impact" cx="${r1(end[0])}" cy="${r1(end[1])}" r="40"/>`;
  doc.body.append(svg);
  setTimeout(() => svg.remove(), ms);
  if (gain) {
    const label = doc.createElement('div');
    label.className = 'strike-gain';
    label.textContent = gain;
    Object.assign(label.style, { left: `${r1(end[0])}px`, top: `${r1(end[1])}px`, animationDelay: `${LEADER_MS}ms` });
    doc.body.append(label);
    setTimeout(() => label.remove(), GAIN_MS);
  }
  return svg;
}
