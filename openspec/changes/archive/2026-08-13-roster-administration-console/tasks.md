## 0. Esquema

**Sin migración.** El `GRANT SELECT` sobre `person` de `apps/api/drizzle/0005_identity.sql`,
la política `hs_apply_site_isolation('person')` y el índice `person_site_active_name_idx` ya
existen. **Este change no crea, altera ni revoca ningún privilegio, política, tabla, columna,
índice ni trigger**, y no escribe ninguna tabla: la regla de "toda tarea que toque el esquema
incluye su migración con REVOKE/RLS" no aplica, y se declara acá para que la ausencia sea
deliberada y no un olvido.

- [x] 0.1 Confirmar contra Postgres que la lectura corre como `hs_app` sin ningún `GRANT`
      nuevo, y que un alcance ajeno devuelve cero filas por RLS y no por un `WHERE`.

## 1. Contracts

- [x] 1.1 Agregar `rosterQuerySchema` en `packages/contracts/src/identity.ts`: `site_id`
      (`z.uuid()`, obligatorio) y `status` (`'active' | 'inactive' | 'all'`, default
      `'active'`).
- [x] 1.2 Reusar `personSchema` tal cual como respuesta. **No** crear un `rosterPersonSchema`.
- [x] 1.3 **Ningún esquema de escritura**, porque no hay ninguna ruta que escriba. Dejarlo
      dicho en el docblock para que la ausencia se lea como decisión.
- [x] 1.4 Tests en `packages/contracts/src/identity.test.ts`: el default de `status`, el
      rechazo de un estado desconocido, y que `site_id` es obligatorio y uuid.

## 2. API — módulo `roster`

- [x] 2.1 Crear `apps/api/src/roster/roster.errors.ts` con **un solo** código,
      `roster_forbidden` → 403, siguiendo `inspections.errors.ts` (el código va en el cuerpo).
      Dejar dicho por qué no hay `person_not_found`: ninguna ruta recibe el id de una persona.
- [x] 2.2 Crear `apps/api/src/roster/roster.service.ts` con `requireCoordinator` privado
      —misma forma que `inspections.service.ts`— y el acceso por
      `this.db.withSessionClient(session, …)`. Nunca `withSiteScope*`.
- [x] 2.3 Implementar `list(session, query)`: `SELECT` de las seis columnas con
      `WHERE site_id = $1` más el predicado de `status`, ordenado por
      `last_name, first_name, employee_number`. Docblock explicando que ese `WHERE` es
      **selección entre las plantas del alcance** y no el límite de seguridad, y por qué acá
      no va el chequeo explícito que sí necesita `/inspector-candidates`.
- [x] 2.4 Comprobar el rol **también en la lectura**, al revés que `/scheduling`: esta ruta
      devuelve el perfil, y §4 dice que se elige a una persona sin poder verlo.
- [x] 2.5 Crear `roster.controller.ts` con `GET /people` (query por `rosterQuerySchema`) y
      **ninguna ruta de escritura**. El parseo Zod lo traduce `common/zod-exception.filter.ts`.
- [x] 2.6 Crear `roster.module.ts` y registrarlo en `app.module.ts`. Docblock: por qué la
      superficie HTTP de `person` vive junto al importador CSV y no en `auth/` ni en `catalog/`.

## 3. API — tests de integración

`apps/api/test/roster-administration.int-spec.ts`, reusando `createAccount`, `createPerson` y
`selectablePeople` de `test/helpers/identity.ts`, `registerSite` de `helpers/catalog.ts` y
`startTestDatabase` de `helpers/postgres.ts`.

- [x] 3.1 El coordinador lista la planta A: su gente ordenada por apellido, y nadie de B.
- [x] 3.2 El mismo coordinador pide la planta B y recibe la de B.
- [x] 3.3 Un alcance de una sola planta pide la otra: **lista vacía, sin error**. Es RLS, no
      un `WHERE`, y por eso se prueba contra Postgres de verdad.
- [x] 3.4 `supervisor`, `jhsc_member`, `management` y `external_auditor` reciben 403 en la
      **lectura**.
- [x] 3.5 `status=active` excluye a las dadas de baja; `inactive` devuelve solo esas con su
      `deactivated_at`; `all` devuelve las dos.
- [x] 3.6 Mostrar a una persona dada de baja acá **no la devuelve a ningún selector**:
      `selectablePeople` sigue sin ofrecerla.
- [x] 3.7 No duplicar lo que ya cubre `immutability.int-spec.ts` (DELETE y `employee_number`).

## 4. Web

- [x] 4.1 Crear `apps/web/src/api/roster.ts` con el helper local `get` sobre
      `sessionClient.request` y `listPeople(siteId, status)` →
      `z.array(personSchema).parse(...)`. Nunca castear (D11). Sin ninguna función que
      escriba. Docblock: online, fuera de Dexie y del outbox, y por qué.
- [x] 4.2 Crear `apps/web/src/routes/RosterRoute/presentation.ts` con la lógica pura:
      `personLabel` (siempre con número de empleado, porque el nombre no identifica),
      `statusLabel`/`statusClass`, `matchesSearch` (apellido, nombre y número, normalizado,
      sin acentos ni mayúsculas) y `sortRoster` (con el número como desempate estable para los
      homónimos que la spec permite).
- [x] 4.3 Crear `presentation.test.ts` sin renderizar nada.
- [x] 4.4 Crear `apps/web/src/routes/RosterRoute/index.tsx`: si
      `account.role !== 'hs_coordinator'`, solo el título y un aviso **sin disparar ninguna
      query**; si no, `useQuery(['sites'])` y `useQuery(['roster', siteId, status])`, ambos con
      `retry: false`.
- [x] 4.5 Reusar el componente compartido `src/components/SitePicker.tsx`, que degrada a texto
      con una sola planta en el alcance.
- [x] 4.6 Fila de `.filters`: select de estado e `input type="search"` filtrado en cliente con
      `matchesSearch`. Labels con `useId()` y `htmlFor`.
- [x] 4.7 La fila va **inline** en `index.tsx`: sin estado, sin hooks y sin mutación no llega
      al umbral que `CLAUDE.md` pide para separarla en su propio archivo. `<ul className="list">`
      / `<li className="list__row">` con un `.badge` de estado — no hay ni un `<table>` en
      `apps/web`. Ningún color literal: lo falla `scripts/check-tokens.mjs` en el build.
- [x] 4.8 Estados: `isLoading` → `Loading…`; `isError` →
      `<p className="notice">This view needs a connection.</p>`; y distinguir "esta planta no
      tiene a nadie" de "la búsqueda no encontró nada".
- [x] 4.9 Nota visible de que el roster se mantiene por importación de CSV, para que quien vea
      un error sepa por dónde se arregla en vez de buscar un botón que no existe.
- [x] 4.10 En `apps/web/src/app/router.tsx`: `createRoute` con `path: '/roster'`, agregarla a
      `routeTree.addChildren([...])`, y el link en `Shell()` condicionado a `hs_coordinator`.
      Docblock explicando por qué es `/roster` y no `/inspections/roster`: `CAPTURE_ROUTES` en
      `sw.ts` matchea `/^\\/inspections\\//` y la metería en el precacheo.
- [x] 4.11 Actualizar el comentario de `router.tsx` sobre el link condicionado por rol: ya no
      es uno solo, y los dos no se condicionan igual por dentro.
- [x] 4.12 Actualizar el comentario del `PersonPicker` en `ReportIncidentRoute.tsx`: la
      pantalla de roster ya existe; lo que falta es un endpoint con forma de
      `personOptionSchema`. **No** conectarlo a `GET /people`.
- [x] 4.13 Crear `index.test.tsx` con la receta de `SchedulingRoute/index.test.tsx`. Casos: un
      no-coordinador ve el aviso **y no se hace ningún request**; la lista renderiza los
      activos por default; **cambiar de planta vuelve a pedir con la otra**; con una sola
      planta no se dibuja el selector; el filtro de estado cambia la query key; la búsqueda
      filtra sin refetch; se distingue "no hay nadie" de "no encontró"; **no se ofrece ningún
      control de escritura**; y no se renderiza ningún uuid.

## 5. Verificación

- [x] 5.1 `pnpm lint`.
- [x] 5.2 `pnpm -r build` **antes** de `pnpm typecheck`. El build de web corre
      `check-tokens.mjs` y `check-service-worker.mjs`; si el presupuesto de precacheo se movió,
      `/roster` quedó dentro de `CAPTURE_ROUTES` y la ruta está mal.
- [x] 5.3 `pnpm typecheck` y `pnpm test`.
- [x] 5.4 `pnpm --filter api exec vitest run --config vitest.integration.config.mts test/roster-administration.int-spec.ts`, y después `pnpm --filter api test:int` completo.
- [x] 5.5 A mano, con `pnpm demo:data`: entrar como coordinador, ver el roster de las dos
      plantas y conmutar entre ellas, buscar por número de empleado, ver a alguien dado de baja
      con el filtro `inactive`; y entrar como `supervisor` para confirmar que el link no
      aparece y que `/roster` escrito a mano responde 403.
- [x] 5.6 Actualizar la sección "Lo que todavía no tiene UI" del `README.md`.
- [x] 5.7 `openspec validate roster-administration-console --strict`.
