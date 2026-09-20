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
