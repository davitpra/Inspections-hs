## 1. Mudanza del documento a `packages/forms`

- [x] 1.1 Agregar `zod` como dependencia de `packages/forms` y dejar escrito en el
      `description` del `package.json` por qué no viola ADR-007 (isomórfico, sin builtins).
- [x] 1.2 Mover `packages/contracts/src/template-document.ts` a
      `packages/forms/src/document/schema.ts` sin cambiar comportamiento, y mover su test junto
      con él. Exportarlo desde `packages/forms/src/index.ts`.
- [x] 1.3 Dejar `packages/contracts/src/template-document.ts` como re-export de `@hs/forms`,
      agregar `@hs/forms` como dependencia de `packages/contracts` y verificar que ningún import
      de `apps/api` cambia.
- [x] 1.4 `pnpm typecheck`, `pnpm test` y `pnpm lint` verdes antes de agregar nada nuevo: este
      paso es una mudanza, no un cambio de semántica.

## 2. Tipos de ítem — unión discriminada

- [x] 2.1 Reemplazar `templateItemSchema` por una unión discriminada por `response_type` con
      `yes_no`, `yes_no_na`, `scale`, `text`, `number`, `single_choice`, `multi_choice`, `photo`
      y `signature`. Cada variante en `strictObject`, con los campos comunes (`item_key`,
      `prompt`, `position`, `required`) más los suyos.
- [x] 2.2 Configuración por tipo con sus refinamientos: `scale` (`min` < `max`); `text`
      (`max_length` > 0); `number` (`min` <= `max`, `decimals` >= 0); `single_choice` y
      `multi_choice` (`options` no vacío, `value` únicos); `multi_choice` (`min_selected` <=
      `max_selected` <= `options.length`); `photo` (`0` <= `min_count` <= `max_count`).
- [x] 2.3 Actualizar `RESPONSE_TYPES` a los nueve valores y mantener el orden estable — la
      migración 6.2 y el test 7.4 comparan contra esta lista.
- [x] 2.4 Tests unitarios del esquema, uno por escenario de la spec: rango invertido de `scale`,
      `value` duplicado en `options`, `min_selected` mayor que la cantidad de opciones, y campo
      de configuración ajeno al tipo (`text` con `options`).
- [x] 2.5 Definir el tipo de la respuesta por cada `response_type` (`AnswerFor<T>`): `boolean`;
      `'yes'|'no'|'na'`; entero; string; number; string; string[]; array de object keys;
      `{ object_key, signed_at }`.

## 3. Lógica condicional

- [x] 3.1 Agregar `visible_when` opcional a sección e ítem: condición suelta, o `all_of` /
      `any_of` de condiciones. Condición = `{ item_key, operator, value? }` con `operator` en
      `equals`, `not_equals`, `in`, `gte`, `lte`, `answered`, `unanswered`.
- [x] 3.2 Refinamiento a nivel documento: toda `item_key` referenciada existe y aparece
      estrictamente antes en orden de documento. Mensaje que nombre al ítem que referencia y a
      la key referenciada.
- [x] 3.3 `evaluateVisibility(document, answers)` — función pura que devuelve, por `item_key`, si
      el ítem es visible. Una sección oculta oculta todos sus ítems sin importar su propio
      `visible_when`.
- [x] 3.4 Tests: condición que se cumple, ítem fuente sin responder, sección oculta que arrastra
      sus ítems, referencia hacia adelante rechazada en carga, referencia a key inexistente
      rechazada en carga.

## 4. Validación de un conjunto de respuestas

- [x] 4.1 `validateAnswers(document, answers)` devolviendo `{ ok: true }` o
      `{ ok: false, violations }`, con `violations` completa — nunca corta en la primera. Cada
      violación con `item_key` y un `code` estable.
- [x] 4.2 Implementar los códigos: `required_missing`, `wrong_shape`, `out_of_range`,
      `too_many_decimals`, `too_long`, `unknown_option`, `duplicate_option`,
      `selection_count_out_of_range`, `photo_count_out_of_range`, `unknown_item`,
      `answer_for_hidden_item`.
- [x] 4.3 Reusar `evaluateVisibility` dentro de la validación: un ítem oculto no exige respuesta
      y no puede traerla.
- [x] 4.4 Tests por escenario de la spec: requerido faltante, tres violaciones en una sola
      corrida, respuesta a ítem oculto, requerido dentro de sección oculta que no se exige,
      `scale` fuera de rango, `item_key` desconocida, opcional sin responder que pasa.
- [x] 4.5 El determinismo del motor, por regla de lint y no por revisión: bloque `forbidImpurity`
      en `eslint.config.js` que prohíbe `Date.now()`, `new Date()`, `Math.random()`, `fetch` y
      `XMLHttpRequest` dentro de `packages/forms`. Sin eso la tabla de casos del grupo 5 no
      significa nada.

## 5. Tabla de casos compartida y regla de lint

- [x] 5.1 `packages/forms/src/testing/cases.ts` — array exportado de casos
      `{ name, document, answers, expected }`, sin `describe` ni `it`, más el comparador
      `runEngineCase`. Se expone por el subpath `@hs/forms/testing` y no por el índice: los casos
      no tienen por qué viajar dentro del bundle del service worker.
- [x] 5.2 Poblar la tabla con al menos un caso por tipo de ítem, uno por código de violación y
      tres de lógica condicional.
- [x] 5.3 Test unitario en `packages/forms` que itera la tabla, y test de integración en
      `apps/api` que itera la **misma** tabla importada contra el motor. Un desacuerdo nombra el
      caso ofensor.
- [x] 5.4 Test que ejerce la regla de lint de ADR-007, en `packages/config`: `ESLint.lintText`
      con un `filePath` virtual dentro de `packages/forms` — sin fixture en disco que después
      rompa `pnpm lint` de verdad. Cubre builtin, `process`, `Buffer`, reloj, azar y red.

## 6. Migración 0007 — ampliar el modelo publicado

- [x] 6.1 Crear `apps/api/drizzle/0007_forms_engine_response_types.sql`. Cabecera con el SQLSTATE
      que use y la nota de que corre con `hs_migrator`: es DDL sobre tablas inmutables y no
      ejecuta ni un `UPDATE` de fila.
- [x] 6.2 `ALTER TABLE template_version_item DROP CONSTRAINT` del `CHECK` de `response_type` y
      `ADD CONSTRAINT` con los nueve valores de `RESPONSE_TYPES`.
- [x] 6.3 `ALTER TABLE template_version_item ADD COLUMN config jsonb` y
      `ADD COLUMN visible_when jsonb`, ambas nulables — reproyectar filas ya publicadas exigiría
      escribir sobre una tabla inmutable (design, Risks).
- [x] 6.4 `CREATE OR REPLACE FUNCTION` del trigger de proyección de `0003` para que copie a
      `config` la configuración específica del tipo y a `visible_when` la condición del ítem.
- [x] 6.5 Confirmar que las columnas nuevas quedan cubiertas por el `REVOKE UPDATE, DELETE` y por
      el trigger de inmutabilidad ya aplicados a la tabla en `0003` — son a nivel tabla, no a
      nivel columna, así que no hay que re-aplicar `hs_make_immutable()`; dejarlo escrito en el
      comentario de la migración.
- [x] 6.6 Actualizar `apps/api/src/db/schema/templates.ts` con las columnas nuevas y el tipo
      ampliado de `response_type`.

## 7. Integración y cierre

- [x] 7.1 Test de integración: publicar un documento con `signature`, `multi_choice` y `photo`;
      verificar que las filas de `template_version_item` llevan el `response_type` correcto y el
      `config` proyectado.
- [x] 7.2 Test de integración: `INSERT` en `template_version_item` con
      `response_type = 'rating_stars'` falla con violación de `CHECK`.
- [x] 7.3 Test de integración: tras aplicar `0007`, los `document` y `response_type` de las filas
      preexistentes (seed `001_monthly_general_inspection.sql`) son idénticos a los de antes.
- [x] 7.4 Test de integración que compara la lista de valores del `CHECK` real, leída de
      `pg_constraint`, contra `RESPONSE_TYPES` — la duplicación es deliberada (design) y no puede
      divergir en silencio.
- [x] 7.5 `pnpm lint`, `pnpm typecheck`, `pnpm test` y la suite de integración verdes; actualizar
      el comentario de etapa en `packages/forms/src/index.ts` que hoy dice que el motor llega en
      la etapa 3.
