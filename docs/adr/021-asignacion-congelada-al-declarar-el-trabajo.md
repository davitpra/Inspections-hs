# ADR-021 — La asignación se congela al declarar el trabajo hecho

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                         |
| **Fecha**                   | 2026-09-05                                                       |
| **Supersede**               | ADR-020                                                          |
| **Superada por**            | —                                                                |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R2, R3, §4, §7; ADR-002, ADR-004, ADR-016, ADR-017, ADR-019 |
| **Changes que la consumen** | `freeze-assignment-at-declared-work`                             |

## Contexto

ADR-020 puso la frontera de la corrección en el cierre. Eso deja la asignación editable durante
`awaiting_verification`, y ahí la edición ya no corrige un compromiso: reescribe el objeto de una
verificación en curso.

Dos consecuencias concretas de esa ventana. Cambiar el responsable de un trabajo **ya declarado
hecho** retira la notificación de quien lo ejecutó y notifica a alguien que no lo hizo; el evento de
cierre —que es el snapshot definitivo— termina nombrando a esa persona. Y cambiar la descripción
reescribe el enunciado contra el que quien verifica está comparando la evidencia mientras la mira.

La etapa de verificación ya tiene un mecanismo para decir que el trabajo no está bien: el rechazo,
`awaiting_verification → in_progress` (ADR-019 decide quién puede pedirlo). Ese camino deja un evento
con su razón. La edición en verificación era un segundo camino para lo mismo, sin registro.

## Decisión

`corrective_action.assignee_person_id`, `description` y `due_at` se reemplazan juntos mientras el
estado derivado sea `open` o `in_progress`. Declarar el trabajo hecho congela la fila: desde
`awaiting_verification` el motor rechaza cualquier cambio, igual que ya lo hacía desde `closed`.

Corregir un compromiso durante la verificación exige rechazarla primero. La acción vuelve a
`in_progress` con la razón registrada y la asignación vuelve a ser editable. La corrección deja de
poder ocurrir sin que el stream lo diga.

La lista de estados editables es un dato compartido —`ASSIGNMENT_EDITABLE_STATES` en
`packages/contracts`— que consultan la interfaz y el endpoint, y que la migración vuelve a escribir
como guarda. Es la misma duplicación deliberada que ya tiene la tabla de transiciones: dos
mecanismos, una sola regla, comprobada por los dos caminos.

Las dos barreras de ADR-002 siguen siendo las mismas de ADR-020 y no se relajan: el `GRANT UPDATE`
limitado a esas tres columnas y el trigger que protege las demás, prohíbe DELETE para todo rol y
ahora congela desde `awaiting_verification`. ADR-004 sigue aislando la fila por sitio.

Todo lo demás de ADR-020 se conserva: un solo compromiso vigente sin historial de enmiendas, las
ediciones intermedias sin eslabón de auditoría propio, el snapshot definitivo en el evento de cierre,
el retiro de la notificación anterior al cambiar de responsable y las escalaciones ya emitidas
intactas.

## Consecuencias

- `Edit assignment` está disponible en Assigned y In progress para los actores de ADR-017, y
  desaparece en Verification y en Closed.
- El responsable que nombra el evento de cierre es siempre el que ejecutó el trabajo que se verificó.
- Una acción retenida en `awaiting_verification` escala sobre un plazo que ya no se puede mover.
  Moverlo exige rechazar la verificación, que es exactamente lo que corresponde declarar cuando el
  trabajo no se acepta.
- La carrera que serializa el lock deja de ser «editar contra cerrar» y pasa a ser «editar contra
  declarar el trabajo hecho».
- El snapshot que audita el cierre no cambia de contenido ni de momento: ninguna transición anterior
  lleva asignación, y la que se cierra sigue siendo la definitiva.
