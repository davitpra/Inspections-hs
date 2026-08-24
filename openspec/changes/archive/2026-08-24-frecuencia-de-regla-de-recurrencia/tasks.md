## 1. Migración

- [x] 1.1 `apps/api/drizzle/0029_inspection_frequency.sql` §1: `ALTER TABLE
    inspection_schedule` agrega `frequency_months smallint NOT NULL DEFAULT 1` y
      `anchor_month smallint NOT NULL DEFAULT 1` (el backfill no puede estar mal: todo lo que
      existe es mensual, y para una mensual el ancla no se distingue). Después se retira el
      default del ancla, y quedan los CHECK `frequency_months IN (1,3,6,12)` y
      `anchor_month BETWEEN 1 AND 12`.
- [x] 1.2 §2: `scheduled_inspection` gana `period_months smallint NOT NULL` (con default 1
      para el backfill, retirado después) y su CHECK. Se TIRA `period_end` —una columna
      generada no se puede alterar— y se recrea en función de `period_months`. Se recrea
      `scheduled_inspection_pending_idx`, que el DROP COLUMN se lleva puesto.
- [x] 1.3 §3: `CREATE OR REPLACE FUNCTION hs_scheduling_guard()` con las tres columnas
      nuevas en el array `frozen`. Los tres triggers apuntan por nombre y no se recrean.
- [x] 1.4 §4: verificar que NO hace falta ningún GRANT — el `GRANT SELECT, INSERT` de 0008
      es a nivel de tabla, y la lista de `GRANT UPDATE` no se extiende a propósito.
- [x] 1.5 §5: `hs_inspection_schedule_audit()` incluye la frecuencia y el ancla en el
      payload de `inspection_schedule.created`.
- [x] 1.6 Registrar `0029_inspection_frequency` en `drizzle/meta/_journal.json`.
- [x] 1.7 Reflejar las tres columnas a mano en `apps/api/src/db/schema/inspections.ts`
      (`drizzle-kit generate` está prohibido, ADR-004).
- [x] 1.8 `seeds/005_inspection_schedules.sql` declara `frequency_months` y `anchor_month`
      explícitos.

## 2. Contratos

- [x] 2.1 `periodMonthsSchema`, `PERIOD_MONTHS` y `PERIOD_MONTHS_LABELS` en
      `compliance.ts` —no en `inspections.ts`— por la misma razón que `periodStatusSchema`:
      viaja dentro del payload que lleva digest y la dirección del import es la única acíclica.
- [x] 2.2 `inspectionScheduleSchema` gana `frequency_months` y `anchor_month`;
      `createInspectionScheduleSchema` los acepta opcionales; `updateInspectionScheduleSchema`
      NO los acepta, y su comentario dice por qué.
- [x] 2.3 `scheduledInspectionSchema`, `pendingInspectionSchema` y
      `submittedInspectionSchema` ganan `period_months`.
- [x] 2.4 `compliancePeriodSchema` gana `period_months` OPCIONAL, y
      `COMPLIANCE_PAYLOAD_SCHEMA_VERSION` sube a 2 aceptando las dos versiones (design D8).
- [x] 2.5 El payload de `inspection_period_opened` baja el período a cada entrada y deja
      `opened_for_month` arriba (design D9).
- [x] 2.6 `periodLabel()` en `compliance.ts`, con sus tests (design D7).

## 3. API

- [x] 3.1 `inspections/period.ts`: `containingPeriodStart()` y `startsPeriod()`, puras, con
      el test de tabla que incluye el cruce de año hacia atrás.
- [x] 3.2 `open-period.service.ts`: el `INSERT` calcula el período contenedor por regla
      (design D5). El resultado del trabajo pasa a hablar de un mes y no de un período.
- [x] 3.3 `notifyCoordinators`: la clave de dedupe sigue siendo el mes; el payload cambia
      de forma.
- [x] 3.4 `inspections.service.ts`: `createSchedule` persiste frecuencia y resuelve el ancla
      con el mes civil de Ontario; `schedule()` hereda el largo de la regla activa
      (`activeRuleFrequency`); los SELECT y los mapeadores proyectan las columnas nuevas.
- [x] 3.5 `reporting/compliance.sql.ts`: `months` genera meses, `owed_periods` filtra por el
      ancla y lleva el largo, y `owed` deriva `period_end` una sola vez.
- [x] 3.6 `reporting/compliance.service.ts` mapea `period_months`.
- [x] 3.7 `report-document.ts` escribe el nombre del período Y sus dos extremos.
- [x] 3.8 Helpers y fixtures de `apps/api/test` al día con las columnas nuevas.

## 4. Web

- [x] 4.1 `presentation/dates.ts` reexporta `periodLabel` de contracts, con la nota de por
      qué esta no se duplica y `civilDate` sí.
- [x] 4.2 `SchedulingRoute/presentation.ts`: `startsPeriod`, `ruleOwesPeriod` (que reemplaza
      a `ruleOwesMonth`), `frequencyNote`, y `UnopenedPeriod` con su largo. `projectYear`
      filtra por el ancla.
- [x] 4.3 `NewRuleForm`: selector de frecuencia, y de mes ancla solo cuando no es mensual.
      Dice que no se puede cambiar después.
- [x] 4.4 `RuleRow` muestra la frecuencia y empuja a desactivar-y-recrear.
- [x] 4.5 Todas las pantallas que titulaban por mes pasan a `periodLabel`: filas del
      calendario, los dos diálogos, la home del inspector, el registro de la inspección, la
      tabla de completadas y la grilla de cumplimiento. `monthLabel` de ComplianceRoute se
      retira: `periodLabel` lo supera.
- [x] 4.6 `InspectorHomeRoute/presentation.ts`: «lo de este mes» se mide contra los DOS
      extremos del período, no contra `period_start`.
- [x] 4.7 `api/inspections.ts`: `createSchedule` se tipa con el contrato.
- [x] 4.8 Fixtures de los tests del cliente al día.

## 5. Verificación

- [x] 5.1 `pnpm -r build` y después `pnpm typecheck`. Verde.
- [x] 5.2 `pnpm test` (1.498 unitarios) y `pnpm lint`. Verde.
- [x] 5.3 `pnpm --filter api test:int` — 796 en 26 archivos, verde, incluida la migración.
      Casos nuevos escritos: el UPDATE de la frecuencia rechazado con 42501 y con HS001, el
      `period_months` de una fila abierta rechazado con HS001, el trimestre abierto a mitad
      de trimestre, la idempotencia sobre los tres meses, los CHECK de `frequency_months = 5`
      y `anchor_month = 13`, y el reporte trimestral que dice «4 de 4» con el Q4 omitido
      contado sin identificadores.
- [x] 5.4 A mano con `pnpm dev`: regla trimestral anclada en febrero, correr el trabajo con
      `now` en el payload, y verificar cuatro casillas en el calendario del año.
