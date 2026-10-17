<div align="center">

# ⚡ totemcillo

**La Crypta**'s totem screen for **LABITCONF**: live Nostr notes and the zaps they receive.

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![nostr-tools](https://img.shields.io/badge/nostr--tools-8E44AD?logo=nostr&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)

<img src="docs/totem-top10.webp" alt="Totem showing the all-time Top 10 zaps" width="820">

</div>

## What it does

- Shows notes tagged `#lacrypta` and `#labitconf` live, with their zap totals.
- Rotates scenes: latest posts, latest zaps, two Top 10s, an announcement and a video.
- Every totem shows the same scene at the same time (server clock).
- The same URL on a phone shows a mobile view with a ⚡ Zap button.

## How it works

**A post appears:** anyone can get on the screen by posting on Nostr with the hashtag.

```mermaid
%%{init: {"sequence": {"mirrorActors": false}}}%%
sequenceDiagram
  actor Person
  participant Relays as Nostr relays
  participant Totem
  Person->>Relays: Posts a note with the hashtag
  Relays->>Totem: New note
  Note over Totem: Skips hidden posts<br/>and banned authors
  alt Posts scene on screen
    Note over Totem: The post slides in at the top
  else Other scene on screen
    Note over Totem: A new-post icon pops up
  end
```

**A zap is counted:** only real payments add sats.

```mermaid
%%{init: {"sequence": {"mirrorActors": false}}}%%
sequenceDiagram
  actor Person
  participant Wallet
  participant Relays as Nostr relays
  participant Totem
  Person->>Wallet: Zaps a post
  Wallet->>Relays: Signed zap receipt
  Relays->>Totem: Zap receipt
  Note over Totem: Checks signatures, amount<br/>and that the wallet is allowed
  alt Valid
    Note over Totem: Adds the sats, plays a lightning<br/>animation and updates the Top 10s
  else Fake or not allowed
    Note over Totem: Ignored
  end
```

**An organizer changes something:** every screen follows within about 21 seconds.

```mermaid
%%{init: {"sequence": {"mirrorActors": false}}}%%
sequenceDiagram
  actor Organizer
  participant Admin as /admin
  participant Server as Server + Redis
  participant Totem as Every totem
  Organizer->>Admin: Edits announcement,<br/>durations or moderation
  Admin->>Server: Saves the change
  loop Every 21 seconds
    Totem->>Server: Anything new?
  end
  Server-->>Totem: New settings and schedule
  Note over Totem: All screens show the same<br/>scene at the same time
```

## Getting started

```bash
pnpm install
pnpm dev      # http://localhost:5173 and /admin
pnpm test
pnpm build
```

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | `/admin` password (`admin` locally if unset) |
| `SESSION_SECRET` | Session signing key (32+ characters) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token |

- **Deploy:** Vercel + Upstash; both Redis variables are required in production.
- **Admin:** `/admin` (password): announcement, scene durations, video, start line, zap providers and moderation.
- **Dev tools:** `pnpm dev` adds buttons to simulate posts/zaps and step through scenes.
- **Zaps:** validated per NIP-57, only from an allowlist of LNURL providers.

<div align="center"><sub>ISC © 2026 Fierillo · Built for <b>La Crypta</b> 🧡</sub></div>
