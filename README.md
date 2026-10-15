# totemcillo

**La Crypta**'s totem screen for **LABITCONF**: shows Nostr notes tagged `#lacrypta` and `#labitconf` live, along with the zaps they receive.

![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![nostr-tools](https://img.shields.io/badge/nostr--tools-8E44AD?logo=nostr&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)
![Upstash Redis](https://img.shields.io/badge/Upstash_Redis-00E9A3?logo=upstash&logoColor=black)
![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)

## Features

- **Rotating scenes**: recent posts, latest zaps, all-time Top 10, recent-hours Top 10, announcement and video.
- **Live animations** when a post or zap arrives (on mobile too).
- **Nostr profiles**: alias and avatar instead of npub.
- **QR** to the app on posts, tops and announcement.
- **Mobile view** on the same URL, with a ⚡ Zap button.
- **Admin** (`/admin`, password protected): announcement, durations, video mode and ← → arrows.
- Zaps validated per NIP-57; only posts and zaps since `startLine` count (editable in `/admin`; defaults in `shared/settings.ts`).

## Running

```bash
pnpm install
pnpm dev      # http://localhost:5173 and /admin
pnpm test     # vitest
pnpm build    # dist/
```

Dev listens on `0.0.0.0:5173`, so a phone on the same local network can open `http://<computer-LAN-IP>:5173`. Set `ADMIN_PASSWORD` when using a shared network: the local default is `admin`. Preview listens only on localhost. Neither mode pre-authorizes ngrok domains; do not expose these development servers to the internet.

Environment variables (on Vercel; optional locally):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Admin panel password (defaults to `admin` locally). |
| `SESSION_SECRET` | Session signing key, at least 32 characters. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Both required in production for shared settings, rate limits and session revocation. Missing either makes the API and avatar proxy return 503 (no memory fallback). Dev/preview and tests use local memory. |

Locally: `ADMIN_PASSWORD=other pnpm dev`. Deploy: `pnpm dlx vercel --prod`.

## Tests

`pnpm test` runs behavior tests grouped by responsibility in `tests/`. Keep security, money validation and synchronization edge cases here; avoid assertions on source-code text or CSS declarations.

`pnpm test:e2e` checks rendered layout, header, mobile/reduced-motion behavior, video and admin flows in Chrome. Screenshots go to `shots/` (override with `SHOTS`; set `CHROME` for a different executable).

## Nostr overload protection

Relay events are checked locally for the requested hashtags/post IDs, the start line and a maximum future clock skew of two minutes. Oversized events are rejected before application-level signature validation. Each feed admits at most 100 notes and 100 receipts per second; duplicate retained events do not spend that budget.

There is one active zap subscription for the retained posts (500 by default), with four concurrent receipt validations and at most 128 queued receipts. LNURL HTTP requests time out after five seconds, including body reading. Under sustained overload, excess events are dropped rather than queued indefinitely; this feed is best-effort, not a lossless payment ledger. Scene, mobile and moderation redraws are coalesced to at most ten updates per second after the initial render.

These limits bound application work, not raw WebSocket traffic or the relay library's parsing/verification. They do not prevent valid spam/Sybil posts; moderation is still needed.

## How sync works

Settings and moderation saves use an atomic Redis version check. Concurrent changes are reapplied to the latest settings instead of overwriting each other. Retries are bounded; persistent contention returns 503 without saving a stale copy. Existing stored settings need no migration.

`public/config.json` contains static client configuration: relays, hashtags, post length, recent ranking window, public URL, polling interval and video asset. Announcement, start line, scene durations and video scheduling are managed by `/admin`, persisted by the server, with defaults in `shared/settings.ts`.

The **server clock** is the single source of truth. From a stored `epoch` and the scene durations, the server computes which scene is on (and, for video, at which second). Screens only read:

- `GET /api/kiosk` returns the schedule; `GET /api/time` corrects local clock drift.
- Every **21 s** (`settingsPollMs`) they check `GET /api/version` and reload the schedule only if it changed.
- Admin arrows and duration changes re-anchor the schedule; every screen shows the same thing.

## Roadmap

- [x] Scenes, mobile view and admin panel
- [x] Fixed post cutoff via `startLine`
- [x] Deterministic server schedule (`/api/kiosk`, `/api/time`, `/api/version`)
- [x] Full video or synced clips
- [x] Live post and zap animations
- [x] Nostr profile alias and avatar
- [x] QR on every scene
- [ ] Optional anonymous zap via wallet invoice
