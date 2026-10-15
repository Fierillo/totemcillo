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
- Zaps validated per NIP-57; only posts and zaps since `startLine` count (editable in `/admin`; default from `public/config.json`).

## Running

```bash
pnpm install
pnpm dev      # http://localhost:5173 and /admin
pnpm test     # vitest
pnpm build    # dist/
```

Environment variables (on Vercel; optional locally):

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Admin panel password (defaults to `admin` locally). |
| `SESSION_SECRET` | Session signing key, at least 32 characters. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Config persistence (in-memory without them). |

Locally: `ADMIN_PASSWORD=other pnpm dev`. Deploy: `pnpm dlx vercel --prod`.

## How sync works

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
- [ ] Move the bolt away from the "time ago" text
- [ ] `videoDurationSec` field in admin
- [ ] Optional anonymous zap via wallet invoice
