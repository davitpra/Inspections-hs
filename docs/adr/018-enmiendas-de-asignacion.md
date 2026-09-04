# ADR-018 — La asignación se enmienda antes de iniciar el trabajo

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Superada                                                         |
| **Fecha**                   | 2026-08-30                                                       |
| **Supersede**               | —                                                                |
| **Superada por**            | ADR-020                                                          |
| **Referencias**             | `docs/requisitos-v1.2.md` §3 R2, §4, §7; ADR-002, ADR-004, ADR-008, ADR-014, ADR-017 |
| **Changes que la consumen** | `allow-assignment-amendments`                                    |

## Contexto

La acción guarda responsable, trabajo y plazo en su fila inmutable. Una equivocación detectada
antes de empezar no se puede corregir: hay que conservar una acción errónea o abrir otra. Además,
la creación atraviesa `open` e `in_progress` en una transacción, por lo que `assigned` existe en el
registro pero no como una etapa operativa.

Corregir la fila original perdería el compromiso anterior y rompería ADR-002. Mantener el arranque
automático tampoco deja una frontera verificable entre corregir una asignación y alterar trabajo ya
iniciado.

## Decisión

Una acción nueva conserva únicamente su evento inicial `open`. La transición explícita
`open → in_progress` declara el inicio del trabajo y cierra la ventana de corrección.

Mientras el estado derivado sea `open`, quien podía abrir la acción puede agregar una enmienda con
una instantánea completa de responsable, trabajo y plazo. Cada enmienda se inserta en una tabla
append-only con posición, actor e instante; la fila original y las enmiendas anteriores nunca se
actualizan ni se eliminan. Las lecturas operativas usan la última instantánea y el registro histórico
presenta todas en orden.

Las enmiendas se aíslan por sitio y se protegen con los dos mecanismos de ADR-002. La autorización
sigue ADR-017: coordinador para cualquier acción, más `finding.reported_by` cuando el padre es un
hallazgo. La transición y la enmienda se serializan sobre la acción para que iniciar y corregir no
puedan confirmar sobre el mismo estado `open`.

## Consecuencias

- `assigned` pasa a ser una etapa vigente hasta que alguien autorizado pulse `Start work`.
- El plazo original de ADR-014 continúa inmutable; un plazo vigente distinto es otro hecho
  inmutable, no una reescritura.
- El responsable efectivo gobierna las transiciones y el plazo efectivo gobierna escalamientos
  todavía no emitidos.
- Reasignar notifica al nuevo responsable sin retirar notificaciones ni escalamientos históricos.
- No se puede enmendar una acción en `in_progress`, `awaiting_verification` o `closed`.
