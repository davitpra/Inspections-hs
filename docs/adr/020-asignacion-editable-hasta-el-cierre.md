# ADR-020 — La asignación es editable hasta el cierre

|                             |                                                                  |
| --------------------------- | ---------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                         |
| **Fecha**                   | 2026-09-02                                                       |
| **Supersede**               | ADR-018                                                          |
| **Superada por**            | —                                                                |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R2, §4, §7; ADR-002, ADR-004, ADR-014, ADR-017, ADR-019 |
| **Changes que la consumen** | `edit-corrective-action-until-closed`                            |

## Contexto

ADR-018 convirtió cada corrección de responsable, trabajo o plazo en otra instantánea inmutable.
Aunque todas pertenecen a una sola acción, leerlas juntas presenta un error operativo como varias
decisiones finales. El compromiso todavía puede corregirse mientras la acción se ejecuta o espera
verificación; el veredicto final aparece cuando un verificador distinto la cierra.

La consecuencia de ADR-014 que congelaba `due_at` al crear se vuelve demasiado temprana bajo esta
frontera. Las escalaciones que ya ocurrieron sí son hechos y no se pueden retirar porque luego cambie
el plazo.

## Decisión

`corrective_action.assignee_person_id`, `description` y `due_at` forman una sola asignación vigente.
Los tres se reemplazan juntos mientras el estado derivado no sea `closed`. El cierre congela la fila:
desde ese momento el motor rechaza cualquier cambio. El estado sigue derivándose únicamente de
`corrective_action_event`.

La mutabilidad parcial se fuerza con las dos barreras de ADR-002: un `GRANT UPDATE` limitado a esas
tres columnas para `hs_app` y un trigger que protege las demás columnas, rechaza todo UPDATE después
del cierre y prohíbe DELETE para cualquier rol. ADR-004 sigue aislando la fila por sitio.

Las ediciones intermedias no son hechos de auditoría. `action.created` identifica la acción sin copiar
los valores provisionales, y el evento auditado que llega a `closed` incorpora responsable, trabajo y
plazo definitivos. Las transiciones, evidencias y escalaciones continúan append-only.

Cuando cambia el responsable, la notificación operativa anterior se retira de su bandeja mediante
`withdrawn_at`, sin DELETE, y se notifica al responsable vigente. Un cambio de plazo gobierna solo
escalaciones futuras; las ya emitidas permanecen.

## Consecuencias

- `Edit assignment` está disponible en Assigned, In progress y Verification para los mismos actores
  autorizados por ADR-017, y desaparece en Closed.
- La etapa Assigned presenta una sola asignación vigente y ningún historial de enmiendas.
- La tabla y el endpoint de enmiendas se retiran antes de producción, consolidando primero su último
  valor de desarrollo sobre la acción.
- La instantánea definitiva se puede defender desde el evento de cierre y no desde la creación.
- Cambiar una asignación no altera el stream de estado ni deshace notificaciones o escalaciones que ya
  representen hechos consumados.
