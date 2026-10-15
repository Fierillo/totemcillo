/** Minimal storage the API needs (Upstash in production, memory in tests/dev). */
export interface Storage {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  /** Increments a counter that expires `ttlSec` after the first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
}

export function memoryStorage(now: () => number = Date.now): Storage {
  const data = new Map<string, string>();
  const counters = new Map<string, { n: number; until: number }>();
  return {
    async get<T>(k: string) { const v = data.get(k); return v === undefined ? null : (JSON.parse(v) as T); },
    async set(k, v) { data.set(k, JSON.stringify(v)); },
    async incr(k, ttlSec) {
      const c = counters.get(k);
      if (!c || now() >= c.until) { counters.set(k, { n: 1, until: now() + ttlSec * 1000 }); return 1; }
      return ++c.n;
    },
  };
}

/** Upstash Redis (REST). Imported lazily so tests don't load it. */
export function upstashStorage(url: string, token: string): Storage {
  const client = import('@upstash/redis').then(({ Redis }) => new Redis({ url, token }));
  return {
    async get<T>(k: string) { return (await (await client).get<T>(k)) ?? null; },
    async set(k, v) { await (await client).set(k, v); },
    async incr(k, ttlSec) {
      const r = await client;
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, ttlSec);
      return n;
    },
  };
}
