// Shared by server and totem: the same deterministic schedule on both sides.
import { DEFAULT_SCENE_MS, SCENES, SCHEDULE_DEFAULTS, type Action, type Settings } from './settings.js';

/** The minimum needed to compute the schedule. */
export type ScheduleInputs = Pick<Settings, 'sceneDurations' | 'videoEveryCycles' | 'videoMode' | 'videoClipSeconds' | 'videoDurationSec' | 'epoch'>;

export const ORDER: readonly string[] = [...SCENES, 'video'];
const VIDEO = ORDER.length - 1;

export interface Position { scene: string; index: number; cycle: number; sceneStartedAt: number; sceneEndsAt: number; videoOffset?: number }

interface Plan { durs: number[]; every: number; videoMs: number; clipRange: number }
function plan(s: ScheduleInputs): Plan {
  const d = { ...DEFAULT_SCENE_MS, ...s.sceneDurations };
  const every = s.videoEveryCycles ?? SCHEDULE_DEFAULTS.videoEveryCycles;
  const full = (s.videoDurationSec ?? SCHEDULE_DEFAULTS.videoDurationSec) * 1000;
  const clip = (s.videoClipSeconds ?? SCHEDULE_DEFAULTS.videoClipSeconds) * 1000;
  const isClip = (s.videoMode ?? SCHEDULE_DEFAULTS.videoMode) === 'clip' && clip < full;
  return { durs: SCENES.map((n) => d[n]), every, videoMs: isClip ? clip : full, clipRange: isClip ? (full - clip) / 1000 : 0 };
}
const base = (p: Plan) => p.durs.reduce((a, b) => a + b, 0);
const period = (p: Plan) => p.every * base(p) + p.videoMs;

/** Deterministic pseudo-random in [0,1) from a number (scene start). */
function seeded(n: number): number {
  let h = (Math.floor(n) ^ Math.floor(n / 2 ** 32)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 2 ** 32;
}

/** Schedule inputs with defaults applied (what the server sends to the totem). */
export const scheduleInputs = (s: ScheduleInputs) => ({
  epoch: s.epoch ?? 0,
  sceneDurations: s.sceneDurations ?? {},
  videoEveryCycles: s.videoEveryCycles ?? SCHEDULE_DEFAULTS.videoEveryCycles,
  videoMode: s.videoMode ?? SCHEDULE_DEFAULTS.videoMode,
  videoClipSeconds: s.videoClipSeconds ?? SCHEDULE_DEFAULTS.videoClipSeconds,
  videoDurationSec: s.videoDurationSec ?? SCHEDULE_DEFAULTS.videoDurationSec,
});

/** Start (ms from the beginning of the block) of the entry (cycle k of the block, index i). */
function offsetInBlock(p: Plan, k: number, i: number): number {
  let t = k * base(p) + (k > 0 ? p.videoMs : 0);
  for (let j = 0; j < i && j < VIDEO; j++) t += p.durs[j];
  return t;
}

/** Current scene at `now` for the schedule starting at settings.epoch. Stateless: same input → same output. */
export function positionAt(s: ScheduleInputs, now: number): Position {
  const p = plan(s);
  const epoch = s.epoch ?? 0;
  const P = period(p);
  const block = Math.floor((now - epoch) / P);
  let r = now - epoch - block * P;
  for (let k = 0; k < p.every; k++) {
    for (let i = 0; i < ORDER.length; i++) {
      if (i === VIDEO && k !== 0) continue;
      const d = i === VIDEO ? p.videoMs : p.durs[i];
      if (r < d) {
        const sceneStartedAt = now - r;
        const pos: Position = { scene: ORDER[i], index: i, cycle: block * p.every + k, sceneStartedAt, sceneEndsAt: sceneStartedAt + d };
        if (i === VIDEO) pos.videoOffset = Math.round(seeded(sceneStartedAt) * p.clipRange * 1000) / 1000;
        return pos;
      }
      r -= d;
    }
  }
  throw new Error('agenda inconsistente');
}

/** Admin arrows: moves epoch so the next/previous scene starts now. */
export function shiftSchedule<T extends ScheduleInputs>(s: T, now: number, action: Action): T {
  const epoch = s.epoch ?? 0;
  const cur = positionAt(s, now);
  const target = action === 'next' ? cur.sceneEndsAt : positionAt(s, cur.sceneStartedAt - 1).sceneStartedAt;
  return { ...s, epoch: now - (target - epoch) };
}

/** After a schedule change, re-anchors epoch so the current scene keeps its start. */
export function reanchor<T extends ScheduleInputs>(old: ScheduleInputs, next: T, now: number): T {
  const cur = positionAt(old, now);
  const p = plan(next);
  const k = cur.index === VIDEO ? 0 : ((cur.cycle % p.every) + p.every) % p.every;
  return { ...next, epoch: cur.sceneStartedAt - offsetInBlock(p, k, cur.index) };
}
