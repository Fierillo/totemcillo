# totemcillo

Pantalla tótem para el stand de **La Crypta** en **LABITCONF** (estilo pubpay.me).
Escucha notas Nostr (kind 1) con `#lacrypta` y `#labitconf`, y los zap receipts (kind 9735) que las referencian, y rota escenas automáticamente.

Stack: pnpm + Vite + TypeScript (vanilla) + nostr-tools. Sitio estático, sin backend.

## Correrlo local

```bash
pnpm install
pnpm dev          # abrí http://localhost:5173
pnpm test        # tests con vitest
pnpm vitest run --coverage   # cobertura
pnpm build        # genera dist/
pnpm preview      # sirve el build
```

Hacé doble click en la pantalla para pasar a fullscreen (o usá el modo kiosko del navegador: `chromium --kiosk http://localhost:5173`).

## Configuración

Editá `public/config.json`: relays, hashtags, duración de escenas (ms), cuántos posts por ciclo, lista de charlas y texto de anuncio. No hace falta recompilar si lo cambiás en el deploy.

El historial de posts y zaps se guarda en `localStorage` del navegador.

## Escenas

- ✅ Post con su lista de zaps (rota entre posts)
- ✅ Últimos zaps
- 🚧 Top 10 histórico, top 10 últimas 3h, próximas charlas, anuncio (stubs en `src/scenes/`)

## Deploy en Vercel

Importá el repo en Vercel (detecta Vite) o usá la CLI:

```bash
pnpm dlx vercel        # preview
pnpm dlx vercel --prod
```

`vercel.json` ya define `pnpm install --frozen-lockfile`, `pnpm build` y salida en `dist`.

## Desarrollo

Todo se desarrolla con TDD estricto: primero un test que falla (commit `test: ... (rojo)`), después el código mínimo para pasarlo (`feat: ... (verde)`) y por último el refactor.
