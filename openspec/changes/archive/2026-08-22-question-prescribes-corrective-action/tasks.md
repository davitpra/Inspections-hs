## 1. La jerarquía de controles se muda al motor

- [x] 1.1 Crear `packages/forms/src/document/controls.ts` con `CONTROL_LEVELS`,
      `controlLevelSchema`, el tipo `ControlLevel` y `FAILURE_OPERATORS` /
      `failureOperatorSchema` (`lt`, `lte`, `gt`, `gte`). Traer el comentario de la jerarquía de
      `packages/contracts/src/findings.ts` — es el que explica que el sistema registra el nivel y
      no lo juzga.
- [x] 1.2 Exportarlos desde `packages/forms/src/index.ts`.
- [x] 1.3 En `packages/contracts/src/findings.ts`, borrar la definición y re-exportar desde
      `@hs/forms`, con el patrón y la nota de `packages/contracts/src/template-document.ts`.
- [x] 1.4 Confirmar que `packages/contracts/src/findings.test.ts` pasa sin tocarlo y que
      `apps/api/src/db/schema/findings.ts` sigue importando de `@hs/contracts`.

## 2. El bloque `finding` en el documento

- [x] 2.1 En `packages/forms/src/document/draft.ts`, agregar a `draftItemBase` el campo opcional
      `finding` (`corrective_action`, `control_level`, `fails_when?` con `operator` y `value`),
      documentando por qué es un bloque y no tres campos sueltos (design §1).
- [x] 2.2 En `packages/forms/src/document/schema.ts`, agregar el **mismo** campo opcional a
      `itemBase`, con el comentario que explica que sin esto la red de seguridad de `draftIssues`
      marcaría no publicable a todo borrador que lo use (design §2).
- [x] 2.3 `defaultItemConfig` no cambia: un ítem nace sin `finding`. Dejarlo dicho si el archivo
      lo amerita.
- [x] 2.4 Tests en `packages/forms/src/document/schema.test.ts`: el documento congelado acepta un
      ítem con `finding` y uno sin él; rechaza un `control_level` desconocido y un `operator`
      desconocido.

## 3. Los issues nuevos de publicabilidad

- [x] 3.1 En `draftIssues`, emitir un issue por ítem cuando `finding` está presente y
      `corrective_action` está en blanco.
- [x] 3.2 Emitir un issue cuando `fails_when` está presente en un ítem que no es `scale` ni
      `number`.
- [x] 3.3 Emitir un issue cuando `fails_when.value` cae fuera del `[min, max]` del propio ítem.
- [x] 3.4 Cada issue con el `path` del ítem (`['sections', i, 'items', j]`), como los existentes.
- [x] 3.5 Tests en `packages/forms/src/document/draft.test.ts`, uno por issue, **más** el que
      cubre el riesgo del design §2: un borrador completo **con** `finding` válido es publicable
      y no reporta ningún issue.

## 4. Las ediciones puras del borrador

- [x] 4.1 `setFinding(document, sectionIndex, itemIndex, finding | null)` en
      `apps/web/src/routes/TemplateDraftRoute/edits.ts`, con `withItem`, al estilo de `setConfig`.
      `null` borra el bloque.
- [x] 4.2 En `changeResponseType`, conservar `finding` y recortar `fails_when` cuando el tipo
      nuevo no puede llevarlo (design §4).
- [x] 4.3 Confirmar que `duplicateItem` arrastra el bloque — lo hace solo si copia el ítem
      entero; si no, corregirlo.
- [x] 4.4 Tests en `edits.test.ts` para 4.1, 4.2 y 4.3.

## 5. El sheet

- [x] 5.1 `presentation.ts`: `CONTROL_LEVEL_OPTIONS` y las etiquetas de operador (en inglés, sin
      i18n), `defaultFinding(responseType)` y el rótulo del botón de la fila (`Add finding` /
      `Edit finding` según haya bloque o no).
- [x] 5.2 `FindingSheet.tsx` (nuevo) sobre el `Sheet` de `apps/web/src/app/Sheet.tsx`
      (`side="end"`), con estado local y `onSave(finding | null)` una sola vez al confirmar
      (design §5). Adentro: la pregunta y el tipo de respuesta en solo lectura, el `textarea` de
      acción correctiva, el `select` de nivel de control, y el par operador + valor **solo**
      cuando el tipo es `scale` o `number`, con el texto de ayuda que aclara que el umbral
      todavía no deriva un hallazgo.
- [x] 5.3 `ItemRow.tsx`: usar el rótulo de 5.1 en el botón que ya existe.
- [x] 5.4 `SectionCard.tsx`: `useState<number | null>` del ítem abierto, pasar `onAddFinding` a
      `ItemRow` y montar `FindingSheet` condicionalmente (patrón de `LocationsRoute/index.tsx`).
- [x] 5.5 `SectionList.tsx`: sumar `setFinding` a `itemHandlers()`, llamando a `edits.setFinding`
      y a `write`.
- [x] 5.6 Estilos del contenido del sheet en `apps/web/src/index.css`, sin colores literales
      (`scripts/check-tokens.mjs`). La clase `.item-editor__corrective` ya está.
- [x] 5.7 Tests: `presentation.test.ts` para 5.1, e `index.test.tsx` para el recorrido completo —
      abrir el sheet desde la fila, ver la pregunta y el tipo, escribir la acción, guardar, y que
      el borrador quede sucio; cancelar con Escape y que no quede sucio; el umbral aparece en un
      `number` y no en un `yes_no`.

## 6. Sin esquema, pero con evidencia

- [x] 6.1 **Sin migración**: `template_draft.document` es `jsonb` y ya está en el `GRANT UPDATE`
      de `0021`; el trigger `hs_template_project_items()` proyecta ocho columnas y no ve el campo
      nuevo. No hay REVOKE ni RLS que escribir porque no hay tabla nueva ni columna nueva.
- [x] 6.2 Caso en `apps/api/test/template-drafts.int-spec.ts`: guardar un borrador con `finding` y
      `fails_when` y releerlo idéntico, para que quede probado que el campo sobrevive el
      round-trip por `jsonb`.

## 7. Comprobación

- [x] 7.1 `pnpm -r build` y después `pnpm typecheck` — en ese orden.
- [x] 7.2 `pnpm lint` y `pnpm test`.
- [ ] 7.3 `pnpm --filter api test:int`.
- [x] 7.4 `pnpm --filter web build` — `check-tokens.mjs` y el presupuesto de precache de
      `check-service-worker.mjs`.
- [x] 7.5 A mano con `pnpm dev`: abrir un borrador, prescribir sobre una pregunta `yes_no` y una
      `number`, guardar, recargar y comprobar que el texto sigue ahí.
