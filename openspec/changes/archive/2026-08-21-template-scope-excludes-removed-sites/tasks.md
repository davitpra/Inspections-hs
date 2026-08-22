## 1. API — la lectura de plantas activas

- [x] 1.1 `templates.repository.ts`: `activeSiteIds(client, siteIds)` con
      `SELECT id FROM site WHERE id = ANY($1::uuid[]) AND deactivated_at IS NULL`, junto a las
      demás lecturas. Comentario que la ate al precedente de `roster/apply-roster.ts:116` y a
      que `site` no tiene política RLS (0004), así que el `WHERE` es selección y no aislamiento.
- [x] 1.2 `templates.errors.ts`: agregar `'template_draft_site_deactivated'` a
      `TemplateDraftErrorCode` y su factory `422`, con el comentario que distinga los dos
      rechazos —«esa planta no es tuya» vs. «esa planta ya no existe»— siguiendo el estilo del
      bloque de `templateDraftSiteOutOfScope`. Mensaje en inglés.

## 2. API — el servicio

- [x] 2.1 `templates.service.ts::saveDraft`: dentro del `withSessionClient`, después de
      `requireSitesInScope` y antes de `isNameTakenByAnother`, comparar `input.site_ids` contra
      `activeSiteIds` y lanzar el error nuevo si falta alguno. No se toca `requireSitesInScope`:
      sigue siendo síncrona y sobre la sesión.
- [x] 2.2 `templates.service.ts::createDraft`: sembrar `siteIds` con
      `await activeSiteIds(client, session.siteIds)` en vez del arreglo crudo, y actualizar el
      comentario `TODO EL ALCANCE DE LA CUENTA` para que diga «todo el alcance ACTIVO», con el
      porqué: una planta dada de baja no se puede inspeccionar.
- [x] 2.3 Confirmar que `getDraft` y `listDrafts` quedan intactos: un borrador ya alcanzado a
      una planta cerrada se sigue leyendo entero (design.md, «El check corre en el guardado»).

## 3. Web — el selector

- [x] 3.1 `TemplateDraftRoute/presentation.ts::scopeOptions`: filtrar `deactivated_at === null`
      antes de ordenar. `scopeLabel`, `scopeNotice` y `sectionAppliesTo` NO se tocan.
- [x] 3.2 Extender el comentario de `scopeOptions` con la decisión: la baja no saca la planta de
      `user_site_scope`, así que el selector filtra por su cuenta; y por qué el filtro no sube al
      `index.tsx` (rompería el `Both plants` de `scopeLabel` y dejaría un `site_ids` viejo sin
      nombre). Mencionar que `SitePicker` resuelve lo mismo al revés y por qué está bien.
- [x] 3.3 Verificar que `ScopePicker` no necesita cambios: con una sola opción ya devuelve `null`
      en su guardia `options.length < 2`.

## 4. Tests

- [x] 4.1 `presentation.test.ts`: `scopeOptions` con dos plantas, una con `deactivated_at`,
      devuelve una sola opción y su etiqueta es el nombre pelado (sin `only`).
- [x] 4.2 `template-drafts.int-spec.ts`: guardar con `site_ids` que nombra una planta con
      `deactivated_at` → `422` con `template_draft_site_deactivated`, y el borrador almacenado
      sin cambios. Espejo del caso de `:614`.
- [x] 4.3 `template-drafts.int-spec.ts`: crear un borrador con una planta del alcance dada de
      baja → el `site_ids` resultante nombra solo la activa.
- [x] 4.4 `template-drafts.int-spec.ts`: leer un borrador cuyo `site_ids` guardado nombra una
      planta dada de baja después de guardarlo → sigue devolviendo las dos.

## 5. Cierre

- [x] 5.1 `pnpm -r build && pnpm typecheck && pnpm lint`.
- [x] 5.2 `pnpm --filter web exec vitest run src/routes/TemplateDraftRoute/presentation.test.ts`
      y `pnpm --filter api exec vitest run --config vitest.integration.config.mts test/template-drafts.int-spec.ts`.
- [x] 5.3 A mano contra la base de dev: abrir `/templates/drafts/$id` y confirmar que el
      selector de alcance ya no ofrece la planta cerrada; crear un borrador nuevo desde
      `/templates` y confirmar que nace alcanzado solo a la planta activa.
