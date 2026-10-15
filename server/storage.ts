/** Minimal storage the API needs (Upstash in production, memory in tests/dev). */
export interface Storage {
  get<T>(key: string): Promise<T | null>;
  /** Stores a value; with `ttlSec` it expires after that many seconds. */
  set(key: string, value: unknown, ttlSec?: number): Promise<void>;
  /** Atomically replaces a JSON object if its version matches (missing version = 0; null expects an absent key). */
  compareAndSet(key: string, version: number | null, value: unknown): Promise<boolean>;
  /** Increments a counter that expires `ttlSec` after the first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
}

export function memoryStorage(now: () => number = Date.now): Storage {
  const data = new Map<string, string>();
  const expires = new Map<string, number>();
  const counters = new Map<string, { n: number; until: number }>();
  return {
    async get<T>(k: string) {
      const e = expires.get(k);
      if (e !== undefined && now() >= e) { data.delete(k); expires.delete(k); }
      const v = data.get(k);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    async set(k, v, ttlSec) {
      data.set(k, JSON.stringify(v));
      if (ttlSec) expires.set(k, now() + ttlSec * 1000); else expires.delete(k);
    },
    async compareAndSet(k, version, value) {
      const raw = data.get(k);
      const current = raw === undefined ? null : (JSON.parse(raw).version ?? 0);
      if (current !== version) return false;
      data.set(k, JSON.stringify(value));
      expires.delete(k);
      return true;
    },
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
    async set(k, v, ttlSec) { const r = await client; await (ttlSec ? r.set(k, v, { ex: ttlSec }) : r.set(k, v)); },
    async compareAndSet(k, version, value) {
      const result = await (await client).eval(`
        local raw = redis.call('GET', KEYS[1])
        local version = -1
        if raw then version = cjson.decode(raw).version or 0 end
        if version ~= tonumber(ARGV[1]) then return 0 end
        redis.call('SET', KEYS[1], ARGV[2])
        return 1
      `, [k], [version ?? -1, JSON.stringify(value)]);
      return result === 1;
    },
    async incr(k, ttlSec) {
      const r = await client;
      const n = await r.incr(k);
      if (n === 1) await r.expire(k, ttlSec);
      return n;
    },
  };
}
