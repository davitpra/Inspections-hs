## 1. Contrato

- [x] 1.1 `packages/contracts/src/templates.ts`: `publishedTemplateVersionSchema` —
      `template_id`, `template_version_id`, `key`, `name`, `version`, `published_at`, `document`
      con `templateDocumentSchema`— y su tipo `PublishedTemplateVersion`, exportados desde
      `index.ts`. Docblock: por qué las dos identidades viajan con el documento y por qué la
      fecha es `string`.
- [x] 1.2 `packages/contracts/src/templates.test.ts`: acepta una versión completa; rechaza un
      `document` sin secciones, un `version` `0` y una clave de más (`strictObject`).

## 2. API

- [x] 2.1 `templates.errors.ts`: `TemplateVersionException` con el código
      `template_version_not_found` y `404` (decisión 4 del design). No se agrega a
      `TemplateDraftErrorCode`.
- [x] 2.2 `templates.service.ts`: `getPublishedVersion(session, versionId)` con su consulta
      —`template_version.id AS template_version_id`, `JOIN template` para `key` y `name`,
      `published_at::text`— vía `withSessionClient`, sin `requireCoordinator`. Docblock: por su
      id y nunca "la más alta", y por qué no pasa por `templates.repository.ts`.
- [x] 2.3 `templates.controller.ts`: `@Get('versions/:versionId')`, id validado con
      `z.uuid().parse`. Actualizar el docblock del controlador, que hoy describe dos
      poblaciones y ahora tiene una lectura del modelo publicado además de `list`.
- [x] 2.4 `apps/api/test/template-drafts.int-spec.ts`: publicar un borrador y leer la versión
      que devolvió — documento igual al publicado,
      `template_id`/`template_version_id`/`key`/`name`/`version`/`published_at` correctos; un
      `supervisor` la lee igual; una cuenta alcanzada a la otra planta la lee igual; un uuid
      inexistente da `template_version_not_found`.

## 3. Cliente: la lectura

- [x] 3.1 `apps/web/src/api/templates.ts`: `getPublishedTemplateVersion(id)` parseando contra
      el esquema, con la nota de que es online como el resto del archivo.
- [x] 3.2 `apps/web/src/api/query-keys.ts`: `publishedTemplateVersion(id)` con la clave
      `['published-template-version', id]`, separada tanto de `templates()` como de
      `templateVersionPackage()` por la decisión 9 del design.

## 4. Cliente: la pantalla

- [x] 4.1 `routes/PublishedTemplateRoute/presentation.ts` + `.test.ts`: conteo de preguntas;
      `visibilityLabel(visibleWhen, document)` para condición simple, `all_of` y `any_of`, con
      caída al `item_key`; configuración discriminada para los nueve tipos; y umbral de fallo.
      Los mapas de operadores son exhaustivos. El orden sale de `sectionsInDocumentOrder`, no
      de un `sort` nuevo.
- [x] 4.2 `routes/PublishedTemplateRoute/ItemRow.tsx`: `prompt`, etiqueta del tipo de
      respuesta (`RESPONSE_TYPE_LABELS`), obligatoriedad, configuración concreta, `item_key`,
      condición de visibilidad y la prescripción completa —acción correctiva y `fails_when`—
      cuando la hay. Sin un solo control.
- [x] 4.3 `routes/PublishedTemplateRoute/SectionCard.tsx`: título, ubicación de organización
      si la declara, su condición si la tiene, y sus ítems.
- [x] 4.4 `routes/PublishedTemplateRoute/VersionHeader.tsx`: nombre, clave, versión, fecha de
      publicación y el aviso de que una versión publicada está congelada y que corregirla es
      publicar una nueva.
- [x] 4.5 `routes/PublishedTemplateRoute/index.tsx`: la consulta, los estados de carga y
      error (mismos `.status-card` que el resto de `/templates`), y la vuelta a `/templates`.
- [x] 4.6 `app/router.tsx`: la ruta `/templates/versions/$versionId`. Comprobar que sigue
      fuera de `CAPTURE_ROUTES` en `sw.ts` (que no debería cambiar) y que el presupuesto de
      precache del build no se mueve.
- [x] 4.7 `routes/TemplatesRoute/PublishedRow.tsx`: el nombre pasa a ser `<Link>` a la
      versión que la fila nombra (`latest_version_id`), como en `DraftRow`.

## 5. Estilos y pruebas de pantalla

- [x] 5.1 `index.css`: el bloque de la pantalla nueva, sin un solo color literal fuera de los
      tokens (`scripts/check-tokens.mjs`).
- [x] 5.2 `routes/PublishedTemplateRoute/index.test.tsx`: dibuja secciones e ítems en orden;
      muestra obligatoriedad y configuración de respuesta; muestra la acción correctiva y el
      umbral prescritos; dice la condición de una pregunta condicional; no ofrece ningún control
      de edición; dice que está congelada; el error de red se lee como tal.
- [x] 5.3 `routes/TemplatesRoute/index.test.tsx`: la fila publicada enlaza a la versión que
      nombra.

## 6. Cierre

- [x] 6.1 `pnpm -r build && pnpm typecheck && pnpm lint && pnpm test`, y
      la integración específica `template-drafts.int-spec.ts` (52/52) para 2.4. La suite
      completa de integración excede el timeout operativo de 5 minutos.
- [x] 6.2 Revisar que ningún docblock quede mintiendo: el del controlador de plantillas, el
      de `TemplatesRoute/index.tsx` (que hoy dice que una publicación solo aparece contada) y
      el de `PublishedTemplates.tsx`.
