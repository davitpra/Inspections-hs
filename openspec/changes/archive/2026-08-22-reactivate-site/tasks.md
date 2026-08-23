## 1. Motor

- [x] 1.1 Escribir `apps/api/drizzle/0026_reactivate_site.sql`: `CREATE OR REPLACE FUNCTION
      hs_site_audit()` con el cuerpo completo de `0023` más la rama
      `OLD.deactivated_at IS NOT NULL AND NEW.deactivated_at IS NULL` que inserta
      `site.reactivated` con `site_id`, `code` y `name` en el payload, seguida del
      `DROP TRIGGER IF EXISTS site_audit` / `CREATE TRIGGER site_audit` como hace `0023`.
- [x] 1.2 Documentar en la cabecera de la migración por qué NO lleva `GRANT`, `REVOKE` ni
      política: `0023` ya concedió `UPDATE (name, deactivated_at) ON site`, `DELETE` sigue
      revocado con `site_forbid_deletion`, y `site` sigue sin RLS por la circularidad de
      `0004`. Lo que faltaba era el registro, no el privilegio.
- [x] 1.3 Registrar la migración en `apps/api/drizzle/meta` según el flujo del repo y
      comprobar que `pnpm db:migrate` la aplica sobre la base local.

## 2. Contrato

- [x] 2.1 Agregar `reactivateSiteSchema = z.strictObject({})` y su tipo en
      `packages/contracts/src/catalog.ts`, junto a `deactivateSiteSchema`, con el comentario
      que explica la simetría: la reactivación tampoco acepta una fecha del cliente.

## 3. API

- [x] 3.1 `apps/api/src/catalog/sites.service.ts`: método `reactivate(session, siteId)` con
      `requireCoordinator`, dentro de `withSessionClient`, con el UPDATE espejo del de
      `deactivate` (`SET deactivated_at = NULL ... AND id = ANY($2::uuid[]) AND
      deactivated_at IS NOT NULL RETURNING ...`), el `SELECT` de desempate que distingue
      `NotFoundException` de `BadRequestException` ("Site is already active"), y el mismo
      comentario sobre por qué no hay `FOR UPDATE`.
- [x] 3.2 Verificar explícitamente que el método no ejecuta ninguna sentencia sobre
      `location`: la baja desvincula, la reactivación no re-vincula (design, decisión 2).
- [x] 3.3 `apps/api/src/catalog/sites.controller.ts`: `@Post(':siteId/reactivate')` calcado
      del `deactivate` de al lado — `ParseUUIDPipe` en el param y `reactivateSiteSchema.parse`
      del body.

## 4. Web

- [x] 4.1 `apps/web/src/api/catalog.ts`: `reactivateSite(siteId)` junto a `deactivateSite`.
- [x] 4.2 `apps/web/src/routes/LocationsRoute/ManageSitesSheet.tsx`: mutación `restore` con
      el mismo `refresh()` que ya invalida `queryKeys.sites()` y `queryKeys.catalogLocations()`.
- [x] 4.3 Ofrecer **Restore** en los items con `deactivated_at`, con su confirmación en línea
      reusando el bloque `manage-sites__confirm`, y un estado propio para no compartirlo con
      el confirm de baja.
- [x] 4.4 Reescribir los textos: la nota de cabecera y el confirm de baja ya no pueden decir
      "This cannot be undone" — dicen que la planta puede restaurarse y que sus ubicaciones
      físicas vuelven sin mapear hasta que se vuelvan a tickear. UI en inglés, sin i18n.

## 5. Tests

- [x] 5.1 `apps/api/test/catalog.int-spec.ts`: reactivar deja `deactivated_at` nulo, la
      planta vuelve al listado y la cadena de esa planta suma `site.reactivated` después de
      `site.deactivated`, con el coordinador como `actor_user_id`.
- [x] 5.2 `apps/api/test/catalog.int-spec.ts`: reactivar una planta activa → 400; fuera del
      alcance → 404; como `supervisor` → 403 y la fila sin cambios.
- [x] 5.3 `apps/api/test/catalog.int-spec.ts`: tras reactivar, las `location` de esa planta
      siguen con `organization_location_id` nulo, y renombrar una planta activa no escribe
      ninguna entrada `site.reactivated`.
- [x] 5.4 `apps/web/src/routes/LocationsRoute/index.test.tsx`: una planta removida ofrece
      Restore, y al confirmar vuelve a aparecer como columna con sus ubicaciones sin mapear.

## 6. Cierre

- [x] 6.1 `pnpm -r build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` y
      `pnpm --filter api exec vitest run --config vitest.integration.config.mts
      test/catalog.int-spec.ts`.
- [ ] 6.2 Comprobación manual en `pnpm dev`: Locations → Manage sites → remover una planta →
      Restore → la columna vuelve y sus ubicaciones aparecen como huecos en la tabla de mapeo.
- [x] 6.3 `openspec validate reactivate-site --strict` y archivar con `/opsx:archive`.
