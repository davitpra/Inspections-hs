# ADR-024 — Renombre de los roles coordinator e inspector

|                             |                                                        |
| --------------------------- | ------------------------------------------------------ |
| **Estado**                  | Aceptada                                               |
| **Fecha**                   | 2026-09-13                                             |
| **Supersede**               | La consecuencia de ADR-022 sobre `inspector`           |
| **Superada por**            | —                                                      |
| **Referencias**             | `docs/Requisitos_V1.2.md` §4; ADR-002, ADR-022, ADR-023 |
| **Changes que la consumen** | `rename-roles-coordinator-inspector`                   |

## Contexto

Los nombres `hs_coordinator` y `jhsc_member` ya no describen el vocabulario que usan los
lugares de trabajo. Después de ADR-022 quedan tres roles y la pertenencia al JHSC se deriva
del rol, por lo que `inspector` puede nombrar directamente al rol no administrativo.

ADR-022 dejó `inspector` reservado para el campo `inspection.inspector_id`. Esa consecuencia
de vocabulario queda superada por esta decisión; el resto de ADR-022, incluida la equivalencia
administrativa y los escalados, continúa vigente.

## Decisión

El conjunto cerrado de roles es `coordinator`, `inspector` y `management`. Se usan los mismos
identificadores en la base, contratos, API, web, scripts y auditoría de los actos nuevos.

Las etiquetas de pantalla son **Coordinator**, **Inspector** y **Management**. Dentro de una
frase se escriben en minúscula. El campo `inspection.inspector_id` no cambia de nombre, pero
su etiqueta visible es **Assigned to**, porque la cuenta asignada puede tener cualquiera de
los tres roles.

La migración convierte en sitio las cuentas existentes de `hs_coordinator` a `coordinator` y
de `jhsc_member` a `inspector`, conservando credenciales, sesiones, alcance e historia. Cada
conversión queda registrada por el trigger existente como `user.role_changed`, con el valor
retirado en `previous_role`.

Las entradas de auditoría históricas que contienen los nombres retirados permanecen intactas
y las cadenas siguen verificando. Del mismo modo, las filas inmutables de
`corrective_action_escalation` que ya tienen nivel `hs_coordinator` no se reescriben: se leen
como el primer nivel, mientras que los INSERT nuevos solo aceptan `coordinator` y
`management`.

La pertenencia al JHSC sigue derivándose del rol conforme a ADR-023. Renombrar `jhsc_member`
no retira a ninguna cuenta del comité. No cambia ningún permiso.

## Consecuencias

- Los nombres retirados fallan en nuevos roles, solicitudes y cuentas.
- Las credenciales, sesiones, alcances y registros históricos de las cuentas existentes se conservan.
- `inspector_id`, el endpoint de candidatos y `inspector-eligibility.ts` mantienen sus nombres técnicos.
- `corrective_action_overdue_coordinator` mantiene su nombre de notificación.
- ADR-022 queda superada únicamente en la consecuencia de vocabulario indicada arriba; sus demás decisiones siguen aplicando.
