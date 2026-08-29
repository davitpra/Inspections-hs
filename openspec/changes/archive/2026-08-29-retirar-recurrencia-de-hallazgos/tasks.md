## 1. Decisión y alcance vigente

- [x] 1.1 Crear ADR-015 con la retirada preproducción de la recurrencia: la precondición, la eliminación destructiva de `finding_recurrence` y de los objetos que solo la sostenían, la conservación intacta de `audit_log` y la supervivencia entera de la identidad dual; añadir la fila al índice de `docs/adr/README.md` sin reescribir ADRs aceptados.
- [x] 1.2 Modificar `docs/Requisitos_V1.2.md`: retirar la recurrencia de §4 (entidades, `item_key` y hallazgo manual), reformular §5 riesgo A como identidad del ítem con su prueba de aceptación reenunciada, marcar la pregunta cerrada 11 de §6-bis como sin efecto y corregir la etapa 7 de §7. No tocar Scheduling ni las reglas de recurrencia de la programación.
- [x] 1.3 Actualizar `README.md` y `openspec/config.yaml` —retirar `reporting` de las capabilities válidas y añadir la detección de hallazgos recurrentes al bloque «Fuera de alcance en v1»—, y revisar los changes activos que la mencionen, preservando intactos los archivados.

## 2. Contratos

- [x] 2.1 Eliminar `packages/contracts/src/reporting.ts`, `reporting.test.ts` y su export del barrel; `WINDOW_MONTHS_DEFAULT` desaparece con ellos, después de comprobar que su único consumidor externo era la marca que también se retira.
- [x] 2.2 Eliminar de `packages/contracts/src/findings.ts` el `findingRecurrenceSchema`, su tipo y el campo `recurrence` del hallazgo, y ajustar `findings.test.ts` para que el objeto estricto ahora RECHACE una marca.
- [x] 2.3 Quitar `recurrence` de los fixtures de `submissions.test.ts` y reformular en `actions.ts`, `catalog.ts`, `catalog.test.ts`, `submissions.ts`, `templates.ts` y `packages/forms/src/document/{draft,draft.test,schema}.ts` los comentarios que explican `item_key` como clave de agrupación de un reporte.

## 3. Retirada de la aplicación web

- [x] 3.1 Eliminar `apps/web/src/routes/RecurrenceRoute/` completo y `apps/web/src/api/recurrence.ts`.
- [x] 3.2 Retirar `/recurrence` del router —import, ruta y `routeTree`—, de `NavPath`, `NAV_ITEMS` y `TITLES`, y eliminar su query key junto con el import de `RecurrenceGrouping` que queda huérfano.
- [x] 3.3 Reescribir los docblocks del router que citaban la recurrencia como precedente de «ONLINE, fuera del precacheo», incluido el bloque muerto del cumplimiento que ADR-013 dejó atrás. No hay estilos exclusivos que eliminar: la ruta solo usaba clases compartidas.
- [x] 3.4 Quitar `recurrence: null` de los seis fixtures de hallazgo y actualizar los textos que nombraban la pantalla en `OfflineRoute` y el comentario de `IncidentRoute`.

## 4. Retirada de API e ingesta

- [x] 4.1 Eliminar `apps/api/src/reporting/` completo —controller, service, SQL de series y de excluidos, módulo y su spec— y retirar `ReportingModule` de `app.module.ts` junto con el comentario de orden de registro que existía para que `findings/:id` no se comiera `findings/recurrence`.
- [x] 4.2 Eliminar `apps/api/src/findings/recurrence.ts` y su llamada en `submissions.service.ts`, verificando que la transacción de ingesta conserva la validación, la inserción del envío, la derivación y la resolución de ubicaciones, y solo pierde el paso de las marcas.
- [x] 4.3 Quitar de `findings.service.ts` las cinco columnas `rec.*` del `FINDING_SELECT`, su `LEFT JOIN`, los campos de `FindingRow` y el mapeo `recurrence` de `toFinding`.
- [x] 4.4 Eliminar `apps/api/src/db/schema/recurrence.ts` y su export, retirar del espejo de `finding` el índice `finding_recurrence_idx`, y reformular en los espejos de `templates` e `inspections` los comentarios que justificaban `item_key` por la recurrencia, conservando el nombre del índice `inspection_answer_recurrence_idx` que puso 0009.
- [x] 4.5 Retirar de `demo-content.mjs` la generación y la descripción de recurrencia, conservando el resto del escenario de demo y el peligro que se repite en los tres envíos.
- [x] 4.6 Eliminar `apps/api/test/recurrence.int-spec.ts` y ajustar `findings.int-spec.ts`, `audit-chain.int-spec.ts`, `item-identity.int-spec.ts`, `template-revisions.int-spec.ts` y `test/fixtures/finding_stub.sql` para que su cobertura de identidad de ítem se enuncie como agrupación por concepto escrita por el propio test.

## 5. Migración destructiva

- [x] 5.1 Añadir `apps/api/drizzle/0038_retire_finding_recurrence.sql` y su entrada de journal, con la precondición preproducción en la cabecera: eliminar `finding_recurrence` con sus GRANT, políticas, triggers y CHECK; eliminar el índice parcial `finding_recurrence_idx` de 0010 y la constraint `finding_id_item_key_uq` de 0013, que solo era destino de la FK compuesta de la marca. Sin ninguna escritura sobre `audit_log`.
- [x] 5.2 Comprobar en una base migrada desde cero que la tabla, el índice y la constraint no existen, que `finding.item_key`, `finding_id_site_uq`, `finding_inspection_idx` y `finding_site_recorded_idx` siguen en pie, que el resto de RLS permanece y que una cadena con eventos históricos —incluidas lecturas registradas contra `finding_recurrence`— sigue verificando.

## 6. Regresiones y validación

- [x] 6.1 Comprobar que `GET /findings/recurrence` ya no está registrada y que `GET /findings/:id` sigue resolviendo sin depender del orden de módulos, y que `/recurrence` en la web cae en `notFoundComponent`.
- [x] 6.2 Ejecutar los tests focalizados de contracts, web, findings, item identity y cadena de auditoría; corregir únicamente regresiones causadas por este change.
- [x] 6.3 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint`, `pnpm test` y `pnpm --filter api test:int`.
- [x] 6.4 Buscar referencias residuales a recurrencia, `finding_recurrence` y `RecurrenceReport`, y clasificar como válidas únicamente las del historial de migraciones, ADRs anteriores, changes archivados, payloads históricos de auditoría y las reglas de recurrencia de la programación.
- [x] 6.5 Ejecutar `openspec validate retirar-recurrencia-de-hallazgos --strict`.

## 7. Sincronización

- [x] 7.1 Al sincronizar los deltas, eliminar `openspec/specs/reporting/` completo: la capability queda sin ningún requisito.
- [x] 7.2 Corregir el `## Purpose` de `openspec/specs/inspections/spec.md`, que todavía justifica `item_key` por el reporte de recurrencia. Los deltas cubren requisitos, no propósitos, y la retirada anterior dejó ese hueco sin cerrar en `reporting`.
