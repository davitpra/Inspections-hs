# Revisar una plantilla publicada

## Why

Requisitos §7 **etapa 8** — el coordinador deja de depender del desarrollador. La etapa está
a medias: puede escribir una plantilla y publicarla como versión 1, y ahí se queda. Si la
pregunta 4 quedó mal redactada, la única salida es publicar otra plantilla con otra clave y
otro juego de `item_key`, que es exactamente lo que el modelo existe para evitar: la serie de
recurrencia se parte en dos y la planta queda con dos plantillas casi iguales ofrecidas para
programar.

El modelo publicado ya sabe hacer esto. `template_version.version` es un entero con
`UNIQUE (template_id, version)`, el trigger `hs_template_version_next()` ya exige que la
siguiente sea exactamente `max + 1`, y la mitad de la spec de `templates` está escrita en
términos de v1 → v2 → v3: reformular, mover de sección, reordenar y cambiar `response_type`
conservando el `item_key`. Lo único que falta es el camino de escritura.
`insertVersion` escribe `VALUES ($1, 1, ...)` y `publishDraft` siempre inserta una `template`
nueva primero, así que publicar bajo una clave existente muere con `template_key_taken`.

Los tres proposals archivados que llegaron hasta acá lo dejaron nombrado como el próximo
change: sembrar un borrador desde la última versión publicada preservando `item_key`.

## Lo que este change NO es

- **No es un historial de versiones.** Se puede leer una versión por su id
  (`GET /templates/versions/:versionId`) y eso alcanza. Una pantalla que liste las versiones
  de una plantilla es otra cosa y no la necesita ninguna decisión de este change.
- **No es dar de baja una plantilla ni una pregunta.** Sacar una pregunta de la versión nueva
  la deja ausente de esa versión y nada más: la fila `template_item` queda activa, las
  versiones históricas la siguen resolviendo y su serie de recurrencia termina sola.
  `template_item.deactivated_at` sigue sin tener quien lo escriba, y `hs_app` sigue sin
  `UPDATE` sobre `template` ni sobre `template_item`.
- **No es renombrar una plantilla publicada.** `template.name` no es actualizable por ningún
  camino de aplicación, y una revisión no lo vuelve actualizable: el nombre y la clave de la
  plantilla son de la plantilla, no de la versión.
- **No es un flujo de aprobación ni una segunda firma** (fuera de alcance en v1).
- **No es duplicar una plantilla publicada como plantilla nueva.** Copiar el documento con
  claves nuevas es una operación distinta, con la consecuencia opuesta sobre la recurrencia.

## What Changes

- Un borrador puede nacer **ligado a una plantilla publicada**: nueva columna
  `template_draft.template_id`, nula en el borrador de una plantilla nueva. Nace con el
  documento de la última versión publicada, con la clave y el nombre de la plantilla, y con
  cada `item_key` tal como está.
- `POST /templates/:templateId/revisions` — siembra ese borrador, o devuelve el borrador de
  revisión que ya esté vivo para esa plantilla. Del coordinador, como el resto de la autoría.
- Publicar un borrador de revisión escribe **una versión más** de la misma plantilla:
  `version = max + 1`, sin `INSERT` en `template`, y registrando en `template_item` solo los
  `item_key` que el documento agregó.
- El builder muestra que está revisando: el nombre queda de solo lectura, y el diálogo de
  publicación dice qué número de versión va a crear en vez de decir siempre «version 1».
- La vista de una versión publicada ofrece **Revise** — hoy dice que para corregir hay que
  publicar una versión nueva y no hay ningún botón que lo haga.

## Capabilities

### Modified Capabilities

- **templates** — publicar deja de ser «un borrador se convierte en la versión 1 de una
  plantilla nueva» y pasa a ser «un borrador se convierte en la próxima versión de su
  plantilla, que puede no existir todavía».

## Impact

- **Migración**: `0028_revise_published_template.sql` — `template_draft.template_id` con FK
  a `template`, unicidad parcial de un borrador de revisión vivo por plantilla, y los dos
  índices parciales de clave y nombre reescritos para que no cuenten a los borradores de
  revisión (que llevan a propósito la clave y el nombre de su plantilla). Ningún GRANT nuevo
  sobre el modelo publicado: la publicación ya tiene `INSERT` desde 0025 y no necesita más.
- **`packages/forms`**: `draftFromDocument`, la inversa de `normalizeDraft`. Pura, sin reloj
  ni azar (ADR-007).
- **API**: `templates.repository.ts`, `templates.service.ts`, `templates.controller.ts`,
  `templates.errors.ts`, esquema espejo `db/schema/templates.ts`.
- **Contratos**: `templateDraftSummarySchema` gana `template_id` y `next_version`.
- **Web**: `PublishedTemplateRoute` (el botón), `TemplateDraftRoute` (nombre bloqueado,
  diálogo), `TemplatesRoute` (el listado distingue una revisión), `api/templates.ts`.
- **Tabla inmutable tocada**: `template_version`, y solo con `INSERT`. Ninguna fila existente
  se modifica; `hs_make_immutable` sigue en pie y no se le concede ningún permiso nuevo.
- **Desbloquea**: la corrección de una plantilla sin desarrollador, que es lo que la etapa 8
  prometía. Y deja el modelo con lo que la spec de recurrencia ya afirma: una serie contigua
  a través de tres versiones.
