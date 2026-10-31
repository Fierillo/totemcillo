/** Static markup of the mobile view (no state): skeletons, bolts, tab panels and the side scrubber. */
export const empty = (t: string) => `<p class="muted m-empty">${t}</p>`;
/** Pending text/images use skeleton blocks. */
export const skel = (cls: string) => `<span class="skel ${cls}" aria-hidden="true"></span>`;
export const SKEL_POST = `<article class="m-post m-skel-post" aria-hidden="true">${skel('m-skel-avatar')}${skel('m-skel-line')}${skel('m-skel-line m-skel-short')}</article>`;
export const SKEL_ROWS = `<div class="m-skel-rows" aria-hidden="true">${skel('m-skel-line')}${skel('m-skel-line m-skel-short')}${skel('m-skel-line')}</div>`;
export const NO_MARKS = { cls: '' };
/** Neon lightning bolt (zap totals): side button and Top rows. */
/** Side scrubber: one slot per feed post (newest on top), thumb at the current one; the bubble shows "i / N" while dragging. */
export const scrubber = (n: number, i: number, dragging: boolean) => n < 2 ? '' : `<div class="m-scrub${dragging ? ' is-dragging' : ''}" data-scrub role="slider" tabindex="0" aria-label="Ir a un post" aria-orientation="vertical" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${i + 1}">`
  + `<span class="m-scrub-thumb" style="top:${(i / (n - 1)) * 100}%"><span class="m-scrub-bubble">${i + 1} / ${n}</span></span></div>`;
export const panel = (id: string, title: string, body: string, selected: string) => `<section class="m-section" id="mobile-${id}" role="tabpanel" aria-labelledby="tab-${id}" ${selected === id ? '' : 'hidden'}><h2>${title}</h2>${body}</section>`;
/** Floating "anonymous message" button (opens the compose dialog). */
export const COMPOSE_FAB = `<button type="button" class="m-fab btn btn-violet" data-compose aria-haspopup="dialog"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/></svg><span class="m-fab-label">Mandá mensaje <br>anónimo</span></button>`;
