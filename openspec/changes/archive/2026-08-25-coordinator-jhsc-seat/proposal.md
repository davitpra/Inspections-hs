## Why

Hoy «miembro del JHSC» e «inspector» son el mismo hecho, y ese hecho es un **rol**:
`inspector-eligibility.ts` define la elegibilidad como `u.role = 'jhsc_member'` y
`requireInspector` rechaza cualquier otro. La coordinadora tiene `role = 'hs_coordinator'`
y `app_user.person_id` es UNIQUE — no existe una segunda cuenta de `jhsc_member` que
pudiera dársele. Resultado: la coordinadora no aparece en
`GET /inspections/inspector-candidates`, no puede recibir una inspección y no le queda
ningún camino en el sistema, aunque en la planta real sí se siente en el comité.

Que la coincidencia entre rol y comité sea cierta para los siete miembros no la vuelve una
regla: **el asiento en el JHSC no es un rol, es una posición que una cuenta ocupa o no**.
Para cuatro de los cinco roles esa distinción no cambia nada —un supervisor no se sienta en
el comité—, pero para el coordinador sí, y hoy el sistema no tiene dónde escribirlo.

Este change no cierra una etapa nueva de `docs/Requisitos_V1.2.md` §7: corrige un supuesto
de la **etapa 2** (Persona, Usuario, permisos por sitio) que la **etapa 3** heredó al atar
la elegibilidad de inspector al rol. La nota de vocabulario de §4 queda intacta —
`jhsc_member` sigue siendo el término único para quien está en el comité, e `inspector`
sigue sin ser un rol.

## What Changes

- Una cuenta `hs_coordinator` puede **ocupar un asiento en el JHSC**: un atributo propio de
  la cuenta, otorgado y quitado como acto explícito, reversible y auditado. Ningún otro rol
  puede llevarlo — el motor lo rechaza, no el servicio.
- **La elegibilidad de inspector deja de preguntar por el rol** y pasa a preguntar por el
  comité: `role = 'jhsc_member'` **o** asiento otorgado. Es el mismo predicado compartido
  que ya sostiene la propiedad «todo lo que la lista ofrece, la asignación lo acepta», así
  que el listado de candidatos y la validación de la asignación cambian a la vez o no
  cambian.
- **La consola del roster gana el acto**, en la misma columna que invitar y quitar: la fila
  de una cuenta de coordinador ofrece sentarse en el comité y levantarse de él, y la celda
  Role dice cuál de las dos cosas es cierta hoy. La coordinadora puede hacerlo sobre su
  propia fila — administrar el acceso del JHSC ya es su acto, y no hay otro rol a quien
  pedírselo.
- **Quitar el asiento no reasigna nada.** Las inspecciones ya asignadas conservan su
  `inspector_id` y siguen en los pendientes de esa persona; el asiento gobierna lo que se
  OFRECE y lo que se ACEPTA de aquí en más, no lo que ya se decidió.
- El rol no cambia nunca por este camino: `ROLES` sigue teniendo cinco valores y ninguna
  ruta de este change escribe `app_user.role`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `identity`: el asiento del JHSC existe como atributo de una cuenta `hs_coordinator`,
  quién lo otorga y lo quita, qué escribe en la cadena de auditoría, y qué reporta de él la
  lectura del roster.
- `inspections`: quién puede recibir una inspección — la elegibilidad pasa de «el rol es
  `jhsc_member`» a «la cuenta se sienta en el JHSC», con sus dos casos, en el listado de
  candidatos y en la validación de la asignación.

## Impact

- `apps/api/drizzle/0035_coordinator_jhsc_seat.sql` — `app_user.jhsc_seat_granted_at`
  (nullable, con `CHECK` que la ata a `hs_coordinator`), el `GRANT UPDATE` por columna que
  la hace mutable a propósito, y una rama más en `hs_account_changed_audit()`
  (`user.jhsc_seat_granted` / `user.jhsc_seat_withdrawn`). Espejo en
  `apps/api/src/db/schema/identity.ts`.
- `apps/api/src/inspections/inspector-eligibility.ts` — el predicado compartido pasa a ser
  «se sienta en el JHSC»; `inspections.service.ts` (`requireInspector`) conserva su forma de
  tres mensajes distintos y gana el cuarto caso.
- `packages/contracts/src/identity.ts` — `personAccountSchema` (y con él el detalle de
  cuenta y cada fila del roster) gana `jhsc_seat`; `updateAccountRequestSchema` gana
  `jhsc_seat` como acto solitario, que no se combina con `deactivated`, `email` ni `invite`.
- `apps/api/src/auth/account.service.ts` + `account.errors.ts` — `PATCH /accounts/:id` gana
  la rama del asiento y su error propio para un rol que no puede ocuparlo. No toca sesiones
  ni credenciales: el asiento no da ni quita acceso.
- `apps/api/src/roster/roster.repository.ts` y `auth/account.repository.ts` — proyectan el
  asiento.
- `apps/web/src/api/roster.ts` y `apps/web/src/routes/RosterRoute/` — la mutación, los dos
  predicados de afordancia con sus etiquetas, el diálogo de confirmación y el botón.
- Tests: `apps/api/test/inspection-period.int-spec.ts` (candidatos y asignación),
  un int-spec del asiento (la cadena de auditoría en cada planta del alcance, y quién puede
  ocuparlo), `immutability.int-spec.ts`, y del lado web `presentation.test.ts` e
  `index.test.tsx` de `RosterRoute`.
