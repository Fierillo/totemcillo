# totemcillo

Pantalla tótem para el stand de **La Crypta** en **LABITCONF** (estilo pubpay.me).
Escucha notas Nostr (kind 1) con `#lacrypta` y `#labitconf`, y los zap receipts (kind 9735) que las referencian, y rota escenas automáticamente.

Stack: Vite + TypeScript (vanilla) + nostr-tools. Sitio estático, sin backend.

## Correrlo local

```bash
npm install
npm run dev      # abrí http://localhost:5173
npm test         # tests con vitest
npm run build    # genera dist/
npm run preview  # sirve el build
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
npx vercel        # preview
npx vercel --prod
```

`vercel.json` ya define `npm run build` y salida en `dist`.
