## Context

Ver `proposal.md` — Why. Lo que condiciona el diseño es que la regla que falta ya tiene dos
antecesores exactos:

- `TRANSITIONS` en `packages/contracts/src/actions.ts` ya mezcla roles con un actor relativo,
  `ASSIGNEE` —«la cuenta de la persona responsable de ESTA acción»—, y su docblock exige que la
  tabla sea la respuesta completa a «quién puede hacer qué». `ActionsService.requireActor` lo
  resuelve contra `app_user.person_id`; `canAttempt` en la web, contra `session.personId`.
- ADR-017 ya abrió la creación a la cuenta de `finding.reported_by`, y ADR-021 la corrección de
  la asignación con la misma relación. `ActionsService.findingReporter` ya lee esa columna, y
  `canCreateAction` / `canEditAssignment` ya la comparan con `session.userId`.

`finding.reported_by` es una CUENTA (`app_user.id`), no una persona del roster, así que la
comparación es contra la cuenta de la sesión y no contra su persona.

**Este change no toca ninguna tabla inmutable ni ninguna otra.** No hay migración: la guarda de
0011 compara pares `(from_state, to_state)` y la de 0042 (`HS005`) el autor del evento de
completado; ninguna guarda del motor lee los actores de las filas de ejecución, que solo aplica
el servicio. El trigger de 0040 que deriva el estado del hallazgo no depende de quién actuó.

## Goals / Non-Goals

**Goals:**

- Que quien reportó un hallazgo pueda iniciar y declarar hecho el trabajo de su acción sin
  reasignarse, dejando el registro de responsable intacto.
- Que la regla viva en la tabla de transiciones, como `ASSIGNEE`, y no en un `if` que la tabla
  no muestra.
- Que la ficha ofrezca el paso con la misma decisión que aplica el servidor.

**Non-Goals:**

- Tocar la verificación. `awaiting_verification → closed` y el rechazo siguen siendo de
  `hs_coordinator` / `management` con `not_executor` (ADR-019).
- Extender el actor a una acción de investigación: no tiene `reported_by` de hallazgo, por el
  mismo argumento con el que ADR-017 dejó fuera su creación.
- Cambiar la notificación de asignación, el escalamiento o la frontera de edición de ADR-021.

## Decisions

### D1 — Un segundo actor relativo en `TRANSITIONS`, no una excepción en el servicio

Se agrega `FINDING_REPORTER = 'finding_reporter'` junto a `ASSIGNEE`, `TransitionActor` pasa a
`Role | typeof ASSIGNEE | typeof FINDING_REPORTER`, y las dos filas de ejecución quedan en
`[ASSIGNEE, FINDING_REPORTER, 'hs_coordinator']`.

Alternativa descartada: comprobar `reported_by` a mano en `ActionsService.transition` antes de
`requireActor`. Funciona, pero la tabla dejaría de decir la verdad sobre quién ejecuta, y la web
—que deriva los botones de `TRANSITIONS`— necesitaría la misma excepción copiada en
`canAttempt`: dos copias de una regla que la tabla no nombra, justo lo que su docblock prohíbe.

Alternativa descartada: agregar `jhsc_member` a las filas. Abre la ejecución de TODA acción del
sitio a cualquier inspector, incluidas las de hallazgos que levantó otro, y contradice el
requisito de que un `jhsc_member` sin relación con el registro sea rechazado.

### D2 — Se resuelve contra la cuenta y contra el hallazgo de la acción

`requireActor` recibe además el `findingId` del encabezado de la acción. Si la fila incluye
`FINDING_REPORTER` y la acción tiene hallazgo, compara `findingReporter(client, findingId)` con
`session.userId`. Una acción de investigación (`findingId` nulo) nunca satisface el actor. La
lectura corre dentro de la misma transacción y del mismo alcance RLS que el resto de
`transition`, y después del lock del hallazgo, así que no agrega un camino fuera de alcance.

En la web, `canAttempt` recibe el `reported_by` del hallazgo (o `null`) como tercer dato y lo
compara con `session.userId`, igual que `canCreateAction`. `nextStep` ya tiene el hallazgo;
`FindingNextStep` se lo pasa a `AdvanceActionForm`, que hoy solo recibe la acción.

### D3 — El evento nombra a quien actuó; el responsable no cambia

`actor_user_id` es la cuenta del reportante, como ya es la del coordinador cuando actúa en
nombre de una persona sin cuenta (design D12 de `corrective-action-lifecycle`).
`assignee_person_id` no se toca: moverse de estado y ser responsable siguen siendo dos hechos
distintos, que es exactamente lo que el rodeo de reasignarse confundía.

### D4 — El verificador distinto no se toca y cubre el caso nuevo

`lastExecutor` lee el autor del último evento hacia `awaiting_verification`. Si lo escribió el
reportante, es el ejecutor: una cuenta de `management` que reportó y declaró hecho no puede
cerrar, y `HS005` lo vuelve a imponer en el motor. Un `jhsc_member` reportante no verifica por
rol en ningún caso. El coordinador sigue exento (ADR-019).

## Risks / Trade-offs

- [Un `jhsc_member` puede mover trabajo de una persona que no lo empezó] → el evento registra la
  cuenta que actuó, la verificación sigue siendo administrativa y otra cuenta que declare hecho
  un trabajo sin terminar es rechazada en verificación con razón obligatoria, que queda en el
  stream.
- [La web y el servidor vuelven a discrepar si una sola capa se actualiza] → las dos leen la
  misma fila de `TRANSITIONS`; un `canAttempt` que no conozca `FINDING_REPORTER` simplemente no
  ofrece el botón, nunca ofrece uno que el servidor rechace.
- [`TransitionActor` se ensancha y rompe exhaustividades] → el test de contracts que recorre los
  actores de la tabla se actualiza en la misma tarea; no hay `switch` sobre actores fuera de él.

## Migration Plan

Sin migración de datos ni de esquema. Se despliega API y web juntas como siempre; si solo llega
la API, la web vieja simplemente no ofrece el paso al reportante. Rollback: revertir el commit.
