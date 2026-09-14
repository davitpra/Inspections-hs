# ADR-017 — Quien reportó el hallazgo también abre la acción correctiva

|                             |                                                                 |
| --------------------------- | --------------------------------------------------------------- |
| **Estado**                  | Superada                                                        |
| **Fecha**                   | 2026-08-29                                                      |
| **Supersede**               | —                                                               |
| **Superada por**            | ADR-025 (parcial: actores administrativos para creación y corrección) |
| **Referencias**             | `docs/Requisitos_V1.2.md` §3 R2, §4; ADR-004, ADR-008, ADR-016  |
| **Changes que la consumen** | `quien-abre-la-accion`                                          |

## Contexto

R2 fija que de un hallazgo sale una acción correctiva con una persona nombrada y una fecha
límite. Hasta ahora, `ActionsService.create` exigía `hs_coordinator` sin excepción: el
miembro del JHSC que recorrió la planta, describió el peligro, lo fotografió y firmó el
envío no podía nombrar responsable, describir el trabajo ni comprometer una fecha sobre su
propio hallazgo. Lo mismo valía para el supervisor o gerente que reporta un peligro a mano
(§5 riesgo F): reportar y comprometer eran dos actos separados por una espera evitable,
justo cuando quien vio el problema tiene el contexto más fresco.

La obligación de "una persona nombrada, un plazo declarado, un origen que audita" no exige
que esa persona sea siempre el coordinador. Exige que la cuenta quede registrada y que la
regla sea verificable contra el mismo registro, no contra un rol ancho.

## Decisión

Puede abrir una acción correctiva sobre un hallazgo el `hs_coordinator`, **o la cuenta que
reportó ESE hallazgo** — `finding.reported_by`. Es una relación con el registro puntual, de
la misma clase que `assignee` ya es sobre una transición: no un rol, sino "esta obligación es
mía". En un hallazgo derivado esa cuenta es quien firmó el envío que lo generó
(`inspection.submitted_by`); en uno manual, quien lo cargó. Un `jhsc_member` que no reportó
el hallazgo sigue sin poder abrir nada sobre él, y un `external_auditor` no puede ser
reportante por ningún camino, así que no gana nada.

**La creación sobre una investigación no cambia** y sigue siendo solo del coordinador: una
investigación no tiene ese reportante — la reporta un supervisor y la investiga el
coordinador — así que no hay cuenta a la que extenderle el permiso.

El servicio resuelve el hallazgo (sitio y `reported_by`) antes de comprobar el permiso: uno
fuera del alcance de la sesión responde `action_not_found`, nunca `forbidden`, para no
convertir el endpoint en un oráculo de qué se está arreglando en la planta donde el
solicitante no tiene alcance (§6 pregunta 5).

**El selector de responsable deja de depender del rol.** `GET /people` sigue siendo del
coordinador y devuelve el perfil completo; el formulario de creación pasa a usar
`GET /findings/:id/roster`, una ruta nueva sin comprobación de rol que devuelve el mismo
`PersonOption` de cuatro columnas que ya sirve `GET /scheduled-inspections/:id/roster` — §4:
se elige a una persona sin poder ver su perfil. La usan TODOS los roles que abren el
formulario, coordinador incluido: un solo camino para la misma elección.

## Consecuencias

- `created_by` de una acción correctiva puede ser una cuenta que no es `hs_coordinator`. El
  campo sigue diciendo exactamente lo que dice: quién la creó.
- El resto del ciclo de vida no cambia: el responsable sigue siendo una persona activa del
  roster de la planta, el plazo sigue congelado al crear, el verificador sigue siendo
  distinto de quien ejecutó (R3), y los escalamientos a +3 y +7 días no se tocan.
- `openspec/specs/actions/spec.md` — "Who may create, execute and verify an action" pasa de
  aceptar la creación solo de `hs_coordinator` a aceptarla también de la cuenta nombrada por
  `finding.reported_by`; la creación sobre una investigación queda sin cambios.
- `openspec/specs/findings/spec.md` — se agrega el requisito de que el selector de
  responsable no revele el perfil, calcado del que ya rige la selección de sujeto de un
  incidente.
- No hay migración: no se agrega columna, no se agrega tabla, no cambia ningún contrato.
  `reported_by` y `PersonOption` ya existían.
