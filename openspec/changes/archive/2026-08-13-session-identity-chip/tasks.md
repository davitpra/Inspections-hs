> **Este change se formalizó después de implementarlo.** Las tareas están marcadas porque
> el código ya está escrito y verificado; se escriben igual, y con el mismo detalle, porque
> son el registro de qué se hizo y de las dos correcciones que la implementación impuso
> sobre el plan original (2.1 y 2.2).

## 1. El contrato

- [x] 1.1 `packages/contracts/src/identity.ts`: `ROLE_LABELS`, un `Record<Role, string>` con
      el término de §4 de cada rol. Tipado así a propósito — agregar un rol a `ROLES` sin
      etiquetarlo no compila (design, decisión 4).
- [x] 1.2 `packages/contracts/src/auth.ts`: `sessionSchema` suma `email`, `firstName` y
      `lastName`, **opcionales**, con el comentario que explica que la opcionalidad es por
      la caché offline y no porque el servidor pueda omitirlos (design, decisión 3). Un
      `nameSchema` local con la misma forma que `person.first_name`/`last_name`.
- [x] 1.3 `packages/contracts/src/auth.test.ts` (nuevo): que una sesión **sin** los tres
      campos siga parseando. Es el test que sostiene el escenario "A session stored before
      the identity fields existed still validates", y su descripción dice qué protege para
      que nadie lo "arregle" volviendo los campos requeridos.

## 2. La API

> **Corregido durante la implementación.** El plan original joineaba `person` en la
> consulta de `resolve`. No se puede: `person` lleva `hs_apply_site_isolation` con FORCE
> ROW LEVEL SECURITY y esa consulta corre **sin alcance declarado**, así que el join
> —INNER, porque `app_user.person_id` es NOT NULL— habría devuelto cero filas y roto todo
> request como "sesión inexistente". El email sí puede viajar ahí (`app_user` no lleva
> política); el nombre se lee aparte y bajo alcance. Ver design, decisión 1.

- [x] 2.1 `session.service.ts`: `u.email` a la consulta de `resolve`, a `ResolvedRow` y a
      `SessionContext`. El comentario del método declara por qué el email viaja ahí y el
      nombre no — es la trampa que un refactor futuro va a querer pisar.
- [x] 2.2 `session.service.ts`: `toContractSession` pasa a `async` y lee
      `person.first_name`/`last_name` con `DbService.withSessionClient`, la vía del camino
      HTTP (ADR-002). **Sin `ReadDescriptor`**: el registro de lecturas del auditor externo
      es sobre registros y el nombre propio no es uno (design, decisión 2). Persona no
      encontrada → sesión sin nombre, nunca un error.
- [x] 2.3 Los dos llamadores: `auth.service.ts` (respuesta de sign-in) y `auth.controller.ts`
      (`GET /auth/session`, que pasa a `async`). Actualizar el comentario de la ruta, que
      enumeraba lo que devuelve.
- [x] 2.4 `test/authentication.int-spec.ts`: escenario "la sesión dice quién es la persona",
      contra Postgres real y con RLS puesta — que es lo único que prueba que la lectura bajo
      alcance funciona. Verifica los dos caminos: la respuesta del sign-in y el
      `toContractSession` sobre un token resuelto. El helper local `account()` acepta
      `firstName`/`lastName`.

## 3. La PWA

- [x] 3.1 `apps/web/src/components/AccountChip.tsx` (nuevo): nombre y rol legible, con la
      degradación en tres pasos —nombre → email → rol— que hace que el chip nunca quede
      vacío (design, decisión 5). El email en `title`. Cuando el nombre ya cayó al rol, no
      se escribe dos veces.
- [x] 3.2 `app/router.tsx`: montarlo en `Shell`, antes de "Sign out".
- [x] 3.3 `index.css`: `.account-chip` y sus dos elementos. El `margin-left: auto` se mueve
      de `.shell__signout` al chip, que ahora es el primero del par que se va a la derecha.
      **Solo tokens semánticos** — `check-tokens.mjs` corre dentro del build y rechaza un
      color literal o una primitiva fuera de `:root`.
- [x] 3.4 `AccountChip.test.tsx`: los tres pasos de la degradación, que el rol se rinde como
      "JHSC member" y no como `jhsc_member`, y que el email queda en `title`.

## 4. Verificación

- [x] 4.1 `pnpm -r build && pnpm typecheck && pnpm lint`. El build de web corre
      `check-tokens.mjs` y `check-service-worker.mjs`.
- [x] 4.2 `pnpm test` — 599 unitarios en verde.
- [x] 4.3 `pnpm --filter api exec vitest run --config vitest.integration.config.mts` — la
      suite de integración completa contra Postgres real: 21 archivos, 628 tests.
- [ ] 4.4 Comprobación en el navegador: iniciar sesión y confirmar el chip; después, con
      DevTools en modo offline, recargar y confirmar que sigue mostrando lo mismo desde la
      caché de Dexie.
