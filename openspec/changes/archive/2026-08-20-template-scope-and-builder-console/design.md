## Context

Ver `proposal.md` — Why. Lo que hace falta saber para leer las decisiones:

- **`template_draft` no tiene `site_id` ni RLS**, y eso está argumentado en
  `0003_template_model.sql` §1, `0016_template_drafts.sql` §1 y §5,
  `packages/contracts/src/templates.ts` y `templates.service.ts`. Su autorización es por rol.
- **Tres poblaciones de ubicación**: `site` (las dos plantas, dato de referencia sin RLS),
  `organization_location` (el concepto, sin `site_id`, sin RLS) y `location` (la fila física
  de una planta, con `site_id` y RLS). Una sección de plantilla nombra una
  `organization_location`; el ingest la baja a la `location` de la planta que inspecciona
  (`submissions.service.ts`, `resolveFindingLocations`).
- **El lock de revisión** es un `UPDATE … WHERE id = $1 AND revision = $4`; cero filas
  significa obsoleto o inexistente, y el servicio re-lee para distinguirlos.
- **ADR-002**: la mutabilidad se concede columna por columna y el DELETE está prohibido sin
  excepción. ADR-007: `packages/forms` viaja dentro del service worker.
- **El precache tiene presupuesto** (900 KiB, `apps/web/scripts/check-service-worker.mjs`) y
  **no hay code-splitting**: cualquier dependencia nueva de `apps/web` entra entera.

**Este change no toca ninguna tabla inmutable.** Ni un `ALTER`, `GRANT` o `REVOKE` sobre
`template`, `template_item`, `template_version` o `template_version_item`.

## Goals / Non-Goals

**Goals:**

- Que el alcance de una plantilla sea un dato del borrador, editable, con lock, y validado
  contra el alcance de la sesión.
- Que el mapeo de ubicaciones —que ya existe— sea visible en el momento de escribir la
  plantilla: qué se puede nombrar, y a qué lugar resuelve en cada planta.
- Que la consola se parezca al mockup sin romper ADR-007, ADR-010 ni el presupuesto de
  precache.

**Non-Goals:**

- Publicar. Sigue sin existir; cuando llegue, `site_ids` tiene que viajar a `template`.
- Alcance por sección como campo. Se deriva del mapeo de su ubicación.
- Editar `visible_when`. Se sigue arrastrando intacto.
- Tocar `packages/forms`. El alcance no es parte del documento.

## Decisions

### 1. `site_ids uuid[]` en `template_draft`, no una tabla puente

El alcance es estado editable de un borrador y tiene que viajar **dentro del mismo `UPDATE`
con lock de revisión**. Una tabla puente `template_draft_site` obligaría a borrar filas para
achicar el alcance, y ADR-002 prohíbe el DELETE sin excepción; la alternativa —`deactivated_at`
por fila de alcance— convertiría "esta plantilla es de St. Thomas" en una consulta con filtro
de bajas para responder algo que es una lista de dos elementos.

**Alternativa descartada**: un `enum` `('st_thomas','glencoe','both')`. Es exactamente la
codificación que el catálogo de sitios existe para no tener: las plantas son filas, no
literales, y un tercer sitio obligaría a una migración de datos además de una de esquema.

**El precio**: PostgreSQL no admite FK sobre un elemento de arreglo, así que la integridad
referencial de `site_ids` no la da el motor. Se declara acá para que quede escrito: **es la
única integridad de este change que vive en el servicio y no en la base.** La comprobación es
`site_ids ⊆ session.siteIds`, y `session.siteIds` sale de `user_site_scope` en cada request
(nunca del token), así que un id inventado no pasa. El CHECK de cardinalidad —lo único que sí
puede hacer el motor— cubre el otro extremo, el alcance vacío.

### 2. La validación del alcance es selección, no aislamiento

`sites.service.ts` ya establece el precedente y lo argumenta: filtrar por
`session.siteIds` cuando la tabla no tiene RLS es **elegir de una lista**, no el borde de
seguridad. Acá pasa lo mismo. `template_draft` sigue sin política, sigue siendo contenido de
referencia de la organización, y el borde sigue siendo `requireCoordinator`. El código de
error nuevo (`template_draft_site_out_of_scope`, `422`) existe para que la pantalla pueda
distinguirlo de un rechazo por rol, que es `403` y significa otra cosa.

Es `422` y no `400` por el mismo criterio que `template_draft_name_unusable`: el cuerpo está
bien formado —`site_ids` es un arreglo de uuid no vacío, que es todo lo que el contrato
pide— y lo que falla es qué dice.

### 3. La cobertura de una ubicación se calcula en el cliente, y es una comodidad

Recortar el `<select>` de ubicaciones a las que están mapeadas en TODAS las plantas del
alcance necesita cruzar `organization_location` con `location`. El coordinador ya trae las
dos listas (`listOrganizationLocations`, `listCatalogLocations`), así que el cruce es una
función pura en la ruta y no un endpoint nuevo.

**No se pone en `draftIssues`.** Esa función vive en `packages/forms`, corre dentro del
service worker y sobre el documento solo: darle el catálogo de ubicaciones de las dos plantas
sería darle una entrada que no tiene y que no puede pedir. Además cambiaría de respuesta
según datos que no están en el documento, y hoy su contrato es que el cliente y el servidor
lleguen al mismo veredicto sobre la misma entrada.

Es la misma categoría que `src/permissions/`: **comodidad, no garantía**. La refutación
autoritativa sigue siendo el esquema del documento al publicar, y el comportamiento del
ingest ante una sección sin mapeo (`location_id = NULL`) no cambia.

### 4. Una sección sigue nombrando UNA `organization_location`

El mockup dibuja dos selectores por sección, uno por planta. Guardar un código por planta
volvería a partir la plantilla en dos —que es exactamente lo que `organization_location`
existe para evitar— y obligaría a cambiar `templateDraftSectionSchema` en `packages/forms`,
el documento publicado, `draftIssues` y `resolveFindingLocations`.

Se dibujan las dos cajas, pero la segunda es **la resolución de solo lectura** de la única
ubicación elegida: exactamente lo que el mapeo ya decide. El mockup queda satisfecho y el
modelo no se toca.

### 5. Arrastre a mano con Pointer Events, y los movimientos también en el menú

Una librería de drag-and-drop entra entera al bundle único y por lo tanto al precache, que
tiene presupuesto. Un hook propio (`useSortable.ts`) sobre Pointer Events son ~120 líneas,
cero dependencias, y **funciona con dedo**: los eventos HTML5 de drag no existen en touch, y
la tablet con guantes es el dispositivo de ADR-010.

`Move up` / `Move down` **no desaparecen**: pasan al menú de acciones de cada fila. El
arrastre es el camino cómodo; los botones siguen siendo el camino de teclado, y son los que
ya llaman a `moveSection` / `moveItem`, que son puras y están probadas.

### 6. `PeriodMenu` sube a `src/components/RowMenu.tsx`

El menú ⋮ del mockup es el que `SchedulingRoute` ya tiene, con su manejo de foco y de
Escape. La convención de `CLAUDE.md` es explícita: un subcomponente que aparece en dos rutas
no se duplica, sube a `src/components/`. Se renombra el tipo (`PeriodAction` → `RowAction`) y
el bloque CSS (`.period__menu*` → `.row-menu*`).

### 7. Sin autosave, y el encabezado lo dice

El mockup escribe «Auto-saved 2 min ago». No se implementa: el guardado explícito es lo único
compatible con el lock de revisión, y dos ventanas del mismo autor es el caso normal. El
encabezado dice «Saved revision N» o «Unsaved changes», que es la misma información en el
mismo lugar y no miente.

## Risks / Trade-offs

- **`site_ids` sin FK** → La validación vive en el servicio (decisión 1). Mitigado porque
  `session.siteIds` se lee de `user_site_scope` en cada request y el CHECK cubre el vacío. Un
  test de integración cubre el rechazo.
- **Los borradores existentes quedarían con `site_ids` vacío** → El `DEFAULT '{}'` no alcanza
  porque el CHECK exige al menos uno. La migración hace backfill con **todos los sitios
  activos** antes de agregar el constraint: es el alcance que esos borradores tenían de hecho.
- **El recorte de ubicaciones puede esconder una ubicación que el autor esperaba** → Por eso
  la sección que queda huérfana al ampliar el alcance se REPORTA y no se reescribe, y el
  código guardado no se toca. El camino de salida es el mapeo, en la consola de Locations.
- **El arrastre propio es código nuevo sin librería que lo respalde** → Se acota a un hook
  con su test, y el camino de teclado (menú) queda como red: si el arrastre falla en un
  dispositivo, reordenar sigue siendo posible.
- **La consola crece en archivos** → Es lo que la convención de rutas de `CLAUDE.md` pide
  (un archivo por subcomponente con estado); `index.tsx` queda como composición.

## Migration Plan

1. `apps/api/drizzle/0020_template_draft_site_scope.sql`, escrita a mano como todas
   (`drizzle-kit generate` está prohibido):
   - `ALTER TABLE template_draft ADD COLUMN site_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]`
   - backfill: `UPDATE template_draft SET site_ids = (SELECT coalesce(array_agg(id), '{}') FROM site WHERE deactivated_at IS NULL)`
   - `ADD CONSTRAINT template_draft_site_ids_not_empty CHECK (cardinality(site_ids) >= 1)`
   - `GRANT UPDATE (site_ids) ON template_draft TO hs_app` — suma a la lista de 0016 §4
   - Un bloque de comentario que repita por qué esto **no** es `site_id` y por qué la tabla
     sigue sin RLS, para que quien audite los GRANT no tenga que deducirlo.
2. Contratos, API y web se despliegan juntos: los tres esquemas son `strictObject` y el
   campo entra en todos a la vez.
3. **Rollback**: `DROP CONSTRAINT` + `DROP COLUMN`. No hay dato que se pierda que no se pueda
   volver a derivar (todo el alcance activo), y ninguna tabla publicada se tocó.
