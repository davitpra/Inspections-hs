## 1. Esquema

- [x] 1.1 Escribir `apps/api/drizzle/0020_template_draft_site_scope.sql` a mano: `ADD COLUMN
    site_ids uuid[] NOT NULL DEFAULT '{}'::uuid[]`, backfill con los sitios activos,
      `CHECK (cardinality(site_ids) >= 1)`, y `GRANT UPDATE (site_ids) ON template_draft TO
    hs_app` sumado a la lista de 0016 §4. Cabecera que declare que **no toca ninguna tabla
      inmutable** y que la tabla sigue **sin `site_id` y sin RLS** (ver design.md, decisión 1).
- [x] 1.2 Agregar `site_ids` al esquema Drizzle de `template_draft` en `apps/api/src/db/schema/`.
- [x] 1.3 Correr `pnpm db:migrate` contra la base local y comprobar a mano que `UPDATE
    template_draft SET site_ids = '{}'` falla por el CHECK y que `UPDATE … SET key = …`
      sigue fallando por privilegio.

## 2. Contratos

- [x] 2.1 `packages/contracts/src/templates.ts`: `site_ids: z.array(z.uuid()).min(1)` en
      `templateDraftSummarySchema`, `templateDraftSchema` y `saveTemplateDraftSchema`.
      `createTemplateDraftSchema` NO lo lleva. Comentario que diga por qué el alcance no es
      `site_id` y no viaja al documento.
- [x] 2.2 `pnpm --filter contracts build && pnpm --filter contracts test`.

## 3. API

- [x] 3.1 `templates.errors.ts`: código `template_draft_site_out_of_scope` (`422`) con su
      comentario, sumado a `TemplateDraftErrorCode`.
- [x] 3.2 `templates.repository.ts`: `site_ids` entra al `SET` del UPDATE con lock de
      revisión y al `SELECT` de las lecturas.
- [x] 3.3 `templates.service.ts`: al crear, `site_ids` = alcance de la sesión; al guardar,
      validar `site_ids ⊆ session.siteIds` y no vacío antes de escribir.
- [x] 3.4 Tests de integración en `apps/api/test/`: alcance por defecto al crear, guardado
      que lo achica, rechazo por planta fuera de alcance, rechazo por alcance vacío, y que un
      guardado obsoleto tampoco cambia el alcance.

## 4. Piezas compartidas de la web

- [x] 4.1 Promover `SchedulingRoute/PeriodMenu.tsx` a `src/components/RowMenu.tsx`
      (`PeriodAction` → `RowAction`), renombrar el bloque CSS `.period__menu*` → `.row-menu*`
      en `index.css`, y actualizar los importes de `SchedulingRoute`.
- [x] 4.2 Agregar a `src/components/icons.tsx` los íconos que faltan: `DocumentIcon`,
      `BuildingIcon`, `CopyIcon`, `TrashIcon`, `ChevronIcon`, `GripIcon`.

## 5. Lógica pura de la ruta

- [x] 5.1 `TemplateDraftRoute/edits.ts`: `duplicateSection` y `duplicateItem`, puras, con
      claves nuevas vía `freeKey`, insertadas inmediatamente después del original y sin
      arrastrar `visible_when`.
- [x] 5.2 `TemplateDraftRoute/presentation.ts`: `locationCoverage`, `offerableLocations`,
      `strandedSections`, `scopeLabel`, `sectionAppliesTo`, `summaryCounts`.
- [x] 5.3 Tests de `edits.test.ts` y `presentation.test.ts` para todo lo anterior, con los
      casos de cobertura: mapeada en las dos plantas, en una sola, en ninguna, y compartida
      desactivada.

## 6. La consola

- [x] 6.1 `index.tsx`: sumar `listSites` y `listCatalogLocations`, sostener el alcance en el
      estado editado junto al documento, y quedar como composición sobre el layout de dos
      columnas.
- [x] 6.2 `DraftHeader.tsx`: encabezado de página con ícono, título, subtítulo, píldora de
      estado, «Save draft» y menú de acciones. Dice «Saved revision N» / «Unsaved changes»,
      nunca «Auto-saved».
- [x] 6.3 `ScopePicker.tsx` y `TemplateIdentity.tsx`: nombre de la plantilla, control
      segmentado de alcance construido de `listSites` recortado por `account.siteScope`, y el
      banner informativo.
- [x] 6.4 `SectionCard.tsx`: numeración, colapsar, duplicar y quitar, `<select>` de ubicación
      recortado por cobertura, cajas de resolución por planta, y el aviso de sección
      huérfana.
- [x] 6.5 `ItemRow.tsx`: fila compacta con manija, número, prompt, tipo de respuesta,
      «Required» y menú de acciones (Move up/down, Duplicate, Remove); `ResponseTypeConfig`
      en un bloque desplegable que siga siendo alcanzable.
- [x] 6.6 `TemplateSummary.tsx`: panel derecho con alcance, conteos, desglose por sección y
      `PublishReadiness`.
- [x] 6.7 `useSortable.ts`: arrastre con Pointer Events, cancelable con Escape, que al soltar
      llama a `moveSection` / `moveItem`.
- [x] 6.8 Bloque `builder__*` en `index.css`, sin un solo color literal fuera de `:root` y
      sin primitivas salteando la capa semántica.

## 7. Cierre

- [x] 7.1 Actualizar `TemplateDraftRoute/index.test.tsx` a la estructura nueva: elegir
      alcance, ver el recorte de ubicaciones y la resolución por planta, duplicar y quitar, y
      conservar el caso de guardado rechazado que no borra lo escrito.
- [x] 7.2 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter api
    test:int`, y comprobar que el precache sigue bajo los 900 KiB.
- [x] 7.3 Revisar la consola contra `docs/mock/template builder desktop.png` en `pnpm dev`, y
      en una ventana angosta que el panel derecho baje debajo del editor.
