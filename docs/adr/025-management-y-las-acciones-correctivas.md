# ADR-025 — Management y las acciones correctivas

|                             |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                        |
| **Fecha**                   | 2026-09-14                                                      |
| **Supera**                  | ADR-017 (parcial), ADR-019 (parcial)                            |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R2, R3; ADR-002, ADR-017, ADR-019, ADR-021, ADR-022 |
| **Changes que la consumen** | `management-opens-corrective-actions`                           |

## Contexto

ADR-022 estableció que `coordinator` y `management` son las dos autoridades administrativas.
Las acciones correctivas todavía reservaban a `coordinator` la creación sobre cualquier hallazgo,
la corrección de una asignación, la ejecución en nombre de una persona sin cuenta y la creación
sobre una investigación. La guarda del verificador también exceptuaba solo a `coordinator`.

Esa división obligaba a una cuenta administrativa a esperar a la otra para abrir o corregir un
compromiso y dejaba retenido el trabajo que `management` había declarado hecho. La relación del
reportante con su propio hallazgo se conserva: ADR-017 no se retira, se amplía parcialmente.

## Decisión

`management` comparte con `coordinator` las facultades administrativas de las acciones correctivas:

- Puede crear una acción sobre cualquier hallazgo dentro de su alcance, aunque no lo haya reportado.
- Puede crear una acción cuyo padre sea una investigación.
- Puede reemplazar `assignee_person_id`, `description` y `due_at` mientras la acción esté en
  `open` o `in_progress`, sin crear historial de asignación.
- Puede registrar `open → in_progress` e `in_progress → awaiting_verification` en nombre del
  responsable, sin cambiar la persona asignada.
- Puede cerrar o rechazar una verificación que él mismo declaró, igual que `coordinator`.

La creación por el reportante del hallazgo y su capacidad de ejecutar en nombre de la persona
responsable permanecen vigentes. `inspector` solo puede abrir o corregir el hallazgo que reportó y
solo puede ejecutar cuando la tabla de transiciones o la relación de reportante lo permite.
La frontera de ADR-021 no cambia: declarar el trabajo hecho congela la asignación hasta que una
verificación rechazada lo devuelva a `in_progress`.

La tabla `TRANSITIONS` nombra explícitamente a `coordinator` y `management` en las filas de
creación y ejecución. `isAdministrator` se usa en las comprobaciones de creación, corrección y
verificación del servicio y de la interfaz, pero no sustituye a la tabla como fuente completa de
las transiciones.

## Control del motor

La excepción al control de cuatro ojos se conserva en `hs_action_verifier_guard` (`HS005`) y se
actualiza mediante la migración `0050_administrator_verifier_exception.sql`. El trigger lee el
rol vigente de `app_user` al insertar el evento y acepta solo `coordinator` o `management` cuando
la misma cuenta declaró el trabajo. No confía en un rol enviado con el evento y no se implementa
solo en NestJS.

R3 queda sin un rol verificador sujeto a `not_executor`: ambos roles que pueden verificar son
administrativos y están exentos. El trigger se conserva porque sigue siendo la barrera del motor
para un `inspector` y para cualquier rol verificador no administrativo que pueda existir en el
futuro. Una cuenta degradada a `inspector` pierde la excepción inmediatamente porque la guarda
lee el rol vigente.

## Consecuencias

- `created_by` y los eventos pueden nombrar a `management` además de `coordinator`.
- El control de cuatro ojos no se elimina: quedan registrados el ejecutor y el verificador en
  eventos append-only, y el motor sigue rechazando el auto-cierre de un `inspector`.
- Los escalamientos de +3 días a `coordinator` y +7 días a `management` no cambian.
- ADR-021 y ADR-022 siguen vigentes: la frontera de edición y la promoción/degradación no se
  modifican.
- Los contratos HTTP, las tablas, las columnas, los GRANTs, los REVOKEs y las políticas RLS no
  cambian.
