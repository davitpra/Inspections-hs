# ADR-024 — Quien reportó el hallazgo también ejecuta la acción

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                         |
| **Fecha**                   | 2026-09-13                                                       |
| **Supersede**               | —                                                                |
| **Superada por**            | —                                                                |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R3; ADR-017, ADR-019, ADR-021       |
| **Changes que la consumen** | `finding-reporter-executes-action`                              |

## Contexto

ADR-017 permite que la cuenta que reportó un hallazgo abra su acción correctiva y ADR-021 le
permite corregir la asignación mientras el trabajo no fue declarado hecho. Sin embargo, las dos
transiciones que registran la ejecución seguían limitadas a la cuenta del responsable o al
coordinador. Eso obliga a quien vio y reportó el hallazgo a reasignarse para poder iniciar el
trabajo, y cambia falsamente la persona responsable que queda en el registro.

La persona responsable es una `Persona` del roster y puede no tener cuenta. La cuenta que reportó
el hallazgo sí está identificada en `finding.reported_by`, por lo que puede registrar el avance sin
convertirse en responsable de la acción.

## Decisión

La tabla de transiciones agrega el actor relativo `finding_reporter`, resuelto contra la cuenta de
`finding.reported_by`. Ese actor puede mover `open → in_progress` e `in_progress →
awaiting_verification`, tanto para un miembro del JHSC como para una cuenta de management que haya
reportado el hallazgo. No puede crear por esta tabla, verificar ni rechazar una verificación. La
creación continúa regida por ADR-017 y la verificación por ADR-019.

Una acción de investigación no tiene un `reported_by` de hallazgo y nunca satisface
`finding_reporter`. El evento conserva como `actor_user_id` la cuenta que actuó y
`assignee_person_id` permanece intacto. Si esa cuenta declara el trabajo hecho, la regla de
verificador distinto de ADR-019 sigue rechazando su propio cierre cuando corresponda.

La tabla de contratos y `ActionsService.requireActor` son las dos mitades de la regla del servidor;
`canAttempt` usa la misma fila para ofrecer el paso en la ficha. No hay migración: la guarda de
0011 compara únicamente pares de estados y no actores.

## Consecuencias

- Un reportante puede iniciar y declarar hecho el trabajo asignado a otra persona sin reasignarse.
- El registro diferencia a quien actuó de la persona nombrada como responsable.
- Un miembro del JHSC que no reportó el hallazgo no obtiene un permiso general para ejecutar
  acciones.
- La creación, la verificación, el rechazo, los plazos y el escalamiento no cambian.
