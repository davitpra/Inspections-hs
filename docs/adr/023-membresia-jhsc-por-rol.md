# ADR-023 — Membresía del JHSC derivada del rol

|                             |                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- |
| **Estado**                  | Aceptada                                                                        |
| **Fecha**                   | 2026-09-12                                                                      |
| **Supersede**               | El asiento JHSC introducido por la migración 0035 y ampliado por 0046           |
| **Superada por**            | —                                                                               |
| **Referencias**             | `docs/Requisitos_V1.2.md` §4; ADR-002, ADR-004, ADR-008, ADR-022                |
| **Changes que la consumen** | `jhsc-membership-by-role`                                                        |

## Contexto

La migración `0035_coordinator_jhsc_seat` introdujo `app_user.jhsc_seat_granted_at` para
representar la pertenencia de la coordinadora al JHSC sin crear una segunda cuenta para la
misma persona. El `person_id` de `app_user` es único, y el rol `jhsc_member` ya expresaba la
membresía de los siete representantes; el asiento resolvía la diferencia para la coordinadora.

La migración `0046_reduce_roles_to_three` amplió el mismo mecanismo a `management`. Eso dejó dos
formas de pertenecer al comité: por rol o por una columna otorgada y retirada desde el roster.
Al promover un `jhsc_member` a `hs_coordinator`, la promoción no otorgaba asiento y la persona
dejaba de aparecer como inspector hasta una segunda acción administrativa.

## Decisión

La membresía del JHSC se deriva únicamente del rol. Toda cuenta activa con rol `jhsc_member`,
`hs_coordinator` o `management` pertenece al comité. No se conserva una columna, un campo de
request, un endpoint ni un control de consola para otorgar, retirar o reportar un asiento.

La elegibilidad como `inspector_id` se define por dos condiciones: la cuenta está activa y su
alcance vigente incluye el sitio de la inspección. La lista de candidatos y la validación de una
asignación comparten ese predicado.

## Consecuencias

- Promover un `jhsc_member` a `hs_coordinator` no interrumpe su membresía ni requiere un acto adicional.
- Una cuenta `management` activa con alcance vigente puede recibir una inspección, sin asiento previo.
- El roster muestra la membresía mediante el rol y deja de mostrar un estado separado.
- Las entradas históricas `user.jhsc_seat_granted` y `user.jhsc_seat_withdrawn` permanecen intactas y legibles. No se escriben nuevas entradas de esos tipos.
- La migración `0047_jhsc_membership_by_role` elimina la columna y su `CHECK` en preproducción. No convierte filas ni modifica el aislamiento RLS, el guard de identidad ni la cadena de auditoría.
