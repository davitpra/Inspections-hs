## Why

Etapa 8 de §7 — el builder visual — está a medias: el coordinador ya escribe secciones,
preguntas y tipos de respuesta, pero la pantalla no le dice **para qué plantas está
escribiendo**. Con dos plantas y un catálogo de ubicaciones compartidas que cada planta
mapea por separado, esa ausencia tiene consecuencias: el selector de ubicación de una
sección ofrece hoy TODAS las ubicaciones compartidas activas, incluidas las que ninguna de
las plantas donde la plantilla se va a usar tiene tickeadas. Una sección así se guarda sin
protestar, se publica sin protestar, y falla recién en el ingest — donde
`resolveFindingLocations` no encuentra mapeo y el hallazgo nace con `location_id = NULL`,
meses después y lejos de quien escribió la plantilla.

El mockup acordado (`docs/mock/template builder desktop.png`) pone esa decisión primero: el
alcance de la plantilla arriba de todo, y cada sección mostrando a qué lugar físico resuelve
en cada planta. Este change hace real ese dato y rediseña la consola para que la información
que ya existe —el mapeo de ubicaciones— sea visible en el momento en que se escribe la
plantilla, y no en el momento en que se rompe.

## What Changes

- **`template_draft` declara sus plantas.** Columna nueva `site_ids uuid[]`, no vacía,
  dentro del mismo `UPDATE` con lock de revisión que ya protege al borrador. Sigue **sin
  RLS y sin `site_id`**: el alcance dice *dónde se usa* la plantilla, no *de quién es*; la
  decisión de 0003 §1 y 0016 §1 —una plantilla es contenido de referencia de la
  organización— queda intacta y se argumenta de nuevo en la migración.
- **El servicio valida el alcance** contra el de la sesión: guardar un borrador con una
  planta que la cuenta no administra se rechaza. Es selección, no aislamiento, con el mismo
  criterio que `sites.service.ts`.
- **BREAKING (contrato interno)** — `templateDraftSchema`, `templateDraftSummarySchema` y
  `saveTemplateDraftSchema` son `strictObject`: el campo `site_ids` entra en los tres a la
  vez y ningún cliente viejo guarda contra la API nueva. No hay clientes fuera de este repo.
  `createTemplateDraftSchema` **no** lo pide: un borrador nace con todo el alcance de la
  cuenta y el autor lo achica.
- **El selector de ubicación de una sección se recorta al alcance elegido**: solo se ofrecen
  las ubicaciones compartidas mapeadas en TODAS las plantas del alcance. Es la promesa que
  el mockup de location mapping ya escribió («Locations only appear in the template builder
  for the plants they are ticked for») y que hoy no se cumple.
- **La consola se rediseña** según el mockup: encabezado de página, panel de resumen a la
  derecha (alcance, conteos, desglose por sección y estado de publicación), secciones
  numeradas y colapsables, duplicar sección y pregunta, filas de pregunta compactas con menú
  de acciones, y reordenamiento por arrastre con los movimientos también en el menú para
  teclado (ADR-010).
- **Lo que NO cambia, y es deliberado**: el título de una sección se sigue copiando del
  catálogo (spec `templates` línea 60); una sección sigue nombrando UNA
  `organization_location` —las dos cajas por planta del mockup son la resolución de solo
  lectura de esa única ubicación—; no hay autosave, porque el guardado explícito es lo único
  compatible con el lock de revisión; y no hay alcance por sección, porque se deriva del
  mapeo de su ubicación.

## Capabilities

### New Capabilities

Ninguna. El change extiende `templates` y lee de `catalog` sin modificarla.

### Modified Capabilities

- `templates`: el borrador declara las plantas donde la plantilla se va a usar, ese alcance
  se valida contra el de la sesión al guardar, sobrevive al lock de revisión, y recorta qué
  ubicaciones compartidas puede nombrar una sección.

## Impact

**Esquema** — `apps/api/drizzle/0020_template_draft_site_scope.sql`: `ALTER TABLE
template_draft ADD COLUMN site_ids`, CHECK de cardinalidad, y `site_ids` sumado al
`GRANT UPDATE` de 0016 §4. No toca ninguna tabla inmutable: ni un `ALTER`, `GRANT` o
`REVOKE` sobre `template`, `template_item`, `template_version` o `template_version_item`.

**Contratos** — `packages/contracts/src/templates.ts`. `packages/forms` **no se toca**: el
alcance no es parte del documento y no viaja al service worker.

**API** — `apps/api/src/templates/{templates.repository.ts,templates.service.ts}` y el
esquema Drizzle `apps/api/src/db/schema/`. Sin cambio de firma en el controller.

**Web** — `apps/web/src/routes/TemplateDraftRoute/` entera, más
`apps/web/src/components/icons.tsx`, la promoción de `SchedulingRoute/PeriodMenu.tsx` a
`src/components/RowMenu.tsx`, y un bloque nuevo en `apps/web/src/index.css`. La ruta pasa a
consumir `listSites` y `listCatalogLocations`, que ya existen.

**Fuera de alcance** — publicar sigue sin existir (segunda mitad de etapa 8). Cuando llegue,
`site_ids` tiene que viajar del borrador a `template`; queda anotado y no se implementa acá.
