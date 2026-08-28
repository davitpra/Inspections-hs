# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Idioma

Código, comentarios, ADRs y commits: **español**. UI y contenido de la aplicación:
**solo inglés, sin i18n** (`openspec/config.yaml`). Los requisitos de las specs se
escriben en inglés con sintaxis EARS.

## Comandos

```bash
pnpm setup                       # db:up + db:migrate + db:jobs:install + db:seed
pnpm dev                         # API en :3000 y PWA en :5173, en una sola terminal

pnpm --filter api start:dev      # o cada uno por separado, en dos terminales
pnpm --filter web dev

pnpm lint                        # eslint sobre todo el repo
pnpm -r build                    # SIEMPRE antes de typecheck (ver abajo)
pnpm typecheck
pnpm test                        # unitarios (rápidos, sin Docker)
pnpm --filter api test:int       # integración contra Postgres real (testcontainers)
```

Un solo test: `pnpm --filter api exec vitest run src/findings/derive.spec.ts`, o para
integración `pnpm --filter api exec vitest run --config vitest.integration.config.mts test/findings.int-spec.ts`.
`--filter web` y `--filter contracts` funcionan igual con `vitest run <archivo>`.

**El build va antes del typecheck.** `apps/web` y `apps/api` consumen `@hs/forms` y
`@hs/contracts` por sus `exports` → `dist`; sin compilar los paquetes, no tipan. CI hace
exactamente eso (`.github/workflows/ci.yml`), y `pnpm dev` compila los dos paquetes antes
de levantar los watchers por la misma razón.

`db:jobs:install` instala el esquema `pgboss` — sin él la API no arranca. Es un paso de
despliegue, no de arranque.

Para datos de demo (`pnpm demo:data`, `pnpm demo:content`), recuperar contraseñas
(`pnpm auth:reset-password`) y el bootstrap de la primera credencial
(`pnpm auth:bootstrap`), el README tiene el detalle y las precondiciones de cada uno.

## Arquitectura

Monorepo pnpm. `apps/api` (NestJS + Postgres/Drizzle + pg-boss), `apps/web` (Vite +
React + TanStack Router/Query + Dexie + Serwist), `packages/contracts` (Zod compartido),
`packages/forms` (motor de formularios isomórfico), `packages/config` (tsconfig).

Las decisiones están en `docs/adr/` y **se citan por número, no se reescriben**. Las que
más condicionan el código del día a día:

- **ADR-001** — el offline no es sincronización. Un dueño, un dispositivo, un firmante;
  el envío es el punto de no retorno; se acepta perder borradores. La corrección la
  garantiza el servidor con `client_submission_id`, no el cliente.
- **ADR-002 / ADR-004** — la inmutabilidad la fuerza el motor: `hs_app` no tiene
  UPDATE/DELETE por default, se conceden tabla por tabla en la migración. Nunca DELETE:
  `deactivated_at`. El aislamiento por sitio es RLS, nunca un `WHERE` en el endpoint.
- **ADR-007** — `packages/forms` corre en el dispositivo y en el servidor sobre la misma
  entrada, y viaja dentro del bundle del service worker: sin builtins de Node, sin
  reloj, sin azar, sin red. El esquema Drizzle vive solo en `apps/api`.
- **ADR-008** — monolito modular, dependencias en una sola dirección. `findings` no
  puede llamar a `inspections` (la inversa sí, y está declarada como excepción).
  `reporting` lee de todos y no lo llama nadie. Capas delgadas:
  `controller → service → repository`, más un archivo de funciones puras donde haya
  reglas reales.

Las dos costuras que concentran el riesgo (ADR-008): la ingesta del envío
(`POST /inspections/submissions`, una transacción idempotente) y la derivación de
estado — el estado de una acción correctiva y los relojes regulatorios de un incidente
**no son columnas**, se calculan de eventos y reglas puras.

### Alcance de sitio

Todo acceso a la base pasa por `DbService`, y por cuál método importa
(`apps/api/src/db/db.service.ts`, `site-scope.ts`):

- `withSession` / `withSessionClient` — el camino HTTP. El `SessionScope` lo produce el
  guard; los `siteIds` salen de `user_site_scope` en cada request, no del token.
- `withSiteScope` / `withSiteScopeClient` — alcance declarado a mano: seeds, comandos de
  servidor, tests. Un endpoint que llame a estos está fabricando un alcance que no le
  corresponde, y por eso son métodos distintos.

### Rutas

**Toda ruta es una carpeta `src/routes/XRoute/`**, sin excepción por tamaño. `router.tsx`
importa `../routes/XRoute` y eso resuelve contra el `index.tsx` de la carpeta, así que
una ruta puede crecer sin que nadie la reimporte. Adentro:

- `index.tsx` — el componente de ruta y su composición: qué se arma con qué, no cómo se
  dibuja cada pieza. En una ruta chica es el único archivo, y está bien.
- Un archivo por subcomponente con hooks, estado o `useQuery`/`useMutation`
  (`PersonRow.tsx`, `NewRuleForm.tsx`…). Se separa cuando el subcomponente ya no cabe
  cómodo en `index.tsx` — de referencia, más de 150-200 líneas o tres o más funciones
  locales. Si un subcomponente casi idéntico aparece en dos rutas, no se duplica: sube a
  `src/components/` (ver `SitePicker.tsx`, `StateBadge.tsx`).
- `presentation.ts` + `presentation.test.ts` — la lógica pura de ESTA ruta (etiquetas,
  clases, filtros, orden). El nombre no repite el de la ruta porque la carpeta ya lo da.
- `index.test.tsx` — el test de integración de la ruta completa.

`src/components/` es solo lo que cruza rutas; un subcomponente de una sola ruta vive en
su carpeta, no ahí.

### Permisos y vocabulario compartidos

Lo que cruza rutas y no es un componente no vive en `routes/`, vive en un directorio
propio al mismo nivel que `api/` y `offline/`. La división es entre decidir y nombrar:

- `src/permissions/` — **qué le ofrece la interfaz a quién**, y nada más:
  `session.ts` (los predicados por rol), `actions.ts` (`canAttempt`), `incidents.ts`
  (`availableTransitions`). Es comodidad, no garantía: la garantía es RLS y el rol que
  comprueba el servidor. Cada uno es una función pura con su `.test.ts` al lado, para
  poder probar la decisión sin renderizar.
- `src/presentation/` — **cómo se llama cada cosa en pantalla**: `actions.ts` e
  `incidents.ts` (las tablas de etiquetas y los textos de botón por PAR de estados),
  `dates.ts` (`formatDay` y `formatInstant`, que recortan la cadena ISO a propósito —
  un registro que se defiende ante un regulador se lee en el huso en que se guardó).

Un archivo que tenga las dos cosas está mal partido: el nombre va a mentir sobre la
mitad que contiene.

## Invariantes que ningún change puede violar

Están en `openspec/config.yaml` junto con las capabilities válidas y la lista de lo que
está **fuera de alcance en v1** (i18n, canal anónimo, QR, scoring ponderado, segunda
firma, sincronización multi-dispositivo, etc.). Leerla antes de proponer algo que parezca
una mejora obvia.

El flujo de trabajo es spec-driven con OpenSpec: `/opsx:propose`, `/opsx:apply`,
`/opsx:archive`. Toda tarea que toque el esquema incluye su migración SQL con
REVOKE/RLS.

## Comprobaciones que son parte del build

No son opcionales y fallan el `pnpm --filter web build`:

- `scripts/check-service-worker.mjs` — verifica ADR-007 sobre el **artefacto**
  construido (un builtin de Node que entra por una dependencia transitiva no lo ve el
  lint) y compara el precache contra un presupuesto escrito en el archivo.
- `scripts/check-tokens.mjs` — ningún color literal fuera del bloque de tokens de
  `index.css`, todo `var(--x)` resuelve, las primitivas no se usan salteando la capa
  semántica, y `index.html`/manifest coinciden con `--brand`.

`eslint.config.js` no es configuración genérica: implementa las reglas de ADR-007 y
ADR-008 (sin builtins ni impureza en `packages/forms`; sin reloj ambiente en
`regulatory-clocks.ts`, `incidents.ts`, `actions.ts` de contracts). Si una regla molesta,
la conversación es sobre la ADR, no sobre el lint.
