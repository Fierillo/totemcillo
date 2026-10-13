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

## Seguridad

- **Zaps (NIP-57):** sólo se cuentan los receipts con firma válida, con zap request 9734 firmada cuyo `p`/`e` coinciden con los del receipt, cuyo monto del bolt11 coincide con el `amount` (si está), y que vienen firmados por el `nostrPubkey` del LNURL del destinatario (se resuelve desde el lud16/lud06 de su kind 0 y se cachea).
- **Ojo con CORS:** el chequeo del LNURL se hace desde el navegador. Si el endpoint del destinatario no manda `Access-Control-Allow-Origin`, el zap queda sin verificar y **no se cuenta** (se reintenta cada 5 min).
- Las notas kind 1 también se verifican por firma. El historial de `localStorage` se valida al cargar, hay tope de posts/zaps en memoria y el contenido largo se trunca.
