# totemcillo

Pantalla tótem para el stand de **La Crypta** en **LABITCONF** (estilo pubpay.me).
Escucha notas Nostr (kind 1) con `#lacrypta` y `#labitconf`, y los zap receipts (kind 9735) que las referencian, y rota escenas automáticamente.

Stack: pnpm + Vite + TypeScript (vanilla) + nostr-tools. Sitio estático + Vercel Functions en `/api` para el panel de admin (Upstash Redis).

## Correrlo local

```bash
pnpm install
pnpm dev          # abrí http://localhost:5173 (tótem) y http://localhost:5173/admin
pnpm test        # tests con vitest
pnpm vitest run --coverage   # cobertura
pnpm build        # genera dist/
pnpm preview      # sirve el build
```

Hacé doble click en la pantalla para pasar a fullscreen (o usá el modo kiosko del navegador: `chromium --kiosk http://localhost:5173`).

## Configuración

Editá `public/config.json`: relays, hashtags, duración de escenas (ms), lista de charlas, texto de anuncio inicial, `publicUrl` (URL del QR; vacío = la URL donde está abierta la página) y `settingsPollMs` (cada cuánto el tótem consulta `/api/settings`). No hace falta recompilar si lo cambiás en el deploy.

El historial de posts y zaps se guarda en `localStorage` del navegador.

## Escenas

- ✅ Posts: lista de los 6 más nuevos (más nuevo arriba, siempre igual para los mismos datos) con autor, hace cuánto, extracto (210, ajustado), total y últimos 2 zaps. Al costado (abajo en vertical) **un único QR** con la URL de la app para abrirla en el celu.
- ✅ Últimos zaps
- ✅ Top 10 histórico y Top 10 últimas 3 h
- ✅ Anuncio: lo edita el admin; siempre está en la rotación (sin texto muestra "Sin anuncios por ahora")
- 🚧 Próximas charlas

## Celular

Misma ruta `/`. Con pantalla angosta (≤ 700 px) no rota: muestra todo apilado y scrolleable (anuncio, posts, últimos zaps, tops), sin QR, y cada post tiene un botón **⚡ Zapear** (`nostr:nevent…`, abre tu cliente Nostr) y el link alternativo a njump.me.

## Admin (`/admin`)

Panel con clave para editar el anuncio (máx. 280), la duración de cada escena (3 a 120 s) y botones ← → para cambiar la escena del tótem a distancia. El tótem consulta `/api/settings` cada `settingsPollMs` y aplica los cambios en vivo.

- `POST /api/login` compara la clave con `ADMIN_PASSWORD` en tiempo constante y devuelve una cookie de sesión `HttpOnly; SameSite=Strict` (y `Secure` en HTTPS) firmada con HMAC (`SESSION_SECRET`), válida 1 hora. Máximo 10 intentos cada 10 minutos por IP.
- `GET /api/settings` es público (anuncio, duraciones y último comando). `PUT /api/settings` requiere sesión y JSON.
- La página `/admin` en sí es pública (HTML estático): lo que protege es la API.

### Variables de entorno en Vercel

| Variable | Para qué |
| --- | --- |
| `ADMIN_PASSWORD` | Clave del panel (usá una larga). |
| `SESSION_SECRET` | Secreto para firmar la sesión, **mínimo 32 caracteres** (`openssl rand -hex 32`). |
| `UPSTASH_REDIS_REST_URL` | URL REST de tu base Upstash Redis. |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST de Upstash. |

Sin `ADMIN_PASSWORD`/`SESSION_SECRET` el login responde 503 (falla cerrado). Sin Upstash usa memoria, que en Vercel **no persiste** entre invocaciones: configuralo. La forma más fácil: Vercel → Storage → Marketplace → Upstash Redis (crea y conecta las variables solo).

### Local

`pnpm dev` y `pnpm preview` montan los mismos handlers de `/api` con almacenamiento en memoria (plugin de Vite en `server/vite-plugin.ts`). La clave por defecto es `admin`; cambiala con `ADMIN_PASSWORD=otra pnpm dev`. Para probar las Functions tal cual corren en Vercel: `pnpm dlx vercel dev`.

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

## QR

El QR del tótem lleva a la misma app (`publicUrl` o la URL actual). En el celu cada post tiene su botón Zapear.
