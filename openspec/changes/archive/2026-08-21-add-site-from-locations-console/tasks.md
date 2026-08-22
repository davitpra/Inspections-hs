## 1. Migración y motor

- [x] 1.1 Crear `apps/api/drizzle/0022_register_site_from_console.sql` con `GRANT INSERT ON site TO hs_app`, y un comentario que cite lo que 0004 §6 decidió y por qué se corrige: se concede el alta y NO se concede `UPDATE` ni `DELETE`.
- [x] 1.2 En la misma migración, añadir `hs_site_audit()` y `CREATE TRIGGER site_audit AFTER INSERT ON site`, escribiendo `site.created` con `site_id = NEW.id`, el actor de `app.user_id` y los valores de relleno de `seq`/`prev_hash`/`hash` que sobrescribe la cadena de 0002. Sin rama `UPDATE`: no hay `UPDATE` concedido.
- [x] 1.3 Dejar escrito en la migración que `site` sigue SIN política RLS, por la circularidad que documenta 0004, y que `site_guard`, `site_forbid_deletion` y `site_forbid_truncate` quedan intactos.
- [x] 1.4 Actualizar a mano el espejo Drizzle `apps/api/src/db/schema/catalog.ts` — su cabecera prohíbe `drizzle-kit generate` — y corregir el comentario que hoy dice «sin INSERT para hs_app».

## 2. Contrato

- [x] 2.1 Añadir y exportar `createSiteSchema` (`z.strictObject({ code: codeSchema, name: labelSchema })`) y `CreateSite` en `packages/contracts/src/catalog.ts`, calcado de `createOrganizationLocationSchema`, con el docblock que explique que `code` se escribe y es permanente.
- [x] 2.2 Cubrirlo en `packages/contracts/src/catalog.test.ts`: acepta un par válido, rechaza un `code` fuera de `CATALOG_CODE_PATTERN`, y rechaza campos de más (`id`, `deactivated_at`).

## 3. API

- [x] 3.1 Añadir `requireCoordinator` a `SitesService` — hoy no tiene ninguna comprobación de rol— copiando el criterio de `LocationsService`.
- [x] 3.2 Implementar `SitesService.create` dentro de `withSessionClient`, en el orden que exige la auditoría: `SELECT gen_random_uuid()`, `set_config('app.site_ids', <alcance de la sesión + el id nuevo>, true)`, `INSERT INTO site (id, code, name)`, `INSERT INTO user_site_scope (user_id, site_id)`.
- [x] 3.3 Documentar junto al método por qué ensancha `app.site_ids` y cuál es el límite: solo el id creado en ESA transacción, que antes del `COMMIT` ya tiene su fila de alcance, y con `SET LOCAL`. Es la única excepción del sistema a «el alcance lo produce el guard» y sin el comentario se lee como el bug que advierte `site-scope.ts`.
- [x] 3.4 Mapear `23505` a `BadRequestException` nombrando el code en uso, con el mismo patrón que `createOrganizationLocation`.
- [x] 3.5 Añadir `POST /sites` a `sites.controller.ts`, validando `createSiteSchema` y delegando al servicio.

## 4. Pruebas de integración

- [x] 4.1 En `apps/api/test/catalog.int-spec.ts`, REEMPLAZAR el test `'la aplicación no puede dar de alta una planta'` por uno que compruebe el alta: hoy fija exactamente lo contrario de lo que este change decide.
- [x] 4.2 Añadir el test de que `hs_app` sigue sin poder renombrar ni borrar una planta (`42501` en los dos casos): lo que se concedió es `INSERT` y solo `INSERT`.
- [x] 4.3 Cubrir la fila de `user_site_scope` del creador, que la planta aparece en su listado, y que el alcance de otra cuenta no cambia.
- [x] 4.4 Cubrir las dos entradas de `audit_log` en la cadena de la planta nueva: `site.created` y `user.scope_granted`, y que no se escribe nada en las cadenas de las otras plantas.
- [x] 4.5 Cubrir el 403 de `supervisor`, el 400 del code duplicado y el rollback que no deja la planta sin alcance.

## 5. Consola de ubicaciones

- [x] 5.1 Añadir `createSite` a `apps/web/src/api/catalog.ts` — ojo: `listSites` vive en `inspections.ts`, así que hay que importar `siteSchema` acá.
- [x] 5.2 Crear `apps/web/src/routes/LocationsRoute/NewSiteForm.tsx` calcado de `NewLocationForm.tsx` (error a estado local, `useId()`, `suggestCode` mientras el code no se tocó, `canCreate`, botón `Add`/`Adding…`) pero SIN `SitePicker`: no hay planta que elegir cuando la planta es lo que se crea.
- [x] 5.3 Que el formulario avise de las dos consecuencias: el `code` es permanente, y la planta queda alcanzable solo por quien la registró.
- [x] 5.4 En `onSuccess`, invalidar `queryKeys.sites()` **y** llamar a `reload()` de `useAppSession()`. Las columnas se filtran por `account.siteScope` (`index.tsx:80`), que sale de la sesión de Dexie y no de `queryKeys.sites()`: sin el `reload()` la planta se crea y la columna no aparece.
- [x] 5.5 En `index.tsx`, añadir el estado `addingSite` independiente de `adding` y el botón `Add site` con `aria-expanded`, delante de `Add location` como en el mock.

## 6. Estilos

- [x] 6.1 Usar `button--outline` para `Add site` — es la única variante secundaria que existe— y añadir `.mapping__add-site` en `index.css` con `inline-flex` y `width: auto` para anular su `width: 100%`, igual que hace `.mapping__add`.
- [x] 6.2 Comprobar los dos botones juntos en el `grid` que `scheduling__top` toma bajo `48rem`, y sin ningún color literal (`scripts/check-tokens.mjs` falla el build).

## 7. Pruebas de ruta

- [x] 7.1 En `LocationsRoute/index.test.tsx`, añadir: abrir el panel de site, crear y ver la columna nueva, y que el error de code duplicado NO limpia el formulario.
- [x] 7.2 Comprobar que el panel de site y el de ubicaciones son toggles independientes.
- [x] 7.3 Comprobar que un rol distinto de `hs_coordinator` no ve el botón `Add site`.

## 8. Verificación

- [x] 8.1 Ejecutar `pnpm -r build`.
- [x] 8.2 Ejecutar `pnpm typecheck && pnpm lint`.
- [x] 8.3 Ejecutar las pruebas de contracts, web y API indicadas en la propuesta, incluida `pnpm --filter api test:int`.
- [x] 8.4 Ejecutar `pnpm --filter web build` y validar manualmente el alta en 375px si el entorno está disponible.
