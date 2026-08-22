## 1. Migración y motor

- [x] 1.1 Crear una migración SQL posterior a `0022` que conceda a `hs_app` únicamente `UPDATE (name, deactivated_at)` sobre `site`, manteniendo las barreras de `code`, `DELETE` y `TRUNCATE`.
- [x] 1.2 Extender la auditoría de `site` para escribir `site.renamed` y `site.deactivated` con actor desde `app.user_id`, payload estable y relleno compatible con la cadena de `audit_log`.
- [x] 1.3 Extender la auditoría de `location` para escribir un `location.unlinked` por cada transición de `organization_location_id` no nulo a nulo, sin auditar actualizaciones que no sean un unlink.
- [x] 1.4 Mantener explícito en la migración que `site` no lleva RLS, que `location` sí permanece protegido por RLS y que no se concede ningún `DELETE`.
- [x] 1.5 Actualizar el espejo Drizzle `apps/api/src/db/schema/catalog.ts` para reflejar los privilegios y comentarios de la tabla `site`; no ejecutar `drizzle-kit generate`.

## 2. Contratos compartidos

- [x] 2.1 Añadir schemas estrictos para renombrar y desactivar un sitio en `packages/contracts/src/catalog.ts`, aceptando solo un `name` para rename y un objeto vacío para deactivate.
- [x] 2.2 Exportar los tipos inferidos y validar que no se aceptan `code`, `id`, `created_at` ni `deactivated_at` desde el cliente.
- [x] 2.3 Cubrir los schemas en `packages/contracts/src/catalog.test.ts` con casos válidos, campos extra, etiquetas vacías y nombres fuera de límite.

## 3. API

- [x] 3.1 Añadir métodos de rename y deactivation a `SitesService`, con la comprobación existente de `hs_coordinator` y usando `withSessionClient`.
- [x] 3.2 Resolver el `site_id` dentro del alcance de la sesión y devolver 404/400 según el contrato sin aceptar un `site_id` de otro alcance.
- [x] 3.3 Implementar el rename como actualización column-scoped y el deactivation como una transacción que actualiza el sitio y pone a null todos los `location.organization_location_id` mapeados.
- [x] 3.4 Rechazar una segunda desactivación sin tocar mappings, y traducir errores de validación/estado a respuestas HTTP estables.
- [x] 3.5 Añadir `PATCH /sites/:siteId` y `POST /sites/:siteId/deactivate` a `sites.controller.ts`, validando los cuerpos con los schemas compartidos.
- [x] 3.6 Actualizar los módulos/repositorios necesarios sin crear una dependencia desde `catalog` hacia `inspections`.

## 4. Pruebas de integración API

- [x] 4.1 Verificar que `hs_app` puede actualizar solo `site.name` y `site.deactivated_at`, pero no `site.code`, no borrar y no truncar.
- [x] 4.2 Cubrir rename de coordinador, 403 de supervisor, sitio fuera de alcance y rechazo de body con `code`.
- [x] 4.3 Cubrir deactivation con conservación de la fila `site`, conservación de `location.site_id` y nulidad de cada `organization_location_id`.
- [x] 4.4 Cubrir que `organization_location` no cambia y que `user_site_scope` no se revoca ni se elimina.
- [x] 4.5 Cubrir atomicidad: una falla deja `deactivated_at` y mappings sin cambios.
- [x] 4.6 Cubrir `site.renamed`, `site.deactivated` y `location.unlinked` en la cadena correcta, con actor correcto y sin entradas en otros sitios.
- [x] 4.7 Cubrir el rechazo de una segunda desactivación y que no genera nuevos eventos.

## 5. Cliente web y consola

- [x] 5.1 Añadir `renameSite` y `deactivateSite` a `apps/web/src/api/catalog.ts`, parseando la respuesta con `siteSchema`.
- [x] 5.2 Crear los componentes route-locales del panel de gestión, con lista de sitios, edición inline, estado de sitio retirado y confirmación explícita antes de Remove.
- [x] 5.3 En `LocationsRoute/index.tsx`, añadir `Manage sites` junto a `Add site`, abrir `Sheet` y mantener independientes los estados de alta de sitio, alta de ubicación y gestión.
- [x] 5.4 Excluir sitios con `deactivated_at` no nulo de las columnas activas y conservarlos en el panel de gestión/historial.
- [x] 5.5 Tras éxito, invalidar `queryKeys.sites()`, `queryKeys.catalogLocations()` y las consultas dependientes; mostrar errores sin perder el formulario de rename.
- [x] 5.6 Añadir estilos responsive para los tres controles del encabezado y el contenido del Sheet sin colores literales ni saltarse la capa semántica de tokens.

## 6. Pruebas de ruta y presentación

- [x] 6.1 Cubrir que el coordinador ve `Manage sites` y otro rol no lo ve.
- [x] 6.2 Cubrir apertura/cierre del Sheet, rename exitoso, error de rename, confirmación de Remove y desactivación exitosa.
- [x] 6.3 Cubrir que un sitio retirado no se dibuja como columna, pero sí aparece como retirado en el panel.
- [x] 6.4 Cubrir que los toggles de Add site, Add location y Manage sites no interfieren entre sí.

## 7. Verificación

- [x] 7.1 Ejecutar `pnpm -r build`.
- [x] 7.2 Ejecutar `pnpm typecheck` después del build y `pnpm lint`.
- [x] 7.3 Ejecutar las pruebas de contracts y web afectadas, además de la integración API de catálogo.
- [x] 7.4 Ejecutar `pnpm --filter web build` para validar tokens, service worker y artefactos finales.
- [x] 7.5 Ejecutar `openspec validate "2026-08-21-manage-sites-from-locations-console" --type change --strict`.
