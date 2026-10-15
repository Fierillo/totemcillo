# totemcillo

Tótem de **La Crypta** para **LABITCONF**: muestra en vivo las notas Nostr con `#lacrypta` y `#labitconf` y los zaps que reciben.

![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![nostr-tools](https://img.shields.io/badge/nostr--tools-8E44AD?logo=nostr&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white)
![Upstash Redis](https://img.shields.io/badge/Upstash_Redis-00E9A3?logo=upstash&logoColor=black)
![pnpm](https://img.shields.io/badge/pnpm-F69220?logo=pnpm&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)

## Qué hace

- **Escenas** en rotación: posts recientes, últimos zaps, Top 10 histórico, Top 10 de las últimas horas, anuncio y video.
- **Animaciones en vivo** cuando llega un post o un zap (también en el celular).
- **Perfiles Nostr**: alias y avatar en lugar del npub.
- **QR** a la app en posts, tops y anuncio.
- **Vista móvil** en la misma URL, con botón ⚡ Zapear.
- **Admin** (`/admin`, con clave): anuncio, duraciones, modo de video y flechas ← →.
- Zaps validados según NIP-57; sólo se muestran posts desde `startLine` (`public/config.json`).

## Correrlo

```bash
pnpm install
pnpm dev      # http://localhost:5173 y /admin
pnpm test     # vitest
pnpm build    # dist/
```

Variables de entorno (en Vercel; en local, opcionales):

| Variable | Para qué |
| --- | --- |
| `ADMIN_PASSWORD` | Clave del panel (en local, `admin` por defecto). |
| `SESSION_SECRET` | Firma de la sesión, mínimo 32 caracteres. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Persistencia de la configuración (sin ellas, memoria). |

En local, `ADMIN_PASSWORD=otra pnpm dev`. Deploy: `pnpm dlx vercel --prod`.

## Cómo se sincroniza

El **reloj del servidor** es la única fuente de verdad. A partir de un `epoch` guardado y las duraciones, el servidor calcula qué escena va (y, si es video, en qué segundo). Los tótems sólo leen:

- `GET /api/kiosk` devuelve la agenda; `GET /api/time` corrige el desfase del reloj local.
- Cada **21 s** (`settingsPollMs`) chequean `GET /api/version` y recargan la agenda sólo si cambió (ya no se consulta cada 4 s).
- Las flechas del admin y los cambios de duración reanclan la agenda; todas las pantallas muestran lo mismo.

## Roadmap

- [x] Escenas, vista móvil y panel de admin
- [x] Corte fijo de posts por `startLine`
- [x] Agenda determinística en el servidor (`/api/kiosk`, `/api/time`, `/api/version`)
- [x] Video completo o por clips sincronizados
- [x] Animaciones en vivo de posts y zaps
- [x] Alias y avatar de perfiles Nostr
- [x] QR en todas las escenas
- [ ] Alejar el rayo del texto "hace X"
- [ ] Campo `videoDurationSec` en el admin
- [ ] Zap anónimo opcional con invoice desde la wallet
