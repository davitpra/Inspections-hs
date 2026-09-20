# 06 — El cliente web: construir, publicar y servir la PWA

**Qué resuelve.** Deja el bundle del cliente construido con la URL correcta de la API,
publicado en el VPS y servido por Caddy, con la PWA instalable y el modo offline
funcionando. Y deja hecha —antes de que nadie instale nada— la verificación que impide
repartir un bundle envenenado.

**Qué NO resuelve.** El `Caddyfile` y el `compose.prod.yml` son del `03`: este documento
**especifica los requisitos** de las cabeceras y del fallback, y los **verifica sobre la
respuesta real**; no los escribe. El valor de `VITE_API_BASE_URL` es del `07`. La
instalación de la PWA en los teléfonos de los inspectores es del `09`.

**Artefactos que este documento crea o modifica.**

- `apps/web/dist/` — el bundle construido. No se commitea
- `/srv/hs-platform/web/` en el VPS — el bundle publicado. **Este documento es su único
  dueño**
- Los build args del cliente y los requisitos de cabeceras — **viven acá** (README,
  «Propiedad de artefactos»)

Si un paso te lleva a tocar algo que no está en esta lista, pará: es de otro documento.

**Estado al entrar.** `app.<DOMINIO>` sirve https con certificado válido y devuelve 404:
el bundle no está. **Estado al salir.** `app.<DOMINIO>` sirve la PWA, instalable, con el
modo offline verificado, y ningún teléfono la tiene instalada todavía.

---

## 1. Precondiciones

### El `01` está ejecutado

```bash
grep -n "VITE_API_BASE_URL" .env.example
grep -rn "VITE_API_BASE_URL" apps/web/src/
```

La primera tiene que encontrarla en `.env.example`. La segunda tiene que devolver **una
sola línea**, en `apps/web/src/api/client.ts`. Si aparece en dos lugares hay un segundo
default que este documento no describe, y uno de los dos va a ganar sin que se sepa cuál.

### El `03` está ejecutado y `app.<DOMINIO>` responde

```bash
curl -s -o /dev/null -w '%{http_code} %{ssl_verify_result}\n' https://app.<DOMINIO>/
```

Esperado: `404 0`. El `0` es el certificado válido; el `404` es que el bundle todavía no
existe, y es correcto en este punto.

### El `07` está ejecutado y el valor de `VITE_API_BASE_URL` está fijado

Es el grupo C de la matriz de variables. **Este documento no lo escribe ni lo muestra**:
lo lee del `07`, Paso 8. Tiene que ser el origen https de la API, pelado —sin barra final
y sin ruta— y tiene que estar en `WEB_ORIGINS` del otro lado, byte a byte, o el navegador
corta cada request antes de que la API lo vea.

### La cadena de herramientas, en la máquina de desarrollo

```bash
node --version    # >= 22.12.0 (H1, y `.npmrc` fija engine-strict=true)
pnpm --version
git rev-parse --short HEAD
```

El tercero es el commit que se va a construir. **Tiene que ser el mismo que `API_TAG`**:
el cliente y la API que se despliegan juntos salen del mismo árbol, o un endpoint que el
bundle llama puede no existir todavía.

### Para el Paso 10 en adelante, la API tiene que estar arriba

La construcción y la publicación (Pasos 1 a 9) no necesitan la API. La verificación del
Paso 10 sí: comprueba que la **primera petición de datos** sale hacia `api.<DOMINIO>`. Ese
punto del orden de arranque en frío está en el `07`, sección «Arranque, redeploy y
rollback»: `04` y `05` primero, después el `up -d api`.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | **El bundle se construye en la máquina de desarrollo, no en el VPS** | Es un artefacto estático. Poner la toolchain de Node y `pnpm install` en el VPS agrega una pieza que no hace falta, y el `02` ya eligió construir local y transferir |
| D2 | **`VITE_API_BASE_URL` se pasa en el comando de build**, no en un `.env` | Vite lee sus `.env` desde `apps/web/` (no hay `envDir` en `vite.config.ts`), así que el `.env` de la raíz **no lo ve**. La variable del shell gana sobre cualquier `.env`, y es lo único que no depende de un archivo que puede faltar en otra máquina |
| D3 | **Se construye siempre sobre un `dist/` limpio** | `check-service-worker.mjs` suma **todo** lo que hay en `apps/web/dist/` menos `sw.js`. Un chunk viejo con otro hash se suma a la cuenta y rompe el build por algo que no está en el bundle actual |
| D4 | **La app va en la raíz de `app.<DOMINIO>`**, nunca en un subpath | El manifest declara `id`, `start_url` y `scope` en `/`, y el service worker se registra con `scope: '/'`. Ver el Paso 6 para la lista completa de lo que habría que cambiar |
| D5 | **La publicación es in situ, con `rsync`**, no un swap de directorio | El `03` monta `./web:/srv/web:ro`. Docker resolvió ese directorio **al arrancar el contenedor**: reemplazarlo por otro con `mv` deja a Caddy sirviendo el inodo viejo, sin ningún error |
| D6 | **Los requisitos de cabeceras los implementa el `03`; acá se verifican sobre la respuesta real** | Razonar sobre el orden de directivas del `Caddyfile` es adivinar. Un `curl -I` contra el sitio desplegado no lo es |
| D7 | **Nadie instala la PWA hasta que pase el Paso 10** | Después de instalada, el bundle vive en el precache de cada teléfono con `skipWaiting` + `clientsClaim`. Alcanzar de nuevo a un dispositivo envenenado es difícil; no envenenarlo es gratis |

---

## 3. Pasos

### Paso 1 — Limpiar `dist/` y construir los paquetes primero

**El orden de build no es negociable (H2).** `apps/web` consume `@hs/forms` y
`@hs/contracts` por sus `exports` → `dist`: sin compilarlos, `tsc -b` del cliente falla con
errores de módulo no encontrado que no tienen nada que ver con el despliegue.

```bash
rm -rf apps/web/dist packages/forms/dist packages/contracts/dist
pnpm install --frozen-lockfile
pnpm --filter contracts --filter forms build
```

**Cómo sé que salió bien.** Los dos `dist` existen y `apps/web/dist` no:

```bash
ls packages/forms/dist/index.js packages/contracts/dist/index.js
test -d apps/web/dist && echo "FALLÓ: dist/ del cliente no se borró" || echo "dist/ limpio"
```

> **Por qué el `rm -rf` está en el paso y no en una nota.** `check-service-worker.mjs`
> mide el precache recorriendo el directorio entero:
>
> ```js
> /** Todo lo que el precache incluye: el build entero menos el service worker. */
> function totalBytes(directory) { ... if (entry.name === 'sw.js') return sum; ... }
> ```
>
> No mira la lista de precache de `sw.js`: mira el disco. Un `assets/index-VIEJO.js` de
> hace tres builds pesa 780 KiB y hace fallar el presupuesto por sí solo. El síntoma es un
> build que dice que el bundle creció cuando no creció.

---

### Paso 2 — Construir el cliente con `VITE_API_BASE_URL`

**Este es el error más caro de toda la etapa.** `apps/web/src/api/client.ts:11`:

```ts
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';
```

Es **build-time**: Vite la inlinea en el bundle y queda horneada adentro, y adentro del
precache del service worker. Si falta, el build **no falla**, el deploy **no falla** y el
servidor **no registra nada**: falla en el teléfono de cada inspector, todos a la vez. No
hay validación que lo detecte —`apps/api/src/env.ts` valida el entorno de la API y nunca va
a ver esta variable— y no se arregla sin recompilar y volver a publicar.

```bash
VITE_API_BASE_URL=<EL_VALOR_QUE_FIJA_EL_07> pnpm --filter web build
```

El valor sale del `07`, Paso 8. **Este documento no lo escribe.**

La variable se prefija al comando a propósito: así viaja en el entorno del proceso hasta
`vite build`, y la variable del shell tiene precedencia sobre cualquier `.env`. Un
`VITE_API_BASE_URL` puesto en el `.env` de la raíz del repo **no hace absolutamente nada**:
Vite carga sus `.env` desde `apps/web/`, que es donde está `vite.config.ts`.

El script `build` de `apps/web/package.json` encadena cuatro cosas, en este orden:

```
node scripts/check-tokens.mjs  &&  tsc -b  &&  vite build  &&  node scripts/check-service-worker.mjs
```

Las dos comprobaciones de los extremos son del proyecto y **no son opcionales**: fallan el
build. Los Pasos 4 y 5 explican qué miran.

**Cómo sé que salió bien.** El `dist/` existe y tiene las seis piezas del precache:

```bash
ls -la apps/web/dist apps/web/dist/assets
```

Esperado: `index.html`, `sw.js`, `manifest.webmanifest`, `icon-192.png`, `icon-512.png` y
`assets/` con un `.js` y un `.css`, los dos con hash de contenido en el nombre.

> **La comprobación real del Paso 2 es la del Paso 3.** Que el comando termine con código
> 0 no prueba nada sobre la variable: el build sale igual de bien sin ella.

---

### Paso 3 — Verificar la URL **sobre el artefacto construido**

No se verifica el comando. Se verifica el archivo que va a correr en el teléfono.

```bash
grep -c "localhost:3000" apps/web/dist/assets/*.js
```

**Tiene que imprimir `0`.** Si imprime `1` o más, el bundle está envenenado: volvé al Paso
2. No publiques.

Y la contraparte, que es la que de verdad importa —que esté la URL real, y no que falte la
mala:

```bash
grep -o "https://api\.<DOMINIO>" apps/web/dist/assets/*.js | head -1
```

Tiene que imprimir el origen de la API. Si no imprime nada, la variable no llegó al build
aunque el `grep` de `localhost` haya dado `0` (pasa si alguien editó el default).

Las dos van juntas, y las dos sobre `dist/assets/*.js`. **No sobre `sw.js`**: la URL de la
API no está ahí. `sw.js` solo lleva la lista de precache, con los nombres de los archivos y
sus revisiones:

```bash
grep -oE 'url:`[^`]+`' apps/web/dist/sw.js
```

Esperado, seis entradas: `manifest.webmanifest`, `index.html`, `icon-512.png`,
`icon-192.png`, `assets/index-<hash>.js` y `assets/index-<hash>.css`.

> **Por qué esto alcanza para detectarlo.** El bundle del cliente es **un solo chunk**: no
> hay code splitting, así que hay un único `.js` en `assets/` y la cadena está ahí o no
> está. Si algún día aparecen varios chunks, el `grep` con `*.js` los cubre igual.

---

### Paso 4 — Leer las dos líneas de `check-service-worker.mjs`

Corre al final del build e imprime exactamente dos líneas:

```
service worker: sin builtins de Node ✓
precache: 881.6 KiB (presupuesto 900 KiB)
```

Para volver a verlas sin reconstruir, con el `dist/` ya generado:

```bash
pnpm --filter web verify:bundle
```

#### La primera línea: ADR-007 sobre el artefacto, no sobre el fuente

El script busca `require("node:fs")`, `require("fs")` y `from "node:crypto"` —y once
builtins más— **dentro de `dist/sw.js`**. El encabezado del archivo dice por qué ahí y no
en el fuente:

> `packages/forms` viaja dentro de este bundle, y por eso no puede depender de builtins de
> Node. La regla está escrita como lint sobre el fuente del paquete; esto la comprueba
> sobre el ARTEFACTO, que es lo único que el navegador va a ejecutar. Un `require('crypto')`
> que entra por una dependencia transitiva no lo ve el lint del paquete.

Esa es la razón entera. `eslint.config.js` prohíbe los builtins **en el código de
`packages/forms`**; no puede ver lo que arrastra una dependencia de una dependencia hasta
que el bundler lo mete adentro. El síntoma que evita es concreto y caro: un service worker
que **no instala** en el teléfono del inspector. Y sin service worker instalado no hay
shell precacheado, y sin shell precacheado no hay captura sin red, que es la razón de ser
de ADR-001. El fallo no se vería acá: se vería en una planta sin señal.

#### La segunda línea: el presupuesto, y qué hacer si se pasó

`apps/web/scripts/check-service-worker.mjs` fija:

```js
const PRECACHE_BUDGET_BYTES = 900 * 1024;
```

El `dist/` medido hoy son **881.6 KiB**. Quedan **18.4 KiB**. No es holgura cómoda: un
paquete nuevo de tamaño medio se la come entero.

El comentario que acompaña al número dice para qué existe:

> Cuando crezca, este número sube en un commit y el revisor ve cuánto: es el mecanismo
> entero. Holgado respecto de lo medido hoy, para que un chunk nuevo no rompa el build
> antes de que alguien pueda mirarlo.

**Subir el número es una decisión, no un trámite.** El criterio, en este orden:

1. **Confirmar que el `dist/` estaba limpio.** Repetir el Paso 1 y reconstruir. Si el
   número baja por debajo de 900, no había crecimiento: había basura. Es el caso más común
   y el único que no cuesta nada.
2. **Averiguar qué entró de más.** `ls -la apps/web/dist/assets` y comparar contra la línea
   de base que el `01` anotó. Una dependencia agregada sin querer, un asset grande metido
   en `public/`, un `import` de un paquete entero donde alcanzaba una función.
3. **Recién ahí, subir `PRECACHE_BUDGET_BYTES` en un commit propio y solo. Nunca en el
   mismo commit que lo hizo crecer.** El mecanismo entero es que el revisor vea cuánto
   subió y por qué; un número que sube escondido entre cambios de funcionalidad no informa
   nada.

**No se desactiva.** ADR-012 lo cita como una de las dos objeciones que hay que responder
antes de proponer un framework de UI. Lo que se paga cuando el precache crece lo paga el
inspector, una vez, con red: el service worker descarga el bundle **entero** en la
instalación, porque `vite.config.ts` sube `maximumFileSizeToCacheInBytes` a 8 MiB
justamente para que el precache esté completo. En una planta con una barra de señal, la
diferencia entre 880 KiB y 3 MB es la diferencia entre instalar y no instalar.

---

### Paso 5 — `check-tokens.mjs`: por qué el build de producción puede fallar hablando de colores

Corre **primero**, antes de `tsc -b` y de `vite build`. Si falla, no hay bundle.

Entre sus cuatro comprobaciones hay una que acopla tres archivos:

```bash
grep -n "brand" apps/web/src/index.css | head -1
grep -n "theme-color" apps/web/index.html
grep -n "theme_color\|background_color" apps/web/public/manifest.webmanifest
```

`--brand` de `src/index.css` tiene que resolver al mismo color que el `theme-color` de
`index.html` y que `theme_color` **y** `background_color` del manifest. El script lo dice
así:

> Son los tres lugares donde el color NO puede ser un `var()` —los lee el sistema
> operativo, no el navegador— y por eso son los únicos que pueden desincronizarse en
> silencio.

**Qué significa para el despliegue.** Si alguien tocó un color de marca y actualizó dos de
los tres lugares, el build de producción **falla acá**, con un mensaje que habla de tokens
y de `--brand`, y **no menciona el despliegue en ninguna parte**. La tentación es pensar
que el entorno de build está roto. No lo está: es una comprobación del proyecto haciendo
exactamente su trabajo, y el arreglo es de una línea, en el repo, y se commitea.

Su salida, cuando pasa, son tres líneas al principio del build:

```
tokens: N declarados (M primitivas) ✓
categorías vigiladas: color, espaciado, radio, tipografía, peso ✓
marca: <color> coincide en index.html y el manifest ✓
```

**Cómo sé que salió bien.** Sin reconstruir:

```bash
pnpm --filter web verify:tokens
```

---

### Paso 6 — La app va en la raíz del dominio

Tres archivos lo declaran, y los tres dicen `/`:

```bash
grep -n '"id"\|"start_url"\|"scope"' apps/web/public/manifest.webmanifest
grep -n "register(" apps/web/src/offline/storage.ts
grep -n "base" apps/web/vite.config.ts
```

- `manifest.webmanifest`: `"id": "/"`, `"start_url": "/"`, `"scope": "/"`.
- `storage.ts`: `navigator.serviceWorker.register('/sw.js', { scope: '/' })`.
- `vite.config.ts`: **no declara `base`**, así que Vite usa `/` y `dist/index.html` sale
  referenciando `/assets/index-<hash>.js` en absoluto.

**No hay ningún dominio hardcodeado.** Verificalo:

```bash
grep -rnE "https?://[a-z0-9.-]+" apps/web/src apps/web/public apps/web/index.html \
  --include="*.ts" --include="*.tsx" --include="*.html" --include="*.webmanifest" \
  | grep -v "\.test\." | grep -v localhost
```

Tiene que salir **vacío**. Las únicas URLs absolutas del cliente están en archivos `.test.`
(`https://api.test`, `https://bucket.test`), que no entran al bundle. El bundle funciona en
cualquier dominio: lo único externo que sabe es `VITE_API_BASE_URL`.

**Pero tiene que servirse en la raíz.** Un subpath —`app.<DOMINIO>/walkthrough/`— no es una
opción gratis. Habría que cambiar, todos a la vez:

| Archivo | Qué |
| --- | --- |
| `apps/web/vite.config.ts` | Agregar `base: '/walkthrough/'`, o `index.html` pide `/assets/…` y da 404 |
| `apps/web/public/manifest.webmanifest` | `id`, `start_url` y `scope`. Un `scope` que no contiene a `start_url` deja la PWA **no instalable**, sin más explicación que un aviso en DevTools |
| `apps/web/src/offline/storage.ts` | La ruta del `register` y su `scope`. Un service worker **no puede reclamar un alcance por encima del suyo**: servido en `/walkthrough/sw.js` no controla `/` |
| `apps/web/src/sw.ts` | `CAPTURE_ROUTES` son `/^\/$/`, `/^\/inspections\//` y `/^\/outbox$/`, contra `url.pathname`, que es absoluto desde el origen. Con prefijo no matchea **ninguna** |
| `apps/web/src/sw.ts` | `serwist.matchPrecache('/index.html')` está escrito absoluto, en dos lugares. Bajo un `base`, las entradas del precache quedan bajo el prefijo y esa búsqueda devuelve `undefined` → `Response.error()` |
| `apps/web/src/app/router.tsx` | `createRouter({ routeTree, defaultPreload: false })` no declara `basepath` |
| `Caddyfile` (del `03`) | El fallback y los tres matchers de caché |

Siete lugares, y **los tres de `sw.ts` y `storage.ts` fallan en silencio**: la app carga,
se ve bien, y no hay modo offline. Por eso la decisión D4 es una decisión y no un default.

---

### Paso 7 — Los cuatro requisitos de Caddy, y su verificación

El `03` es el dueño del `Caddyfile` y ya escribió el bloque `app.`. Este documento
**declara qué tiene que cumplir** y lo verifica. Las correcciones se piden en la sección 7,
no se aplican acá.

#### (a) Fallback SPA — el servidor, no el service worker

`apps/web/src/sw.ts` declara:

```ts
const CAPTURE_ROUTES = [/^\/$/, /^\/inspections\//, /^\/outbox$/];
```

y el listener de `fetch` hace `if (!isCaptureRoute) return;`. Es decir: el service worker
cubre **tres** patrones de ruta, y **solo después de instalarse**.

El router tiene bastantes más: `/historical`, `/findings`, `/findings/$id`, `/incidents`,
`/incidents/report`, `/incidents/$id`, `/incidents/$id/form7`, `/scheduling`,
`/scheduling/$scheduleId`, `/roster`, `/accept-invitation`, `/templates`,
`/templates/drafts/$id`, `/templates/versions/$versionId`, `/catalog/locations`. Y en la
**primera visita** no hay service worker en absoluto.

**Requisito:** toda navegación que no corresponda a un archivo existente tiene que
responder `200` con el contenido de `/index.html`. Sin esto, un refresh en `/findings` da
404, y un link a `/accept-invitation?token=…` —que es **cómo se entrega toda invitación**,
a mano, por link (H18)— da 404 la primera vez que alguien lo abre.

**El `03` ya lo implementa** con `try_files {path} /index.html` seguido de `file_server`.
Cumplido.

#### (b) `sw.js` sin caché larga

```bash
grep -n "skipWaiting\|clientsClaim" apps/web/src/sw.ts
```

Las dos están en `true`. `sw.js` **no lleva hash en el nombre** —es el punto de entrada
fijo del `register`— así que es el único archivo del bundle cuya URL no cambia nunca.

**Requisito:** `Cache-Control: no-cache` (o equivalente que obligue a revalidar). Con caché
larga, los teléfonos quedan clavados en una versión vieja y **la única vía para alcanzarlos
se cierra**: todo el mecanismo de actualización de una PWA pasa por que el navegador note
que `sw.js` cambió de bytes.

**El `03` ya lo implementa** con `@sw path /sw.js` + `no-cache, must-revalidate`. Cumplido.

> **Un matiz que no cambia el requisito.** `storage.ts` registra sin `updateViaCache`, y el
> default `'imports'` hace que el navegador **no consulte la caché HTTP** para el script
> de nivel superior del service worker. Además los navegadores topan en 24 h la frescura de
> ese script. La cabecera sigue haciendo falta: cubre la primera descarga, cubre cualquier
> caché intermedia entre el teléfono y Caddy, y hace que la garantía no dependa de un
> default del navegador que nadie de este proyecto controla.

#### (c) `assets/*` inmutables

```bash
ls apps/web/dist/assets
```

Los nombres llevan hash de contenido (`index-DcYCgS-U.js`). Cambia el contenido, cambia el
nombre: una URL de `assets/` nunca sirve dos contenidos distintos.

**Requisito:** `Cache-Control: public, max-age=31536000, immutable`.

**El `03` ya lo implementa** con `@assets path /assets/*`. Cumplido.

#### (d) `index.html` sin caché

`dist/index.html` referencia los assets hasheados del build actual. Un `index.html` cacheado
pide assets que ya no existen.

**Requisito:** `Cache-Control: no-cache` en **toda respuesta HTML**, incluidas las que
resuelve el fallback del punto (a).

**El `03` lo implementa** con `@html path / /index.html`. Cumplido para `/` y `/index.html`.
**Queda por confirmar** el caso del fallback: una navegación a `/findings` la responde
`try_files` reescribiendo a `/index.html`, y el matcher se evalúa contra la ruta pedida.
La verificación del Paso 10.1 lo resuelve empíricamente; si la cabecera no está, es un pedido
al `03` (sección 7).

---

### Paso 8 — Preparar el directorio en el VPS

El `03` monta `./web:/srv/web:ro` en el servicio `caddy`, así que el bundle va a
`/srv/hs-platform/web/` del VPS.

```bash
ssh <USUARIO>@<HOST_VPS> '
  sudo mkdir -p /srv/hs-platform/web
  sudo chown -R $USER /srv/hs-platform/web
  ls -ld /srv/hs-platform/web
'
```

El `chown` no es opcional y hay una razón concreta: en el Paso 6 del `03` el servicio
`caddy` se levanta **antes** de que este documento corra. Si `/srv/hs-platform/web` no
existía, **Docker lo creó, vacío y con dueño `root`**. El `rsync` del paso siguiente va a
fallar con `Permission denied` y el mensaje no va a explicar por qué.

**Cómo sé que salió bien.** El dueño es el usuario del despliegue, no `root`:

```bash
ssh <USUARIO>@<HOST_VPS> "stat -c '%U %a %n' /srv/hs-platform/web"
```

---

### Paso 9 — Publicar el bundle

```bash
rsync -av --checksum --delay-updates --delete-delay \
  apps/web/dist/ <USUARIO>@<HOST_VPS>:/srv/hs-platform/web/
```

**La barra final de `apps/web/dist/` es obligatoria.** Sin ella, `rsync` copia el
directorio y queda `/srv/hs-platform/web/dist/index.html`: Caddy tiene `root * /srv/web` y
sigue devolviendo 404, con el bundle publicado y a la vista.

**Por qué esas dos banderas, y no un swap.** El reemplazo tiene que ser in situ:

- `--delay-updates` transfiere todo a nombres temporales y **recién al final los renombra
  en bloque**. La ventana en la que `index.html` nuevo convive con assets viejos se reduce
  a los milisegundos del lote de renames, en vez de durar toda la transferencia.
- `--delete-delay` borra los archivos que sobran (los assets del build anterior)
  **después** de transferir, no antes.
- `--checksum` compara por contenido y no por fecha. Los nombres hasheados hacen que casi
  nunca importe, pero `index.html`, `sw.js` y el manifest **no están hasheados** y sí
  pueden cambiar con el mismo tamaño.

**Nunca `mv` sobre el directorio.** El bind mount del `03` es `./web`, resuelto por Docker
al arrancar el contenedor: reemplazar el directorio por otro deja a `caddy` sirviendo el
inodo viejo indefinidamente, **sin un solo error en ningún log**. Lo mismo vale para un
symlink que se repunta.

**No hace falta reiniciar Caddy.** `file_server` lee del disco en cada request, y el bind
mount refleja los archivos nuevos de inmediato. Eso es exactamente por lo que el
reemplazo tiene que ser in situ.

**Cómo sé que salió bien.** No por la salida de `rsync`: por lo que Caddy sirve.

```bash
# 1. Los archivos están donde Caddy los busca, vistos DESDE el contenedor.
ssh <USUARIO>@<HOST_VPS> 'cd /srv/hs-platform && docker compose --env-file .env.prod -f compose.prod.yml \
  exec caddy sh -c "ls -l /srv/web /srv/web/assets"'

# 2. El index.html servido referencia EL asset de este build.
curl -s https://app.<DOMINIO>/ | grep -o '/assets/[^"]*'
ls apps/web/dist/assets
```

Los nombres de las dos últimas tienen que coincidir. Si el servido tiene otro hash, quedó
un `index.html` viejo: repetí el `rsync` y volvé a mirar.

```bash
# 3. No quedó basura del build anterior.
ssh <USUARIO>@<HOST_VPS> 'ls /srv/hs-platform/web/assets | wc -l'
```

Tiene que decir `2`: un `.js` y un `.css`.

---

### Paso 10 — La verificación ANTES de que nadie instale la PWA

**Este es el paso más importante del documento.** Precondición: la API arriba
(`docker compose --env-file .env.prod -f compose.prod.yml up -d api`, después del `04` y el `05`).

Una vez que un inspector instala la PWA, el service worker se lleva el bundle al precache
del teléfono, y `skipWaiting` + `clientsClaim` hacen que mande sin esperar a que se cierren
las pestañas. Si ese bundle apunta a localhost, o si `sw.js` quedó mal cacheado, los
teléfonos quedan envenenados y alcanzarlos de nuevo es difícil. Acá se verifica **en una
ventana descartable**, donde equivocarse no cuesta nada.

#### 10.1 — Las cabeceras, primero y sin navegador

```bash
echo '--- el documento raíz'
curl -sI https://app.<DOMINIO>/                    | grep -iE '^(HTTP|cache-control|content-type)'
echo '--- el service worker'
curl -sI https://app.<DOMINIO>/sw.js               | grep -iE '^(HTTP|cache-control|content-type)'
echo '--- un asset hasheado'
curl -sI "https://app.<DOMINIO>$(curl -s https://app.<DOMINIO>/ | grep -o '/assets/[^"]*\.js')" \
                                                   | grep -iE '^(HTTP|cache-control)'
echo '--- el manifest'
curl -sI https://app.<DOMINIO>/manifest.webmanifest | grep -iE '^(HTTP|cache-control|content-type)'
echo '--- el fallback SPA, en una ruta que el service worker NO cubre'
curl -sI https://app.<DOMINIO>/findings             | grep -iE '^(HTTP|cache-control|content-type)'
echo '--- una ruta profunda con query, que es como llega una invitacion'
curl -s -o /dev/null -w '%{http_code}\n' "https://app.<DOMINIO>/accept-invitation?token=x"
```

Esperado, en orden:

| Recurso | Estado | `Cache-Control` | `Content-Type` |
| --- | --- | --- | --- |
| `/` | `200` | `no-cache, must-revalidate` | `text/html` |
| `/sw.js` | `200` | `no-cache, must-revalidate` | `text/javascript` |
| `/assets/index-<hash>.js` | `200` | `public, max-age=31536000, immutable` | — |
| `/manifest.webmanifest` | `200` | — | tiene que ser JSON, no `text/html` |
| `/findings` | `200` | **ver la nota** | `text/html` |
| `/accept-invitation?token=x` | `200` | — | — |

Si `/findings` da `404`, falta el fallback SPA: pará y pedile al `03` la corrección. Si da
`200` pero **sin** `Cache-Control`, el fallback funciona y la cabecera del punto (d) no lo
alcanza: seguí, y anotalo como pedido al `03` (sección 7). Si `/manifest.webmanifest`
devuelve `text/html`, el archivo no está publicado y lo respondió el fallback: la PWA no va
a ser instalable.

#### 10.2 — La ventana de incógnito

Incógnito es el lugar correcto: los service workers y las cachés que se registren ahí
**se descartan al cerrar la ventana**, así que se prueba un bundle sin dejarlo instalado en
ningún lado.

1. Ventana de incógnito **nueva**. Abrir DevTools con `F12` **antes** de navegar.
2. Pestaña **Network**: marcar `Preserve log`, dejar `Disable cache` **desmarcado** —hay que
   ver las cabeceras reales, no las de un modo especial.
3. Navegar a `https://app.<DOMINIO>/`.

**Network — la primera petición de datos.** Es lo que este paso existe para comprobar.

4. Escribir `localhost` en el campo de filtro de Network. **Tiene que quedar vacío.** Una
   sola línea ahí —típicamente en rojo, con `ERR_CONNECTION_REFUSED` contra
   `http://localhost:3000/auth/refresh`— significa bundle envenenado: **no sigas, no
   instales, volvé al Paso 2**.
5. Limpiar el filtro, elegir `Fetch/XHR`, e iniciar sesión. Toda petición de datos tiene que
   ir a `https://api.<DOMINIO>/…`. Ninguna a otro host.
6. Si alguna da `CORS error`: el bundle está bien y `WEB_ORIGINS` del `07` no coincide byte
   a byte con `https://app.<DOMINIO>`. Una barra final basta. Es del `07`, sección 6.
7. Click en el documento `/` → **Headers** → `cache-control: no-cache, must-revalidate`.
   Click en `sw.js` → lo mismo. Click en `index-<hash>.js` →
   `public, max-age=31536000, immutable`.

**Application — el service worker.**

8. **Application → Service workers.** Una sola entrada, `Source: sw.js`, estado
   `#N activated and is running`. Sin `waiting to activate` —eso sería `skipWaiting` sin
   efecto— y sin errores debajo.
9. Dejar `Update on reload` **desmarcado**: queremos ver el comportamiento real, no uno
   forzado por DevTools.

**Application — el manifest y la instalabilidad.**

10. **Application → Manifest.** Tiene que mostrar `Walkthrough`, `Start URL: /`, los dos
    iconos renderizados (192 y 512) y **ningún error en rojo**. Si dice algo como
    `Manifest: Line: 1, column: 1, Syntax error`, el servidor devolvió `index.html` por el
    fallback y el archivo no está publicado.
11. En la sección de instalabilidad no puede quedar ningún motivo listado. El botón
    `Install` de DevTools, o el icono de instalar de la barra de direcciones, tiene que
    estar disponible. **Que aparezca es la prueba**; no hace falta instalarla acá.

**Application — el precache.**

12. **Application → Cache storage.** Una caché llamada
    `serwist-precache-v2-https://app.<DOMINIO>/` con **seis** entradas: `index.html`,
    `manifest.webmanifest`, `icon-192.png`, `icon-512.png`, `assets/index-<hash>.js` y
    `assets/index-<hash>.css`. Menos de seis: la instalación del service worker falló a
    medias y no hay modo offline.

**Si los doce pasan, el bundle se puede instalar. Si alguno falla, no.**

---

### Paso 11 — El modo offline

Es la razón de ser de ADR-001 y del service worker. Se prueba en la **misma** ventana de
incógnito del Paso 10, con el service worker ya activado.

1. **Network → Throttling → `Offline`.** Para una prueba de verdad, mejor todavía: abrir la
   PWA desde un teléfono en la misma red y ponerlo en modo avión.
2. `Ctrl+R` estando en `/`. **Tiene que renderizar.** Si sale la página de error del
   navegador, el precache no está completo: volvé al punto 12 del Paso 10.
3. Escribir `https://app.<DOMINIO>/outbox` en la barra y entrar. Renderiza.
4. Entrar a una inspección asignada y llegar a `/inspections/<id>/capture` **sin red**.
   Renderiza y deja capturar. Eso es lo que `sw.ts` promete en su encabezado: *"abrir,
   navegar y completar una inspección no requiere una sola petición de red"*.
5. Completar unas respuestas, y confirmar que **no hay ninguna petición de red** en Network
   mientras se captura.
6. Volver a poner red y confirmar que el outbox envía.

**Qué NO cubre, y por qué no es un defecto de la publicación.** Abrir **en frío y sin red**
una ruta que no sea `/`, `/inspections/*` o `/outbox` —por ejemplo pegar
`https://app.<DOMINIO>/findings` en una pestaña nueva en modo avión— da la página de error
del navegador. `sw.ts` lo declara: el listener de `fetch` hace `return` sin `respondWith`
para toda ruta que no esté en `CAPTURE_ROUTES`, y la navegación se va a la red.

Dentro de la app, en cambio, ir a `/findings` con un click **sí funciona sin red**: es el
mismo documento y el router es del cliente. Lo que no sobrevive a un arranque en frío sin
red es la primera navegación a esas rutas.

Es una decisión de `sw.ts`, no un agujero de este documento: las tres rutas cubiertas son
exactamente el recorrido del inspector en la planta, que es donde no hay señal. Las demás
son de coordinación, que se hace con red.

**Cómo sé que salió bien.** Con la red cortada, `/`, `/outbox` y
`/inspections/<id>/capture` cargan en frío. Cerrar la ventana de incógnito: todo lo
registrado en esta prueba se va con ella.

---

## 4. Verificación

Bloque completo y repetible. Sirve igual dentro de un mes para confirmar que el cliente
publicado es el que se cree.

```bash
# 1. El artefacto local no tiene localhost horneado, y sí tiene la URL real.
grep -c "localhost:3000" apps/web/dist/assets/*.js           # 0
grep -c "https://api\.<DOMINIO>" apps/web/dist/assets/*.js   # >= 1
```

```bash
# 2. Las dos comprobaciones del build, sin reconstruir.
pnpm --filter web verify:tokens
pnpm --filter web verify:bundle
```

Esperado: `marca: … coincide en index.html y el manifest ✓`,
`service worker: sin builtins de Node ✓` y `precache: … KiB (presupuesto 900 KiB)` con el
primer número por debajo de 900.

```bash
# 3. El bundle servido es el bundle construido.
SERVED=$(curl -s https://app.<DOMINIO>/ | grep -o '/assets/[^"]*\.js')
echo "servido : $SERVED"
echo "local   : /assets/$(ls apps/web/dist/assets | grep '\.js$')"
```

Las dos líneas tienen que ser idénticas.

```bash
# 4. Las cuatro cabeceras.
curl -sI https://app.<DOMINIO>/        | grep -i cache-control   # no-cache
curl -sI https://app.<DOMINIO>/sw.js   | grep -i cache-control   # no-cache
curl -sI "https://app.<DOMINIO>$SERVED" | grep -i cache-control  # immutable
```

```bash
# 5. El fallback SPA, en tres rutas que el service worker no cubre.
for r in /findings /incidents /roster "/accept-invitation?token=x"; do
  echo -n "$r -> "; curl -s -o /dev/null -w '%{http_code}\n' "https://app.<DOMINIO>$r"
done
```

Los cuatro tienen que dar `200`.

```bash
# 6. El manifest se sirve como archivo y no como el index.html del fallback.
curl -s https://app.<DOMINIO>/manifest.webmanifest | head -c 40
```

Tiene que empezar con `{`, no con `<!doctype html>`.

```bash
# 7. El service worker servido es el del build, byte a byte.
curl -s https://app.<DOMINIO>/sw.js | sha256sum
sha256sum apps/web/dist/sw.js
```

```bash
# 8. No quedó ningún asset del build anterior.
ssh <USUARIO>@<HOST_VPS> 'ls /srv/hs-platform/web/assets | wc -l'   # 2
```

**En el navegador**, la parte que ningún `curl` cubre — Paso 10, puntos 4, 8, 10, 11 y 12:
Network sin ninguna línea al filtrar `localhost`, el service worker en
`activated and is running`, el manifest sin errores, la app instalable, y la caché
`serwist-precache-v2-…` con seis entradas.

---

## 5. Criterios de hecho

- [ ] `apps/web/dist/` se construyó sobre un directorio **limpio**
- [ ] `@hs/forms` y `@hs/contracts` se compilaron **antes** que el cliente
- [ ] `grep "localhost:3000" apps/web/dist/assets/*.js` devuelve `0`
- [ ] El origen https de la API aparece en `apps/web/dist/assets/*.js`
- [ ] `check-tokens.mjs` pasó: `--brand`, `index.html` y el manifest coinciden
- [ ] `check-service-worker.mjs` pasó: sin builtins de Node y por debajo de 900 KiB
- [ ] El número de `precache: … KiB` quedó **anotado**, para comparar en el próximo release
- [ ] `PRECACHE_BUDGET_BYTES` **no se tocó** en este despliegue (o si se tocó, fue en un
      commit propio y solo, con la razón escrita)
- [ ] El bundle está en `/srv/hs-platform/web/`, con `index.html` en la raíz de ese
      directorio y no dentro de un `dist/`
- [ ] `/srv/hs-platform/web` no es de `root`
- [ ] `assets/` del VPS tiene exactamente dos archivos
- [ ] El `sha256` de `sw.js` servido coincide con el local
- [ ] El `index.html` servido referencia el asset de **este** build
- [ ] `/` y `/sw.js` se sirven con `no-cache`; `/assets/*` con `immutable`
- [ ] `/findings`, `/incidents`, `/roster` y `/accept-invitation?token=…` devuelven `200`
- [ ] `/manifest.webmanifest` devuelve JSON, no HTML
- [ ] En incógnito, **ninguna** petición a `localhost`
- [ ] En incógnito, la primera petición de datos va a `api.<DOMINIO>`
- [ ] El service worker queda `activated and is running`
- [ ] El manifest carga sin errores y la app es **instalable**
- [ ] La caché `serwist-precache-v2-…` tiene seis entradas
- [ ] Sin red: `/`, `/outbox` y `/inspections/<id>/capture` cargan en frío
- [ ] Nadie instaló la PWA en un teléfono antes de que todo lo anterior pasara

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `grep localhost:3000` en `dist/assets/*.js` devuelve `1` | El build corrió sin `VITE_API_BASE_URL` | Paso 1 y Paso 2 de nuevo, con la variable prefijada al comando. **Nada se arregla sin reconstruir.** Si ya se publicó, ver más abajo |
| La variable estaba puesta y el bundle igual tiene `localhost` | Se puso en el `.env` de la raíz del repo | Vite lee sus `.env` desde `apps/web/`. El `.env` de la raíz **no existe para el build**. Va prefijada al comando |
| El build falla hablando de `--brand` y del manifest | Alguien cambió un color y actualizó dos de los tres lugares | Es `check-tokens.mjs`, no el despliegue. Se arregla en el repo, en una línea, y se commitea. Paso 5 |
| `El precache supera el presupuesto` | `dist/` sucio, o crecimiento real | En ese orden: limpiar y reconstruir (Paso 1); averiguar qué entró; **recién después** subir `PRECACHE_BUDGET_BYTES`, en un commit propio y solo. Paso 4 |
| `El service worker construido nombra builtins de Node` | Una dependencia transitiva metió un builtin adentro del bundle | No se desactiva la comprobación: la conversación es sobre ADR-007. Buscar qué dependencia entró; el lint del paquete no lo iba a ver |
| `rsync` da `Permission denied` | Docker creó `/srv/hs-platform/web` como `root` al levantar `caddy` en el `03` | Paso 8: `sudo chown -R $USER /srv/hs-platform/web` |
| `app.<DOMINIO>/` sigue dando 404 con el bundle publicado | Falta la barra final en `apps/web/dist/` y quedó `/srv/hs-platform/web/dist/` | `ls /srv/hs-platform/web`. Repetir el Paso 9 con la barra |
| Se publicó y Caddy sigue sirviendo lo viejo, sin errores | Se reemplazó el **directorio** en vez de su contenido | El bind mount apunta al inodo original. `docker compose --env-file .env.prod -f compose.prod.yml restart caddy` lo destraba, pero la forma correcta es el `rsync` in situ del Paso 9 |
| Un refresh en `/findings` da 404 | Falta el fallback SPA | Es del `03`: `try_files {path} /index.html` en el bloque `app.`. Sección 7 |
| El link de invitación da 404 la primera vez | Lo mismo | Idem. Y es peor de lo que parece: las invitaciones se entregan a mano por link (H18), así que es el único camino de alta de un usuario |
| Application → Manifest muestra un error de sintaxis | El manifest no está publicado y lo respondió el fallback con `index.html` | `curl -s .../manifest.webmanifest \| head -c 40`. Repetir el Paso 9 |
| La app no es instalable y el manifest carga bien | `scope` o `start_url` no contienen la URL servida, o el service worker no activó | Paso 6. En esta topología los tres son `/`, así que casi siempre es el service worker: mirar Application → Service workers |
| El service worker queda en `waiting to activate` | Un service worker viejo de otra prueba en la misma ventana | Application → Service workers → `Unregister`, cerrar la ventana de incógnito y repetir. En un dispositivo real, ver la sección 8 |
| Todas las pantallas dicen «Failed to fetch» y la API está sana | `WEB_ORIGINS` no coincide byte a byte con el origen | Es del `07`, sección 6, verificación 5. Una barra final basta |
| Sin red, `/` da la página de error del navegador | El precache quedó incompleto o el service worker no instaló | Application → Cache storage: tienen que ser seis entradas. Si son menos, reconstruir y republicar |
| Sin red, `/findings` da error en frío | **No es un fallo.** `sw.ts` cubre `/`, `/inspections/*` y `/outbox` | Paso 11, «Qué NO cubre» |

**Punto de retroceso.** Mientras nadie haya instalado la PWA, este documento es
**completamente reversible**: se reconstruye, se vuelve a publicar con `rsync` y no quedó
rastro. El artefacto no tiene estado. **Ese margen se termina en el `09`**, en el momento en
que el primer inspector instala la aplicación: a partir de ahí el bundle vive en teléfonos
que no controlás.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | **Confirmado, sin cambios:** el bloque `app.` cubre los cuatro requisitos. Fallback SPA (`try_files {path} /index.html`), `sw.js` con `no-cache`, `assets/*` con `immutable`, y `/` + `/index.html` con `no-cache` |
| `03-infraestructura.md` | **Ya aplicado:** toda respuesta HTML lleva `Cache-Control: no-cache`; se verifica sobre la respuesta real en el Paso 10.1 |
| `03-infraestructura.md` | **Ya aplicado:** `/assets/*` queda fuera del fallback SPA, de modo que un asset faltante devuelve `404` y no `index.html` |
| `03-infraestructura.md` | **Ya aplicado:** manifest e iconos tienen cabeceras explícitas y el manifest se sirve como JSON |
| `03-infraestructura.md` | **Ya aplicado:** el Paso 3 crea `/srv/hs-platform/web` antes de levantar Caddy |
| `07-entorno-y-release.md` | **Confirmado:** `VITE_API_BASE_URL` se consume en el Paso 2 de este documento, en el comando de build. El valor no se muestra acá. Y tiene que ser el mismo origen que está en `WEB_ORIGINS`, byte a byte: son los dos extremos del mismo CORS |
| `07-entorno-y-release.md` | El redeploy del cliente **no es** `up -d --no-deps api`. Es reconstruir y volver a publicar, y hay que hacerlo cada vez que cambia `VITE_API_BASE_URL` o el dominio. Ver «Redeploy del cliente», abajo |
| `09-puesta-en-marcha.md` | **Ningún teléfono instala la PWA hasta que el Paso 10 de este documento haya pasado entero.** La primera instalación es el punto de no retorno de esta etapa |
| `09-puesta-en-marcha.md` | El link de invitación llega a `/accept-invitation?token=…`, que **no** es una ruta cubierta por el service worker: depende del fallback SPA. Está verificado en el Paso 10.1 |
| `10-operacion.md` | En cada release del cliente: anotar el número de `precache: … KiB` y compararlo con el anterior, y repetir la verificación 3 de la sección 4 (que el `index.html` servido referencia el asset de ese build) |
| `10-operacion.md` | `PRECACHE_BUDGET_BYTES` tiene hoy **18.4 KiB** de holgura sobre 881.6 KiB medidos. Es la clase de número que conviene mirar antes de aceptar una dependencia nueva, no después |

---

## 8. Riesgos con datos reales

### Un bundle envenenado instalado en los teléfonos de una planta

Es el riesgo que organiza este documento entero.

**Qué pasa.** Se construye sin `VITE_API_BASE_URL`, se publica, y quince inspectores
instalan la PWA. El bundle apunta a `http://localhost:3000`. El service worker precachea
`index.html` y los dos assets, y con `skipWaiting` + `clientsClaim` toma el control de
inmediato. La app **abre**, se ve perfecta y no puede hablar con nada. Y no falla en un
dispositivo: falla en los quince a la vez, el mismo día.

**Por qué es caro.** No hay nada del lado del servidor que se pueda cambiar. El valor está
horneado en un archivo que ya está en el disco de cada teléfono. No hay push, no hay forma
de forzar una actualización, y no hay un canal para avisarles: las invitaciones se entregan
a mano, no hay correo transaccional (H18).

**Cómo se reemplaza un bundle envenenado ya instalado.**

1. **Reconstruir y republicar**, Pasos 1 a 9, esta vez con la variable. El nombre del asset
   cambia porque Vite lo hashea por contenido, y el nombre del asset está **adentro** de la
   lista de precache de `sw.js`, así que `sw.js` cambia de bytes. Eso es lo que dispara la
   actualización: el navegador compara ese archivo.

   ```bash
   curl -s https://app.<DOMINIO>/sw.js | sha256sum
   sha256sum apps/web/dist/sw.js
   ```

2. **Cada dispositivo tiene que abrir la app una vez, con red.** El navegador comprueba
   `/sw.js` en las navegaciones dentro del alcance y, como mucho, cada 24 horas. Ve el
   archivo nuevo, instala el service worker nuevo, y `skipWaiting` + `clientsClaim` lo
   ponen a mandar sin esperar a que se cierren las pestañas. Después de eso, el bundle
   correcto.

   > La misma decisión que hace peligroso el envenenamiento —`skipWaiting` +
   > `clientsClaim`— es la que hace viable la recuperación. Sin ellas, el bundle nuevo
   > quedaría en `waiting` hasta que el inspector cerrara todas las pestañas de la PWA, que
   > en un teléfono puede no pasar en semanas.

3. **Un dispositivo que nunca vuelve a tener red nunca se actualiza.** No hay nada que
   hacer desde el servidor. Alguien tiene que ir con el teléfono a donde haya señal y abrir
   la app.

4. **Si un teléfono concreto sigue con el bundle viejo** después de abrirlo con red —caché
   intermedia, un `sw.js` que se sirvió mal en su momento— la salida es borrar los datos del
   sitio y reinstalar:
   - Android/Chrome: `⋮` → Configuración del sitio → `app.<DOMINIO>` → Borrar datos, y
     volver a instalar la PWA.
   - iOS/Safari: Ajustes → Safari → Avanzado → Datos de sitios web → eliminar el sitio.

   > **Borrar los datos del sitio borra IndexedDB.** Con ella se van los borradores y
   > **cualquier envío que siga en el outbox sin haber salido**. ADR-001 acepta perder
   > borradores, pero un envío pendiente es trabajo de campo hecho. **Antes de borrar, el
   > indicador permanente tiene que decir que no queda nada por sincronizar.** Si queda
   > algo y el bundle está envenenado, el outbox no va a poder vaciarse: hay que republicar
   > el bundle correcto primero, dejar que el teléfono se actualice y el outbox drene, y
   > **recién entonces** —si todavía hiciera falta— borrar.

**Cómo se evita.** El Paso 3 (el `grep` sobre `dist/assets/*.js`) y el Paso 10 (la ventana
de incógnito) cuestan tres minutos entre los dos, y se hacen **antes** de que exista un solo
teléfono con la app. El único punto de no retorno de este documento es la primera
instalación, y está en el `09`.

### `sw.js` servido con caché larga

Segunda forma del mismo desastre, y peor: si `sw.js` queda cacheado por mucho tiempo en un
intermediario, el mecanismo del punto 2 de arriba —el único que existe— deja de funcionar.
Los teléfonos quedan clavados en la versión que tengan, sea cual sea. Se evita con el
requisito (b) del Paso 7, verificado en el Paso 10.1.

### Un redeploy a medias

Con `index.html` nuevo y assets viejos en el disco, o al revés, la app queda rota para
quien entre en esa ventana —y si el service worker alcanza a precachear un estado
inconsistente, queda rota **offline** hasta el próximo cambio de `sw.js`. Se evita con el
`rsync --delay-updates --delete-delay` del Paso 9, que reduce la ventana a un lote de
renames, y con la verificación 3 de la sección 4.

### Bajar el presupuesto de precache por comodidad

Subir `PRECACHE_BUDGET_BYTES` para que el build pase no rompe nada hoy. Rompe el día en
que el precache es lo bastante grande como para que la instalación no termine en una planta
con una barra de señal, y ese día el síntoma es «la app no me anduvo» sin un solo error en
ningún log. El número sube en un commit propio, solo, con la razón escrita.

---

## Redeploy del cliente

No es el redeploy de la API. La API se reemplaza con `up -d --no-deps api` (`07`); el
cliente se **reconstruye y se republica**, porque su configuración está horneada.

```bash
# 1. El árbol correcto, y el mismo commit que API_TAG.
git rev-parse --short HEAD

# 2. Reconstruir desde limpio.
rm -rf apps/web/dist packages/forms/dist packages/contracts/dist
pnpm --filter contracts --filter forms build
VITE_API_BASE_URL=<EL_VALOR_QUE_FIJA_EL_07> pnpm --filter web build

# 3. Verificar el artefacto ANTES de publicar.
grep -c "localhost:3000" apps/web/dist/assets/*.js    # 0

# 4. Publicar in situ.
rsync -av --checksum --delay-updates --delete-delay \
  apps/web/dist/ <USUARIO>@<HOST_VPS>:/srv/hs-platform/web/

# 5. El index.html servido referencia el asset de este build.
curl -s https://app.<DOMINIO>/ | grep -o '/assets/[^"]*'
```

**Hay que reconstruir y republicar, sí o sí, cuando cambia:** `VITE_API_BASE_URL`, el
dominio de la API, el color de marca (los tres lugares de `check-tokens.mjs`), el manifest,
los iconos, o cualquier cosa de `apps/web`, `packages/forms` o `packages/contracts`.

**Rollback.** Es el único rollback de esta instalación que es barato: el bundle es un
artefacto sin estado. Reconstruir desde el commit anterior y volver a publicar con el mismo
`rsync`. El service worker se actualiza solo en cuanto cada dispositivo abra la app con red,
por el mismo mecanismo de la sección 8.

---

## Referencias

- `docs/deployment/README.md` — el grupo C de variables, la propiedad de artefactos, H9 y H10
- `docs/deployment/03-infraestructura.md` — dueño del `Caddyfile` y del bind mount `./web`
- `docs/deployment/07-entorno-y-release.md` — dueño del valor de `VITE_API_BASE_URL`
- `apps/web/src/api/client.ts` — la única lectura de `VITE_API_BASE_URL`, con su default
- `apps/web/src/sw.ts` — `CAPTURE_ROUTES`, `skipWaiting`, `clientsClaim` y el catch handler
- `apps/web/src/offline/storage.ts` — el `register('/sw.js', { scope: '/' })`
- `apps/web/vite.config.ts` — `injectManifest`, `globPatterns` y por qué el precache va completo
- `apps/web/scripts/check-service-worker.mjs` — el presupuesto y la comprobación de ADR-007
- `apps/web/scripts/check-tokens.mjs` — el acoplamiento de `--brand` con el manifest
- `apps/web/public/manifest.webmanifest` — `id`, `start_url` y `scope` en `/`
- ADR-001 — el offline no es sincronización; se acepta perder borradores
- ADR-007 — `packages/forms` viaja en el bundle del service worker
- ADR-010 — persistencia e instalación en pantalla de inicio
- ADR-012 — el presupuesto de precache como objeción a responder
