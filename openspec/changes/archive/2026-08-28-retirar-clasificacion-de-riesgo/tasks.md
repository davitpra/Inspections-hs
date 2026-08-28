## 1. Decisión y alcance vigente

- [x] 1.1 Crear ADR-014 para registrar la retirada preproducción de la clasificación de riesgo, la eliminación destructiva de `finding_risk_assessment` y de `corrective_action.severity`, la conservación de `audit_log` y la sustitución del plazo derivado por una fecha declarada; actualizar solamente el índice `docs/adr/README.md`, sin reescribir ADRs aceptados.
- [x] 1.2 Modificar `docs/Requisitos_V1.2.md`: R2 pierde la matriz y la fecha derivada de la severidad, la entidad Hallazgo pierde clasificación de riesgo y jerarquía de controles, y la etapa 4 de la tabla §7 se corrige al estilo de la etapa 7.
- [x] 1.3 Actualizar el `## Purpose` de `openspec/specs/actions/spec.md` —edición directa del spec principal, que el delta no cubre— para que no prometa un hallazgo clasificado ni un plazo derivado de la severidad.
- [x] 1.4 Revisar `README.md`, `CLAUDE.md` y los artefactos de los changes activos por menciones a la clasificación de riesgo; los changes archivados quedan intactos.

## 2. Contratos compartidos

- [x] 2.1 En `packages/contracts/src/findings.ts`, eliminar `PROBABILITIES`, `SEVERITIES`, `RISK_LEVELS`, sus esquemas y tipos, `riskAssessmentRequestSchema`, `riskAssessmentSchema`, el campo `assessment` de `findingSchema` y el `classification` de `manualFindingRequestSchema`, junto con el re-export de `CONTROL_LEVELS`/`controlLevelSchema`/`ControlLevel`.
- [x] 2.2 Eliminar `packages/forms/src/document/controls.ts` y su export del barrel, tras comprobar que la migración 0024 ya lo dejó sin ningún otro consumidor.
- [x] 2.3 En `packages/contracts/src/actions.ts`, eliminar `DUE_DAYS_BY_SEVERITY` y `dueAt()`, añadir `due_at` a `createActionRequestSchema`, eliminar `createInvestigationActionRequestSchema` y quitar `severity` de `actionSchema` y `actionSummarySchema`.
- [x] 2.4 Quitar `severity` de `correctiveActionAssignedPayloadSchema` en `packages/contracts/src/notifications.ts` y su import.
- [x] 2.5 Ajustar `findings.test.ts`, `actions.test.ts` y `notifications.test.ts`: retirar la cobertura de escalas y plazos por severidad, y añadir la del `due_at` obligatorio en el cuerpo de creación.

## 3. API — findings

- [x] 3.1 Eliminar `apps/api/src/findings/risk.ts` y `risk.spec.ts`.
- [x] 3.2 En `findings.service.ts`, eliminar `classify()`, `insertAssessment()`, `currentAssessmentId()`, el `LEFT JOIN LATERAL` de la clasificación en `FINDING_SELECT` y el mapeo de `assessment` en `toFinding()`; `report()` deja de clasificar el hallazgo manual.
- [x] 3.3 Eliminar `POST /findings/:id/risk-assessments` de `findings.controller.ts` y actualizar el comentario de cabecera que enumera lo que el módulo expone.
- [x] 3.4 Eliminar `already_reclassified` y `alreadyReclassified()` de `findings.errors.ts`, conservando `findingForbidden()`, que sigue usando el hallazgo manual.
- [x] 3.5 Eliminar el espejo Drizzle `findingRiskAssessment` y sus tipos de `apps/api/src/db/schema/findings.ts`.

## 4. API — actions

- [x] 4.1 En `actions.service.ts`, eliminar `requireClassifiedFinding()` y unificar `create()` y `createForInvestigation()` en un solo camino de datos que comprueba la existencia del padre en el alcance y usa el `due_at` del cuerpo.
- [x] 4.2 Añadir la comprobación de fecha futura contra `new Date()` en `ActionsService` con el código `invalid_due_at` en `actions.errors.ts`, eliminar `finding_not_classified` y `findingNotClassified()`, y documentar en el comentario del servicio que esta garantía NO la duplica el motor.
- [x] 4.3 Quitar `severity` de `InsertActionInput`, del INSERT y de los selects y mapeos de lectura en `actions.repository.ts`; `notifyAssignee()` deja de proyectar `a.severity`.
- [x] 4.4 Actualizar `actions.controller.ts` para que ambos endpoints de creación validen con `createActionRequestSchema`, y corregir el comentario que dice que el de investigación acepta `severity`.
- [x] 4.5 Quitar la columna `severity` del espejo Drizzle `apps/api/src/db/schema/actions.ts`.

## 5. Migración destructiva

- [x] 5.1 Añadir `apps/api/drizzle/0037_retire_risk_classification.sql` y su entrada en `meta/_journal.json` (`idx: 36`), con la precondición preproducción escrita en la cabecera y en este orden: `CREATE OR REPLACE FUNCTION hs_action_audit()` sin `severity`; `ALTER TABLE corrective_action DROP COLUMN severity`; `DROP TABLE finding_risk_assessment` —que arrastra sus GRANT, políticas RLS, índices, CHECKs y triggers—; `DROP FUNCTION hs_finding_assessment_guard()`, `hs_finding_assessment_audit()` y `hs_risk_level(text, text)`. Sin ninguna escritura sobre `audit_log`.
- [x] 5.2 Comprobar sobre una base migrada desde cero que las tres funciones y la tabla no existen, que `corrective_action` no tiene `severity`, que sus REVOKE y su política RLS siguen en pie y que una cadena de `audit_log` con eslabones históricos sigue verificando.

## 6. Aplicación web

- [x] 6.1 Quitar la severidad de la línea de vencimiento en `apps/web/src/routes/ActionRoute/index.tsx`.
- [x] 6.2 Añadir `due_at` al cuerpo de `createAction` en `apps/web/src/api/actions.ts` y sustituir `severity` por `due_at` en `createInvestigationAction` de `apps/web/src/api/incidents.ts`.
- [x] 6.3 Quitar `severity` de `apps/web/src/test/fixtures.ts` y de los tests de `ActionsRoute`, `ActionsForInspectionRoute`, `InboxRoute` y `permissions/actions.test.ts`.

## 7. Script de demo

- [x] 7.1 En `apps/api/scripts/demo-content.mjs`, eliminar los dos `POST /findings/:id/risk-assessments`, el `classification` del hallazgo manual y las severidades del guion; el INSERT SQL directo de `corrective_action` pierde `severity` y gana un `due_at` explícito.

## 8. Pruebas y validación

- [x] 8.1 En `apps/api/test/findings.int-spec.ts`, eliminar el bloque de la clasificación, el nacimiento clasificado del hallazgo manual, el test de UPDATE rechazado sobre `finding_risk_assessment` y el eslabón de auditoría `finding.classified`; añadir que `POST /findings/:id/risk-assessments` ya no está registrada.
- [x] 8.2 En `apps/api/test/corrective-actions.int-spec.ts`, crear las acciones con `due_at` explícito, sustituir la cobertura del plazo derivado por «la fecha es la que declaró el coordinador y queda congelada», añadir el rechazo de una fecha pasada con `invalid_due_at` y comprobar que una acción se abre sobre un hallazgo sin clasificar.
- [x] 8.3 Revisar `apps/api/test/incidents.int-spec.ts` por la creación de acciones de investigación con `severity` y pasarlas a `due_at`.
- [x] 8.4 Ejecutar `pnpm -r build` antes de `pnpm typecheck`, y después `pnpm lint`, `pnpm test` y `pnpm --filter api test:int`; corregir únicamente las regresiones causadas por este change.
- [x] 8.5 Buscar referencias residuales a `risk_level`, `probability`, `control_level` y `severity`, y clasificar como válidas únicamente las del historial de migraciones, ADRs supersedidos, changes archivados y payloads históricos de auditoría.
- [x] 8.6 Ejecutar `openspec validate retirar-clasificacion-de-riesgo --strict` y dejar el change listo para sincronizar y archivar.
