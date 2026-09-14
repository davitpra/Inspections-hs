## Context

Ver `proposal.md` — Why. El estado actual que condiciona el diseño:

- ADR-022 fijó que `management` comparte las facultades administrativas de `coordinator`, y la
  regla vive en `isAdministrator` de `packages/contracts/src/identity.ts`. La web la usa en
  `src/permissions/session.ts`; incidents la usa en `hasRole` (API) y `availableTransitions`
  (web) con la forma «la fila nombra a `coordinator` y la sesión es administradora».
- Las acciones correctivas no la usan. Hay cuatro comprobaciones fijas a `'coordinator'` en
  `ActionsService` (`create`, `replaceAssignment`, el adelanto de `not_executor` en `transition`,
  `createForInvestigation`), una en la web (`canCreateAction`), y la tabla `TRANSITIONS` de
  contracts nombra solo a `coordinator` en las filas de creación y ejecución.
- La excepción del verificador vive en el motor: `hs_action_verifier_guard` (`HS005`, 0011,
  reescrita en 0042 y en 0048) lee el rol de `app_user` y deja pasar solo a `coordinator`.
- La guarda de pares de 0011 compara `(from_state, to_state)` y no actores; ninguna otra guarda
  del motor lee roles de acciones.

**Este change toca una tabla inmutable solo a través de su guarda**: reemplaza el cuerpo de
`hs_action_verifier_guard`, trigger `BEFORE INSERT` sobre `corrective_action_event`. No altera
tablas, columnas, GRANTs, REVOKEs ni políticas RLS. Las filas existentes de
`corrective_action_event` no se leen ni se reescriben (ADR-002).

## Goals / Non-Goals

**Goals:**

- Una sola respuesta a «¿es administrador?» en las acciones correctivas, la misma que usa el resto
  de la plataforma.
- Que `TRANSITIONS` siga siendo la respuesta completa a quién ejecuta qué, sin excepciones
  escondidas en el servicio.
- Que la excepción del verificador la siga forzando el motor, leyendo el rol vigente.

**Non-Goals:**

- Retirar `not_executor` o la guarda `HS005`. Siguen protegiendo el INSERT directo de un actor
  `inspector` y cualquier rol verificador futuro que no sea administrativo.
- Cambiar la escalación: a +3 días sigue llegando a `coordinator` y a +7 a `management`.
- Cambiar `GET /people`, `GET /findings/:id/roster` o cualquier contrato HTTP.
- Tocar la promoción y la degradación, que siguen siendo exclusivas de `management` (ADR-022).

## Decisions

### D1 — `management` entra en las filas de `TRANSITIONS`, no en un `hasRole` ensanchado

Las filas `null → open`, `open → in_progress` e `in_progress → awaiting_verification` pasan a
nombrar `'coordinator', 'management'` explícitamente, como ya lo hacen las dos de verificación.
`requireActor` (API) y `canAttempt` (web) no cambian: `roles.includes(session.role)` ya acepta.

Alternativa descartada: copiar el `hasRole` de incidents (`roles.includes('coordinator') &&
isAdministrator(role)`) en `requireActor` y `canAttempt`. Deja la tabla diciendo `coordinator`
cuando la regla aplicada es otra, y el docblock de `TRANSITIONS` exige que la tabla sea la
respuesta completa. `VERIFIER_ROLES` se deriva de la tabla y no cambia.

### D2 — Las comprobaciones de creación y corrección usan `isAdministrator`

`create`, `replaceAssignment` y `createForInvestigation` preguntan `isAdministrator(session.role)`
en lugar de `session.role !== 'coordinator'`; la relación con `finding.reported_by` de ADR-017 se
conserva igual. En la web, `canCreateAction` pasa a `isAdministrator(account.role) ||
account.userId === finding.reported_by`, y `canEditAssignment` sigue delegando.

Alternativa descartada: leer `TRANSITIONS[null → open].roles` en `create`. La creación sobre un
hallazgo también acepta al reportante, que la fila de creación no nombra (ADR-017 lo resolvió en
el servicio), así que la fila no es la respuesta completa para la creación y no conviene fingir
que lo es.

### D3 — La guarda del motor se reescribe en una migración nueva

`0050_administrator_verifier_exception.sql` hace `CREATE OR REPLACE FUNCTION
hs_action_verifier_guard()` con el mismo cuerpo que 0048 salvo la condición:
`IF actor_role IN ('coordinator', 'management') THEN RETURN NEW;` y el `HINT` actualizado. Sigue
sin `SECURITY DEFINER` y leyendo `app_user`. El adelanto de `transition` pasa a
`!isAdministrator(session.role)`, que es la misma condición.

Alternativa descartada: eliminar el trigger porque ningún rol verificador queda sujeto a la regla.
ADR-002/004 fijan que la regla dura la fuerza el motor; sin trigger, un INSERT directo con un actor
`inspector` pasaría, y agregar un rol verificador no administrativo dejaría la regla sin barrera.

La lista de roles queda escrita en SQL en lugar de derivarse de `isAdministrator`: es la misma
duplicación deliberada que ya tiene la tabla de transiciones, y el test de integración la
comprueba por los dos caminos.

### D4 — ADR-025 supera en parte a ADR-017 y ADR-019

Se escribe `docs/adr/025-management-y-las-acciones-correctivas.md`. En ADR-017 y ADR-019 solo se
edita la cabecera (`Superada por: ADR-025 (parcial: …)`), como ADR-022 con ADR-024. ADR-021 no se
supera: su frontera no cambia, solo se amplían los actores de ADR-017 a los que remite. La
numeración salta el 024 duplicado, que no se corrige en este change.

## Risks / Trade-offs

- **[El control de cuatro ojos de R3 queda sin sujeto real en v1]** Los dos roles que pueden
  verificar son administrativos y los dos quedan exentos; un `inspector` nunca llega a verificar
  porque `requireActor` lo rechaza antes con `forbidden`. → Es la decisión tomada y queda
  explícita en ADR-025. Lo que la hace defendible es el mismo argumento de ADR-019: el evento de
  completado y el de cierre nombran a su actor y son append-only, así que una auditoría puede
  listar qué acciones cerró la misma cuenta que las declaró hechas.
- **[`verifier_is_executor` deja de ser alcanzable por el endpoint]** → El código de error y su
  traducción se conservan; los tests que lo esperaban de un `management` se invierten, y el
  escenario de la ficha pasa a describir cualquier rechazo del servidor.
- **[Una cuenta degradada de `coordinator` a `inspector` entre declarar y cerrar]** → La guarda lee
  el rol vigente al INSERT, así que pierde la excepción; hay escenario para eso.
- **[Divergencia entre el SQL y `isAdministrator` si se agrega un rol]** → El test de integración
  de la guarda recorre `ROLES` y compara la aceptación del motor con `isAdministrator`.

## Migration Plan

1. Aplicar `0050` con `pnpm db:migrate`: es un `CREATE OR REPLACE FUNCTION`, sin bloqueo de
   tablas ni reescritura de filas.
2. Desplegar API y web juntas. Si la API sale antes que la web, la web no ofrece los controles a
   `management` pero el servidor ya los acepta; si la web sale antes, `management` ve controles
   que el servidor rechaza con `forbidden`, que es un error que se lee.
3. Rollback: una migración que restaure el cuerpo de 0048 (`actor_role = 'coordinator'`) y el
   revert del código. Las acciones que `management` haya abierto o cerrado mientras tanto quedan
   en el registro con su actor, que es lo correcto.
