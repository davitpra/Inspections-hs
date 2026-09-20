# 02 — La imagen de la API

**Qué resuelve.** Deja construida y arrancable la imagen de `apps/api`, con todo lo que el
despliegue necesita adentro: el proceso de larga vida, las migraciones, los seeds y los
comandos de administración. Al salir de este documento existe una imagen etiquetada y
verificada, todavía sin infraestructura alrededor.

**Qué NO resuelve.** El `compose.prod.yml` y el `Caddyfile` son del `03`. Los valores de
las variables de entorno son del `07`. El bundle del cliente es del `06`: **no se construye
en esta imagen**.

**Artefactos que este documento crea o modifica.**

- `Dockerfile` (raíz del repo) — nuevo
- `.dockerignore` (raíz del repo) — nuevo

Si un paso te lleva a tocar algo que no está en esta lista, pará: es de otro documento.

---

## 1. Precondiciones

### El `01` está ejecutado

El preflight corrige `GET /health`, que es lo que el healthcheck del `03` va a consultar.
Sin eso la imagen se construye igual, pero el contenedor va a parecer enfermo para siempre.

```bash
grep -n "@Public()" apps/api/src/app.controller.ts
```

Tiene que devolver una línea. Si no devuelve nada, volvé al `01`.

### El repositorio construye

```bash
pnpm install --frozen-lockfile && pnpm -r build
```

Termina sin error. Si falla acá, falla adentro del contenedor y con menos información.

### Docker con BuildKit

```bash
docker buildx version
```

Tiene que responder con una versión. El `Dockerfile` usa `--mount=type=cache`, que es
sintaxis de BuildKit. Docker 23 y posteriores lo traen activado por defecto.

### El árbol está limpio

```bash
git status --porcelain
```

Vacío, salvo los dos archivos que este documento crea. Una imagen construida sobre cambios
sin commitear es una imagen que nadie puede reproducir.

---

## 2. Decisiones ya tomadas

| # | Decisión | Por qué |
| --- | --- | --- |
| D1 | **Una sola imagen**, sin `pnpm install --prod` en la etapa final | `drizzle-kit` es devDependency y las migraciones, seeds y scripts viven fuera de `dist/`. Una imagen podada no puede migrar ni crear la primera cuenta |
| D2 | Los comandos one-off se corren con `docker compose run --rm` **sobre esta misma imagen** | No hay una segunda imagen que mantener sincronizada |
| D3 | `working_dir` de la API: `/app/apps/api` | `drizzle-kit` resuelve `drizzle.config.ts` y `./drizzle` contra el cwd |
| D4 | `ENTRYPOINT` en **forma exec**, nunca forma shell | En forma shell Node no es PID 1 y no recibe SIGTERM. Ver el Paso 2 |
| D5 | Node 22.12 o superior, comprobado **dentro** de la imagen | Ver el Paso 1 |
| D6 | `apps/web` **no** se construye acá | El cliente es un bundle estático que sirve Caddy. Necesita `VITE_API_BASE_URL` en su propio build, y eso es del `06` |

---

## 3. Pasos

### Paso 1 — Por qué la imagen fija Node 22.12

`apps/api/package.json` declara `"type": "commonjs"`. `packages/forms` y
`packages/contracts` declaran `"type": "module"` y exportan ESM:

```bash
grep -h '"type"' apps/api/package.json packages/forms/package.json packages/contracts/package.json
```

Un CommonJS no podía hacer `require()` de un ESM. Node 22.12 lo permite, sin flag. Por eso
`package.json` de la raíz fija:

```json
"engines": { "node": ">=22.12.0" }
```

**El modo de falla es el peor posible: la imagen construye bien y el contenedor muere al
arrancar**, con un `ERR_REQUIRE_ESM` que no menciona ni el monorepo ni la versión de Node.

Hay dos redes de contención, y el `Dockerfile` usa las dos:

1. `.npmrc` fija `engine-strict=true`, así que `pnpm install` se niega con una versión
   incorrecta. Leelo: el archivo explica que esto existe para que CI y tu máquina no
   diverjan en silencio.
2. Una comprobación explícita en la primera etapa, que falla el build con un mensaje que sí
   dice qué pasa.

No hace falta ejecutar nada en este paso. Es el porqué del `Dockerfile` que viene.

### Paso 2 — Por qué el entrypoint va en forma exec

`apps/api/src/shutdown.ts` registra los manejadores así:

```bash
grep -n "process.once" apps/api/src/shutdown.ts
```

`process.once('SIGTERM')` solo recibe la señal **si el proceso de Node es PID 1**. Con un
`ENTRYPOINT` en forma shell, Docker arranca `/bin/sh -c "node dist/main"`: el PID 1 es el
shell, que no reenvía la señal, y Node nunca se entera.

Lo que se pierde si eso pasa está escrito en el encabezado de `shutdown.ts`, y no es menor:
el cierre está invertido a mano para que el servidor HTTP deje de aceptar conexiones
**antes** de que se cierre el pool de la base. Sin ese orden, un envío que llega durante el
redeploy abre su transacción contra un pool cerrado y muere en 500.

Entonces:

```dockerfile
ENTRYPOINT ["node", "dist/main"]
```

Con corchetes. Nunca `ENTRYPOINT node dist/main`.

### Paso 3 — Crear el `Dockerfile`

En la raíz del repositorio.

```bash
cat > Dockerfile <<'EOF'
# La imagen de apps/api. Ver docs/deployment/02-imagen-api.md.
#
# UNA SOLA IMAGEN, y no una de runtime más una de migraciones. `drizzle-kit` es
# devDependency, y las migraciones (apps/api/drizzle), los seeds (apps/api/seeds) y los
# comandos de administración (apps/api/scripts) viven FUERA de dist/. Una imagen podada
# con --prod se queda sin forma de migrar y sin forma de crear la primera cuenta.

# ---------------------------------------------------------------------------
# base — la versión de Node es load-bearing, no una preferencia.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS base

# apps/api es CommonJS y consume @hs/forms y @hs/contracts, que son ESM. Eso se sostiene
# en require(esm), que quedó sin flag en Node 22.12. Con Node 20 la imagen CONSTRUYE y el
# contenedor muere al arrancar con ERR_REQUIRE_ESM, que no menciona nada de esto.
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a<22||(a===22&&b<12)) { console.error('Node '+process.versions.node+': se necesita >=22.12 por require(esm). Ver docs/deployment/02-imagen-api.md'); process.exit(1); }"

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack toma la versión de pnpm pineada con hash en el package.json de la raíz.
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# build — instala el workspace y compila la cadena forms -> contracts -> api.
# ---------------------------------------------------------------------------
FROM base AS build

# Los manifiestos primero: mientras no cambien, la capa de instalación se reusa.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/forms/package.json packages/forms/
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/

# `--filter api...` instala apps/api y SUS dependencias del workspace. Deja afuera a
# apps/web con vite y esbuild, que no se construyen acá (el bundle del cliente es del
# documento 06). Sin --prod: drizzle-kit tiene que quedar.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter api...

COPY . .

# El orden lo resuelve pnpm por el grafo del workspace: @hs/contracts depende de
# @hs/forms, y los dos se consumen por sus `exports` -> dist. Sin compilarlos, apps/api
# no tipa ni resuelve.
RUN pnpm --filter @hs/forms --filter @hs/contracts --filter api build

# ---------------------------------------------------------------------------
# runtime — el árbol construido, sin las cachés del build.
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production

# El árbol entero, con los symlinks intactos. .npmrc fija node-linker=hoisted, y su
# comentario advierte que un fallo de resolución "no aparece en dev — aparece en el primer
# deploy". COPY preserva los symlinks de los paquetes del workspace: no los sigas ni los
# aplanes.
COPY --from=build /app /app

# drizzle-kit resuelve drizzle.config.ts y ./drizzle contra el cwd. Es también el cwd de
# los comandos one-off (docker compose run --rm).
WORKDIR /app/apps/api

EXPOSE 3000

# FORMA EXEC, con corchetes. En forma shell el PID 1 sería /bin/sh, Node no recibiría
# SIGTERM y el apagado ordenado de shutdown.ts no correría nunca.
ENTRYPOINT ["node", "dist/main"]
EOF
```

**Cómo sé que salió bien.** El archivo existe y no hay un solo valor de variable adentro:

```bash
test -f Dockerfile && ! grep -qE "^(ENV|ARG) (DATABASE_URL|BETTER_AUTH|S3_|WEB_ORIGINS)" Dockerfile && echo "sin secretos horneados"
```

### Paso 4 — Crear el `.dockerignore`

Sin este archivo, el contexto de build incluye `node_modules` y `dist` de tu máquina. Eso
no solo es lento: un `dist` sucio local puede terminar adentro de la imagen y tapar lo que
el build produce.

```bash
cat > .dockerignore <<'EOF'
# Ver docs/deployment/02-imagen-api.md.
#
# OJO: NO excluyas apps/web ni packages/* enteros. pnpm-workspace.yaml declara
# `apps/*` y `packages/*`, y `pnpm install --frozen-lockfile` falla si un miembro
# del workspace declarado en el lockfile no está en el contexto.

# Lo que se reconstruye adentro. `dist` es el importante: uno sucio de tu máquina
# no puede entrar a la imagen.
node_modules
**/node_modules
dist
**/dist
build
**/build
*.tsbuildinfo
.turbo

# Secretos. La imagen no lleva variables horneadas: todas vienen del entorno del
# contenedor (start:prod es `node dist/main` y no lee ningún .env).
.env
.env.*
!.env.example

# Historia y metadatos: engordan el contexto y no los usa ningún paso del build.
.git
.github
.vscode
.idea

# Documentación y especificaciones.
docs
openspec
*.md
!README.md

# Pruebas y sus artefactos.
**/*.spec.ts
**/*.test.ts
**/*.test.tsx
apps/api/test
coverage
**/coverage
playwright-report
test-results
.vitest
**/.vite

# Infraestructura de desarrollo. El compose de producción es otro archivo y lo
# monta el VPS, no la imagen.
docker-compose.yml
db/init

# Sistema.
.DS_Store
*.log
EOF
```

**Cómo sé que salió bien.** El contexto se achicó. Comparalo:

```bash
docker build --no-cache -t hs-platform-api:probe . 2>&1 | head -3
```

La primera línea informa el tamaño del contexto transferido. Tiene que estar en el orden de
unos pocos MB, no de cientos.

### Paso 5 — Construir la imagen

El tag sigue el contrato de nombres del `README.md`: `hs-platform-api:<tag>`. Usá el hash
corto del commit, no `latest`: un `latest` hace imposible saber qué está corriendo.

```bash
TAG=$(git rev-parse --short HEAD)
docker build -t "hs-platform-api:${TAG}" .
echo "construida: hs-platform-api:${TAG}"
```

**Cómo sé que salió bien.** La imagen existe y pesa lo esperable:

```bash
docker images hs-platform-api --format '{{.Tag}}\t{{.Size}}'
```

#### El caso del seed editado, y por qué se commitea

El `04` edita `apps/api/seeds/004_bootstrap_coordinator.sql` con los datos reales del
coordinador, y esa edición **tiene que estar dentro de la imagen**: `seed.mjs` resuelve
`../seeds` relativo a sí mismo, así que lo que se siembra es el archivo de
`/app/apps/api/seeds/`, no el del VPS.

Eso deja una decisión que hay que tomar acá, porque `.dockerignore` excluye `.git` y el
build usa el árbol de trabajo: una imagen puede construirse sobre una edición sin
commitear, y entonces `git rev-parse --short HEAD` etiqueta algo que ese commit no
contiene.

**La convención es: se commitea, en un commit propio, y se etiqueta con ese commit.**

El motivo es el rollback. Una imagen construida sobre un árbol sucio **no se puede
reconstruir**: si se pierde, no hay forma de volver a la versión que estaba corriendo. Y un
`git stash` distraído se lleva la edición sin que nadie lo note.

Sobre la objeción razonable —que commitear pone el nombre, el legajo y el email del
coordinador en la historia de git— la respuesta es que el repositorio es privado y de una
sola persona, y que ese dato ya va a estar en la base, en los backups del `08` y en la
imagen. No es el mismo caso que el del `README.md`, que el `01` decidió no tocar: ahí el
dato quedaría publicado **como documentación**, para cualquiera que abra el archivo.

Lo que no es negociable, en ninguna de las dos variantes: **no reusar el tag anterior**. Dos
imágenes distintas con la misma etiqueta hacen imposible saber qué está corriendo.

### Paso 6 — Decidir dónde se construye

Hay una decisión real acá, y depende de tu VPS.

`pnpm install` más `tsc -b` más `nest build` en una máquina de 1 GB de RAM puede morir por
OOM. El síntoma es un build que se corta sin mensaje, o un `Killed` a secas.

**Camino recomendado: construir local y transferir.** No depende de la RAM del VPS y no
pone las fuentes en el servidor.

```bash
TAG=$(git rev-parse --short HEAD)
docker save "hs-platform-api:${TAG}" | gzip | ssh <USUARIO>@<HOST_VPS> 'gunzip | docker load'
```

Verificalo del otro lado:

```bash
ssh <USUARIO>@<HOST_VPS> "docker images hs-platform-api --format '{{.Tag}}'"
```

**Camino alternativo: construir en el VPS.** Solo si la máquina tiene 2 GB o más, o si le
declarás swap. Con menos de eso vas a perder más tiempo del que ahorrás.

Si elegís este camino, el swap lo declara el `03`: está anotado en la sección 7.

---

## 4. Verificación

Se corre entera, en orden. Es repetible: dentro de un mes tiene que dar lo mismo.

```bash
TAG=$(git rev-parse --short HEAD)

# 1. La versión de Node adentro de la imagen.
docker run --rm --entrypoint node "hs-platform-api:${TAG}" --version
```

Tiene que imprimir `v22.12.0` o superior. Si imprime v20.x, la imagen no sirve: cambiá la
etiqueta de `FROM` y reconstruí.

```bash
# 2. Los paquetes del workspace resuelven desde apps/api. Esto es lo que
#    node-linker=hoisted tiene que garantizar, y lo que falla "solo en el deploy".
docker run --rm --entrypoint node "hs-platform-api:${TAG}" \
  -e "require('@hs/contracts'); require('@hs/forms'); console.log('los dos resuelven')"
```

```bash
# 3. drizzle-kit está presente y encuentra su configuración con el cwd correcto.
docker run --rm --entrypoint pnpm "hs-platform-api:${TAG}" exec drizzle-kit --version
docker run --rm --entrypoint ls "hs-platform-api:${TAG}" -1 drizzle/meta/_journal.json drizzle.config.ts
```

```bash
# 4. Los seeds y los comandos de administración sobrevivieron a la imagen.
docker run --rm --entrypoint ls "hs-platform-api:${TAG}" -1 seeds scripts
```

```bash
# 5. El proceso valida el entorno ANTES de abrir nada. Sin variables tiene que
#    fallar, y el mensaje tiene que nombrar las variables que faltan.
docker run --rm "hs-platform-api:${TAG}" 2>&1 | head -20
```

Lo esperado es un `EnvError` de `apps/api/src/env.ts`, con la lista completa de problemas en
una sola pasada y **sin mostrar ningún valor** — los mensajes nombran la variable y el
problema, nunca el contenido, porque la mitad son secretos y este log termina en la consola
del servidor.

Si en vez de eso ves un `ERR_REQUIRE_ESM`, volvé al paso 1: la versión de Node está mal.

```bash
# 6. El apagado ordenado. Arrancá el contenedor y mandale SIGTERM.
docker run --rm -d --name hs-sigterm-probe --entrypoint node "hs-platform-api:${TAG}" \
  -e "process.once('SIGTERM',()=>{console.log('SIGTERM recibida por PID '+process.pid);process.exit(0)}); setInterval(()=>{},1000)"
sleep 1
docker stop hs-sigterm-probe
docker logs hs-sigterm-probe 2>&1 || true
```

Tiene que imprimir `SIGTERM recibida por PID 1`. Si dice otro PID, o si `docker stop` tarda
diez segundos y no imprime nada, el entrypoint quedó en forma shell.

---

## 5. Criterios de hecho

- [ ] `Dockerfile` y `.dockerignore` existen en la raíz y están commiteados
- [ ] `docker build` termina sin error sobre un árbol limpio
- [ ] `node --version` dentro de la imagen devuelve 22.12.0 o superior
- [ ] `require('@hs/contracts')` y `require('@hs/forms')` resuelven dentro de la imagen
- [ ] `drizzle-kit --version` responde, y `drizzle/meta/_journal.json` está presente
- [ ] `seeds/` y `scripts/` están presentes en `/app/apps/api`
- [ ] El contenedor sin variables falla con el `EnvError` de `env.ts`, no con `ERR_REQUIRE_ESM`
- [ ] La sonda de SIGTERM imprime `PID 1`
- [ ] El `Dockerfile` no contiene ningún valor de variable ni secreto
- [ ] La imagen está etiquetada con el hash corto del commit, no con `latest`
- [ ] Está decidido y anotado dónde se construye: local con `docker save`, o en el VPS

---

## 6. Si falla

| Síntoma | Causa probable | Qué hacer |
| --- | --- | --- |
| `ERR_PNPM_UNSUPPORTED_ENGINE` durante el install | La etiqueta de `FROM` trae Node < 22.12. Es `engine-strict=true` haciendo su trabajo | Cambiar la etiqueta base. **No** quites `engine-strict`: te está salvando del fallo silencioso |
| `ERR_PNPM_OUTDATED_LOCKFILE` | El `pnpm-lock.yaml` del contexto no coincide con los `package.json` | Correr `pnpm install` en la máquina, commitear el lockfile y reconstruir. No uses `--no-frozen-lockfile` en un build de producción |
| `ERR_PNPM_IGNORED_BUILDS` | Falta una entrada en `allowBuilds` de `pnpm-workspace.yaml` | Leé el comentario de ese archivo antes de tocarlo: las entradas en `false` están así a propósito |
| `Cannot find module '@hs/contracts'` al arrancar | Los symlinks del workspace no sobrevivieron a la copia | Verificá que la etapa de runtime use `COPY --from=build /app /app` y no copias parciales por subdirectorio |
| `ERR_REQUIRE_ESM` al arrancar, con el build en verde | Node < 22.12 en la etapa de runtime. Pasa si `base` y `runtime` divergieron | Las dos etapas tienen que salir del mismo `FROM base`. Reconstruí sin caché |
| `Killed` a mitad del build, sin más mensaje | OOM en el VPS | Construir local y transferir con `docker save`, o declarar swap (pedido al `03`) |
| `drizzle-kit: not found` | Se coló un `--prod` en el install | Quitalo. Esa poda es exactamente lo que D1 prohíbe |
| `Cannot find drizzle.config.ts` | El `working_dir` no es `/app/apps/api` | Corregir el `WORKDIR` de la etapa de runtime |
| El contexto de build pesa cientos de MB | El `.dockerignore` no se está aplicando | Tiene que estar en la **raíz del repo**, que es desde donde se corre `docker build .` |
| Binarios nativos que fallan tras cambiar a Alpine | musl en vez de glibc | Volvé a `node:22-bookworm-slim`. La imagen es unos 40 MB más grande y no vale la pena pelearla |

**Punto de retroceso.** Todo lo de este documento es reversible: `rm Dockerfile
.dockerignore` y `docker image rm` dejan el repositorio como estaba. Ninguna acción de acá
toca una base de datos, un bucket ni un dato. Es el último documento del que se puede decir
eso.

---

## 7. Lo que este documento le pide a otro

| Documento | Qué necesita |
| --- | --- |
| `03-infraestructura.md` | Declarar `stop_grace_period: 30s` en el servicio `api`. El default de Compose es 10 s y `SHUTDOWN_GRACE_MS` vale 8000: quedan 2 s de margen, que no alcanzan para que pg-boss termine sus trabajos en vuelo |
| `03-infraestructura.md` | `working_dir: /app/apps/api` en el servicio `api` y en todo `run --rm`, o `drizzle-kit` no encuentra su configuración |
| `03-infraestructura.md` | Si se decidió construir en el VPS: declarar swap, y cuánto. Con menos de 2 GB de RAM el build muere por OOM |
| `03-infraestructura.md` | El healthcheck del servicio `api` va contra `GET /health`, que el `01` hizo público |
| `07-entorno-y-release.md` | La imagen no hornea ninguna variable. Todas, sin excepción, vienen del entorno del contenedor |
| `04`, `09` | Los comandos one-off se corren sobre esta misma imagen con `docker compose run --rm`, no sobre una imagen aparte |

---

## 8. Riesgos con datos reales

Este documento no toca datos. Lo que puede romper llega después, por una imagen mal
construida que nadie verificó.

**Node por debajo de 22.12.** El build queda en verde y el contenedor muere al arrancar. Si
eso pasa durante un redeploy, la API se cae con inspectores en la planta. Lo evita la
comprobación del `FROM base`, que falla el build en vez de diferir el problema. **No la
quites para "destrabar" un build.**

**Entrypoint en forma shell.** No se nota nunca, hasta el primer redeploy con tráfico: los
requests en vuelo se cortan y pg-boss no termina sus trabajos. La idempotencia de
`client_submission_id` hace que el outbox lo reintente sin perder datos (ADR-001), pero un
redeploy no debería depender de eso. Lo detecta la sonda de SIGTERM de la sección 4.

**Una imagen etiquetada `latest`.** El día que haya que hacer rollback, nadie va a poder
decir qué versión estaba corriendo. Etiquetá siempre con el hash del commit.

---

## Referencias

- `docs/deployment/README.md` — contrato de nombres, grupos de variables, propiedad de artefactos
- `.npmrc` — `node-linker=hoisted` y `engine-strict=true`, con su porqué escrito
- `pnpm-workspace.yaml` — los miembros del workspace y el mapa `allowBuilds`
- `apps/api/src/shutdown.ts` — el orden de apagado invertido, y por qué depende de recibir SIGTERM
- `apps/api/src/env.ts` — qué valida, y por qué los mensajes nunca muestran valores
- `apps/api/drizzle.config.ts` — por qué el `working_dir` importa
- ADR-013 — por qué ya no hace falta Chromium, y por qué la imagen es liviana
