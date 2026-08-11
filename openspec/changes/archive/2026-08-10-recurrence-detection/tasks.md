## 1. El contrato

- [x] 1.1 `packages/contracts/src/reporting.ts`: `RECURRENCE_GROUPINGS = ['item_location',
      'item']` con su `z.enum` y el default `item_location`, y `recurrenceQuerySchema` con
      `window_months` (`z.coerce.number().int().min(1).max(60).default(12)`) y `group_by`. El
      comentario dice que los dos modos son los de §6-bis pregunta 11 y qué responde cada uno
      (D4).
- [x] 1.2 En el mismo archivo, `recurrenceSeriesSchema`: `site_id`, `item_key`, `item_prompt`,
      `location_id` (nullable, null en modo `item`), `location_count`, `occurrence_count`,
      `template_version_item_count`, `first_occurred_at`, `last_occurred_at`, `finding_ids`.
      Y `recurrenceReportSchema`: `window_months`, `group_by`, `excluded_manual_count`,
      `series[]` — el conteo de excluidos viaja siempre, no solo cuando es cero (D8).
- [x] 1.3 `packages/contracts/src/findings.ts`: `findingRecurrenceSchema` —`prior_count`,
      `prior_count_site_wide`, `window_months`, `first_prior_occurred_at` (nullable),
      `is_recurrent`— y `recurrence: findingRecurrenceSchema.nullable()` en `findingSchema`.
      El comentario deja escrito que `null` es "hallazgo manual, nunca comparado" y
      `is_recurrent: false` es "comparado, primera vez" (D8), y que `is_recurrent` lo calcula
      el motor y por eso no está en ningún request.
- [x] 1.4 `reporting.test.ts`: rechazo de `window_months` `0`, `61` y no numérico; rechazo de
      `group_by` `template_version`; los defaults cuando no viene ninguno de los dos. Exportar
      todo desde `packages/contracts/src/index.ts`.

## 2. El esquema: migración `0013_recurrence.sql`

- [x] 2.1 Escribir `apps/api/drizzle/0013_recurrence.sql` **a mano** (`drizzle-kit generate`
      sigue prohibido, ADR-004), abriendo con el comentario de cabecera en el formato de 0010:
      la tabla de propiedades con su barrera al lado, y el párrafo que declara que **esta
      migración sí altera una tabla inmutable existente** —un único sobre `finding`, sin
      columna, sin `GRANT` y sin reescritura de filas— y por qué (Context del diseño).
- [x] 2.2 `ALTER TABLE finding ADD CONSTRAINT finding_id_item_key_uq UNIQUE (id, item_key)`.
      Es el destino de la FK compuesta de 2.3 y lo que hace imposible una marca sobre un
      hallazgo sin `item_key`.
- [x] 2.3 `CREATE TABLE finding_recurrence`: `id`, `finding_id`, `site_id`, `item_key NOT
      NULL`, `location_id`, `window_months`, `prior_count`, `prior_count_site_wide`,
      `first_prior_occurred_at` (nullable), `computed_at DEFAULT now()`. `UNIQUE
      (finding_id)`; FK compuesta contra `finding (id, site_id)` y contra `finding (id,
      item_key)`; `CHECK` de no-negatividad de los dos conteos; `CHECK` de que
      `first_prior_occurred_at IS NULL` exactamente cuando `prior_count = 0`; `CHECK` de
      `window_months BETWEEN 1 AND 60`.
- [x] 2.4 `is_recurrent boolean GENERATED ALWAYS AS (prior_count > 0) STORED` (D5), con el
      comentario que remite al precedente de `finding_risk_assessment.risk_level`.
- [x] 2.5 `SELECT hs_make_immutable('finding_recurrence');` y `SELECT
      hs_apply_site_isolation('finding_recurrence');`
- [x] 2.6 `GRANT SELECT, INSERT ON finding_recurrence TO hs_app;` y **nada más** — ni un
      `GRANT UPDATE`, con el comentario que lo diga explícitamente como en 0010 y 0012.
- [x] 2.7 Espejo Drizzle `apps/api/src/db/schema/recurrence.ts` con la cabecera de siempre
      —la fuente de verdad es el `.sql`—, el tipo `FindingRecurrence` y `NewFindingRecurrence`
      **sin `isRecurrent`** (columna generada) y **sin ningún tipo `*Update`**. Exportar desde
      `schema/index.ts`.

## 3. El cálculo de la marca, dentro de la transacción de ingesta

- [x] 3.1 `apps/api/src/findings/recurrence.ts`: `insertRecurrenceMarks(client, inspectionId,
      windowMonths)`, un solo `INSERT ... SELECT` sobre los hallazgos recién insertados de esa
      inspección, con `count(*) FILTER (WHERE p.location_id = f.location_id)` y `count(*)` en
      un `LEFT JOIN LATERAL` contra `finding p` (D6, D7). Sin `WHERE site_id`: lo recorta la
      política.
- [x] 3.2 En la misma consulta: `p.inspection_id <> f.inspection_id` —los hallazgos del mismo
      envío no se cuentan entre sí (D7)—, `p.item_key = f.item_key`, `p.occurred_at <
      f.occurred_at` con desempate por `recorded_at`, y el filtro de ventana sobre
      `occurred_at` (D3).
- [x] 3.3 `WINDOW_MONTHS_DEFAULT` importado de `@hs/contracts`, no una constante local: la
      marca y el reporte usan el mismo default o el escenario de D2 se vuelve incomprensible.
- [x] 3.4 Enganchar en `apps/api/src/inspections/submissions.service.ts`, con el mismo cliente
      y dentro del mismo `withSessionClient`, inmediatamente después de la derivación de
      hallazgos. Un envío sin marcas no se comete.
- [x] 3.5 `FINDING_SELECT` de `findings.service.ts` gana un `LEFT JOIN` a
      `finding_recurrence`, y `toFinding` mapea `recurrence` a `null` cuando no hay fila (D8).
      `LEFT` y no `INNER`: un hallazgo manual y uno anterior a esta migración tienen que
      aparecer en el listado.

## 4. La consulta de recurrencia

- [x] 4.1 `apps/api/src/reporting/recurrence.sql.ts`: la consulta única con el `GROUP BY`
      conmutado por `CASE WHEN $mode = 'item_location' THEN f.location_id END` (D4). Agrupa
      por `item_key`, **nunca** por `template_version_item_id`. Filtro `f.item_key IS NOT
      NULL`, ventana sobre `occurred_at`, `HAVING count(*) >= 2`, orden por `occurrence_count
      DESC, last_occurred_at DESC`.
- [x] 4.2 En la misma consulta: `count(DISTINCT f.template_version_item_id)` como
      `template_version_item_count`, `count(DISTINCT f.location_id)` como `location_count`,
      `min`/`max` de `occurred_at`, y `array_agg(f.id ORDER BY f.occurred_at DESC)`.
- [x] 4.3 El prompt de la serie: `DISTINCT ON (item_key)` sobre `template_version_item` unido
      a `template_version`, ordenado por versión descendente (D9). En un join lateral, no en
      una segunda ida a la base.
- [x] 4.4 `excluded_manual_count`: los hallazgos de la ventana con `item_key IS NULL`, en la
      misma transacción y bajo la misma política (D8).
- [x] 4.5 `apps/api/src/reporting/reporting.service.ts` y `reporting.module.ts`. El servicio
      abre `withSessionClient` y no escribe un solo `WHERE site_id` (ADR-004). El módulo **no
      importa `FindingsModule`** (D10).
- [x] 4.6 `GET /findings/recurrence` en `reporting.controller.ts`, con
      `recurrenceQuerySchema` en el pipe de validación. Sin comprobación de rol: el alcance lo
      da la sesión y todos los roles con alcance leen.

## 5. La prueba de aceptación obligatoria del riesgo A

- [x] 5.1 `apps/api/test/recurrence.int-spec.ts`: construir las tres versiones sucesivas de
      una plantilla con el mismo `item_key` — v1 con su redacción original; v2 con `prompt`
      reescrito, `section_key` distinto y `position` movida; v3 con `response_type` de
      `yes_no` a **`yes_no_na`**.
      **Desvío declarado respecto de §5 riesgo A**, que pedía el cambio a `scale`: el change
      `findings-and-risk-classification` fijó que ningún ítem `scale` deriva hallazgo —sin
      umbral en el documento, cualquier corte sería inventado—, así que la prueba literal del
      riesgo A es imposible de construir: v3 no podría generar su cuarto hallazgo. `yes_no_na`
      es un cambio de tipo de respuesta igual de real que sí deriva, y la propiedad que el
      riesgo A quiere probar —que cambiar el tipo no parte la serie— queda probada igual.
- [x] 5.2 Generar los cuatro hallazgos **por el endpoint real de ingesta** —uno en v1, dos en
      v2, uno en v3, todos en la misma ubicación— y no por `INSERT` directo. El test tiene que
      recorrer el mismo camino que la aplicación o no prueba nada.
- [x] 5.3 **La aserción del riesgo A**: la consulta devuelve **una** serie con
      `occurrence_count` `4` y `template_version_item_count` `3`. Si devuelve tres series de
      1 + 2 + 1, el change no está hecho.
- [x] 5.4 Test hermano: ningún camino agrupa por `template_version_item_id` — dos hallazgos de
      la misma `item_key` con `template_version_item_id` distinto caen siempre en la misma
      serie, en los dos modos.

## 6. El resto de los tests

- [x] 6.1 Integración de la marca: cuarta ocurrencia con `prior_count` `3` y
      `first_prior_occurred_at` el del más viejo; primera ocurrencia con `prior_count` `0` e
      `is_recurrent` `false`; misma `item_key` en ubicación nueva con `prior_count` `0` y
      `prior_count_site_wide` `3`; hallazgo manual sin fila; dos hallazgos del mismo envío que
      no se cuentan entre sí.
- [x] 6.2 Integración de inmutabilidad: `UPDATE` de `prior_count` por `hs_app` rechazado por
      privilegio; `UPDATE` por el dueño rechazado por trigger; `DELETE` y `TRUNCATE`
      rechazados; `INSERT` que trae `is_recurrent` rechazado; segundo `INSERT` para el mismo
      `finding_id` con violación de único; `INSERT` de marca cuyo `site_id` no es el del
      hallazgo, rechazado por la FK compuesta.
- [x] 6.3 Integración de RLS: una transacción de St. Thomas no ve las marcas de Glencoe; un
      lector con alcance a los dos sitios recibe **dos** series de 3 y no una de 6 en modo
      `item`; el conteo de la marca no ve hallazgos de la otra planta.
- [x] 6.4 Integración de la ventana: hallazgos a 3, 8 y 20 meses dan `occurrence_count` `2` a
      12 meses y `3` a 24; un hallazgo con `occurred_at` dentro y `recorded_at` fuera **sí**
      cuenta (D3); una serie de un solo hallazgo no se devuelve.
- [x] 6.5 Integración de los dos modos: 3 en `pack-line-3` + 2 en `shipping-bay` dan dos
      series por defecto y una de `occurrence_count` `5` con `location_id` null y
      `location_count` `2` en modo `item`.
- [x] 6.6 Integración de los manuales: la serie cuenta 2 y `excluded_manual_count` es `1`; un
      sitio con solo hallazgos manuales devuelve cero series y el conteo de excluidos.
- [x] 6.7 El test de D2: tres hallazgos marcados con `window_months` `12` devuelven
      `occurrence_count` `3` en un reporte a 24 meses — la serie no se construye desde
      `prior_count`.

## 7. La vista

- [x] 7.1 `apps/web/src/api/recurrence.ts`: el cliente del endpoint con TanStack Query,
      tipado desde `@hs/contracts`. **Fuera del service worker y fuera de Dexie**: es solo
      lectura y solo online.
- [x] 7.2 `apps/web/src/routes/RecurrenceRoute.tsx`: la lista de series ordenada como la
      devuelve el servidor, cada una con prompt, ubicación, conteo, primera y última
      ocurrencia, y los hallazgos desplegables con su `risk_level` vigente o "unclassified".
      **Sin gráfico, sin línea de tendencia, sin número agregado por serie.**
- [x] 7.3 Los dos controles —ventana y agrupación— visibles en la vista, con los parámetros en
      uso a la vista del lector, y el `excluded_manual_count` como una línea de texto que
      distingue "nada se repitió" de "no hay con qué buscarlo" (D8).
- [x] 7.4 Registrar la ruta y su entrada de menú para coordinador, miembro del JHSC,
      supervisor, gerencia y auditor externo.
- [x] 7.5 `RecurrenceRoute.test.tsx`: se renderizan las series; una lista vacía con
      `excluded_manual_count` `> 0` muestra el texto que lo explica; cambiar ventana o
      agrupación vuelve a pedir con los parámetros nuevos.

## 8. Verificación del plan y cierre

- [x] 8.1 Sembrar volumen realista (5 años × 2 sitios × ~12 hallazgos/mes) y correr `EXPLAIN
      (ANALYZE, BUFFERS)` sobre la consulta en los dos modos y sobre el agregado de la marca.
- [x] 8.2 Con el plan a la vista, decidir si hace falta `finding (site_id, item_key,
      location_id, occurred_at)`. Si hace falta, agregarlo a `0013` con el plan pegado en el
      comentario como justificación; si no, escribir en la migración que no hizo falta y por
      qué. **No agregar el índice sin haber mirado el plan.**
- [x] 8.3 Actualizar la fila «Changes que la consumen» de `docs/adr/004-postgres-drizzle-rls.md`
      con `recurrence-detection`.
- [x] 8.4 `pnpm lint`, `pnpm typecheck` y las suites de `apps/api`, `apps/web`,
      `packages/contracts` en verde.
