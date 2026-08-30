## Why

El coordinador de H&S no puede cerrar una acción correctiva que él mismo declaró hecha: el
control de cuatro ojos de R3 —"una persona distinta del ejecutor la verifica y la cierra"— se
comprueba contra el autor del evento de completado, sin excepción por rol. En una operación de
dos sitios con un solo coordinador, ese caso no es marginal: el coordinador es la única cuenta
que puede declarar trabajo hecho en nombre de una persona del roster sin cuenta (ADR-017,
`assignee` sin usuario), así que cada vez que ejecuta o registra la ejecución, la acción queda
retenida en `awaiting_verification` esperando a un supervisor o gerente que no participó del
trabajo y no tiene nada que aportar a la verificación. El resultado es trabajo terminado que
figura como pendiente, que es lo contrario de lo que un registro defendible ante el MLITSD debe
mostrar.

No cierra una etapa nueva de §7: **enmienda la etapa 5 (R3 completo)**, igual que ADR-017
enmendó quién abre la acción dentro de la etapa ya construida y ADR-018 quién corrige el
compromiso. Existe porque la regla de R3 se escribió como universal y la operación real tiene un
rol —uno solo— para el que el segundo par de ojos no existe.

## What Changes

- **BREAKING** — el requisito de spec "The verifier is never the person who declared the work
  done" deja de ser universal: pasa a tener una excepción por rol. Un `hs_coordinator` puede
  cerrar (`awaiting_verification → closed`) y puede rechazar la verificación
  (`awaiting_verification → in_progress`) aunque sea la cuenta del evento de completado.
- El control **sigue entero para `supervisor` y `management`**. Ninguno de los dos puede
  verificar lo que declaró hecho, ni por el endpoint ni por un INSERT directo.
- El motor sigue siendo quien lo fuerza: el trigger `hs_action_verifier_guard` (SQLSTATE
  `HS005`) se reescribe para leer el rol de `app_user` del actor en vez de eliminarse. La
  excepción no se implementa en la aplicación.
- `not_executor` en la tabla `TRANSITIONS` de `packages/contracts` conserva el nombre y cambia
  de significado documentado: "el actor no puede ser quien declaró el trabajo hecho, salvo que
  sea el coordinador de H&S". El texto que la web muestra bajo *Next step* se corrige para no
  prometer una regla que ya no aplica a quien está leyendo.
- La decisión se registra como **ADR-019**, siguiendo la convención: R3 no se reescribe en
  `docs/Requisitos_V1.2.md`, se cita y se enmienda por ADR.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: el requisito "The verifier is never the person who declared the work done" cambia
  de alcance —vale para `supervisor` y `management`, no para `hs_coordinator`— tanto en el
  endpoint como en la guarda del motor.

## Impact

- `packages/contracts/src/actions.ts` — documentación de `not_executor`; la tabla
  `TRANSITIONS` no cambia de filas ni de roles.
- `apps/api/src/actions/actions.service.ts` — el chequeo previo de `not_executor` incorpora el
  rol de la sesión.
- `apps/api/drizzle/00XX_coordinator_verifier_exception.sql` — migración nueva que hace
  `CREATE OR REPLACE FUNCTION hs_action_verifier_guard()`. No toca tablas ni GRANTs: es una
  función del rol dueño sobre una tabla inmutable, permitida como DDL.
- `apps/web/src/routes/InspectionFindingsRoute/presentation.ts` — el texto de
  `REQUIREMENT_LABELS.not_executor`.
- `openspec/specs/actions/spec.md` — el requisito y sus escenarios.
- `docs/adr/019-*.md` y el índice de `docs/adr/README.md`.
- Tests de integración `apps/api/test/corrective-actions.int-spec.ts` (tres casos que hoy
  esperan `verifier_is_executor`) e `incidents.int-spec.ts` (uno).
