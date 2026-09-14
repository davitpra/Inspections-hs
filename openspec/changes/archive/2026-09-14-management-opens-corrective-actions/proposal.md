## Why

ADR-022 le dio a `management` las facultades administrativas de `coordinator`, pero las acciones
correctivas quedaron fuera: un `management` que no reportó el hallazgo no puede abrir la acción,
no puede corregir su asignación, no puede registrar el trabajo en nombre de una persona sin cuenta
ni abrir una acción sobre una investigación, y no puede cerrar lo que él mismo declaró hecho. En
la operación real las dos cuentas administrativas se reparten ese trabajo, y hoy `management`
tiene que esperar al coordinador para una decisión que el resto de la plataforma ya le reconoce.

No cierra una etapa nueva de §7: **enmienda la etapa 5 (R2 y R3)**, igual que ADR-017, ADR-019,
ADR-021 y ADR-024 enmendaron quién abre, verifica, corrige y ejecuta dentro de la etapa ya
construida.

## What Changes

- **BREAKING** — `management` abre una acción correctiva sobre cualquier hallazgo de su alcance,
  no solo sobre los que reportó. El escenario "A manager who did not raise the finding cannot
  create an action" se invierte.
- `management` abre una acción correctiva sobre una investigación, que hasta ahora era solo del
  coordinador.
- `management` corrige la asignación (`assignee_person_id`, `description`, `due_at`) de cualquier
  acción de un hallazgo mientras sea `open` o `in_progress`; la frontera de ADR-021 no cambia.
- `management` registra `open → in_progress` e `in_progress → awaiting_verification` en nombre del
  responsable, como ya lo hace el coordinador. Sin esto la excepción del verificador no tendría
  a qué aplicarse: la cuenta administrativa que declara el trabajo hecho es la que después lo
  cierra.
- **BREAKING** — la excepción de ADR-019 al control de cuatro ojos se extiende a `management`: una
  cuenta `coordinator` o `management` cierra o rechaza la verificación aunque sea quien declaró el
  trabajo hecho. La regla sigue entera para `inspector`. La fuerza el motor: la guarda
  `hs_action_verifier_guard` (`HS005`) se reescribe en una migración nueva y sigue leyendo el rol
  de `app_user`, nunca del evento.
- Las comprobaciones fijas a `'coordinator'` pasan a la regla común `isAdministrator` de
  contracts, y la tabla `TRANSITIONS` agrega `management` a las filas de creación y ejecución.
- La decisión se registra como **ADR-025**, que supera en parte a ADR-017 (creación y corrección
  solo del coordinador) y a ADR-019 (excepción solo del coordinador).

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: "Who may create, execute and verify an action" acepta a `management` en la creación
  sobre hallazgo e investigación y en la ejecución en nombre del responsable; "A corrective action
  assignment is replaceable until declared work" acepta a `management`; "The verifier is someone
  other than the executor, unless they are the coordinator" pasa a exceptuar a las dos cuentas
  administrativas.
- `findings`: los tres requisitos que ofrecen en la ficha la creación y la corrección de la
  asignación ("Coordinators open a corrective action…", "A recorded finding presents its persisted
  five-state lifecycle…", "An active finding exposes its current assignment for correction") pasan
  a ofrecerlas también a `management`; "A corrective action is advanced from the finding…" deja de
  describir su rechazo con un verificador que declaró el trabajo hecho, que ningún rol verificador
  puede ya ser.
- `incidents`: "The corrective actions of an investigation use the same engine as those of a
  finding" acepta la creación de `management` y describe la regla del verificador con la excepción
  de las dos cuentas administrativas.

## Impact

- `packages/contracts/src/actions.ts` — `TRANSITIONS` (filas `null → open`, `open → in_progress`,
  `in_progress → awaiting_verification`) y la documentación de `not_executor`.
- `apps/api/src/actions/actions.service.ts` — `create`, `replaceAssignment`, el adelanto de
  `not_executor` en `transition` y `createForInvestigation`.
- `apps/api/drizzle/0050_administrator_verifier_exception.sql` — `CREATE OR REPLACE FUNCTION
  hs_action_verifier_guard()`. No toca tablas, columnas, GRANTs ni RLS.
- `apps/web/src/permissions/actions.ts` — `canCreateAction` (y `canEditAssignment`, que delega).
- Tests: `packages/contracts/src/actions.test.ts`, `apps/api/test/corrective-actions.int-spec.ts`,
  `apps/api/test/incidents.int-spec.ts`, `apps/web/src/permissions/actions.test.ts`,
  `apps/web/src/routes/InspectionFindingsRoute/presentation.test.ts` e `index.test.tsx`.
- `docs/adr/025-management-y-las-acciones-correctivas.md`, cabeceras de ADR-017 y ADR-019, índice
  de `docs/adr/README.md`, y §3 R2/R3 de `docs/Requisitos_V1.2.md`.
- Sin cambios de contrato HTTP, de esquema de datos ni de pantalla nueva.
