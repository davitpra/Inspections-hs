## 1. Persistencia y contratos

- [x] 1.1 Escribir `apps/api/drizzle/0034_archive_deactivated_templates.sql` con `template.archived_at`, el `CHECK (archived_at IS NULL OR deactivated_at IS NOT NULL)` y el `REVOKE UPDATE` / `GRANT UPDATE (deactivated_at, archived_at)` sobre `template` para `hs_app`.
- [x] 1.2 Actualizar a mano el espejo Drizzle de `template` en `apps/api/src/db/schema/templates.ts`, con el comentario que explique qué columna es mutable y por qué.
- [x] 1.3 Agregar `archived_at` a `publishedTemplateSummarySchema` en `packages/contracts` y cubrirlo en su test de contrato.

## 2. API de plantillas

- [x] 2.1 Proyectar `t.archived_at` en `listPublished` sin filtrarlo, para que el catálogo siga completo.
- [x] 2.2 Agregar `archive` y `restore` a `TemplatesService`, cada uno con su predicado de estado en el `WHERE` y su decisión por `rowCount`, y sumar `AND archived_at IS NULL` a `reactivate`.
- [x] 2.3 Declarar los errores nuevos en `templates.errors.ts` (`template_not_deactivated` para archivar una activa, `template_already_archived`, `template_not_archived`, y el rechazo de reactivar una archivada) con sus mensajes y códigos HTTP.
- [x] 2.4 Exponer `POST :templateId/archive` y `POST :templateId/restore` en `templates.controller.ts`, con el mismo guard de coordinador y cuerpo vacío que `deactivate`/`reactivate`.
- [x] 2.5 Cubrir con integración PostgreSQL: archivo de una retirada, rechazo sobre una activa, restauración, rechazo de reactivar una archivada, el `CHECK` del motor y que `GET /templates` no cambie.

## 3. Consola de plantillas

- [x] 3.1 Agregar `archiveTemplate` y `restoreTemplate` a `apps/web/src/api/templates.ts`, invalidando `publishedTemplates()` y `templates()` como ya hacen retirar y reactivar.
- [x] 3.2 Extender `TemplatesRoute/presentation.ts` con el estado archivado —predicado, etiqueta `Archived`, clase del pill y la partición entre visibles y archivadas— con su `presentation.test.ts`.
- [x] 3.3 Agregar `Show archived` a la cabecera de `PublishedTemplates`, visible solo cuando hay archivadas y solo para quien administra, y componer la tabla con las dos listas.
- [x] 3.4 Ajustar el menú de `PublishedRow`: `Archive template` solo en filas retiradas, `Restore` como única acción en las archivadas, y `Reactivate` fuera de ellas.
- [x] 3.5 Confirmar el archivo con un modal que explique qué no cambia, reusando la pieza de `DeactivateTemplateDialog`.
- [x] 3.6 Cubrir en `TemplatesRoute/index.test.tsx`: la archivada omitida por defecto, el toggle, archivar tras confirmar, restaurar, y que una cuenta sin permiso no reciba ninguno de los controles.

## 4. Verificación

- [x] 4.1 Validar el change con `openspec validate archive-deactivated-templates --strict`.
- [x] 4.2 Correr build antes de typecheck, lint, pruebas unitarias y la integración de plantillas contra PostgreSQL.
