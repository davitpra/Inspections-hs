## Why

`ActionsService.create` exige hoy `hs_coordinator` sin excepción. El miembro del JHSC que
recorrió la planta, describió el peligro, lo fotografió y firmó el envío no puede nombrar
responsable, describir el trabajo ni comprometer una fecha sobre su propio hallazgo: tiene
que esperar a que el coordinador lea la inspección para que el compromiso exista. Lo mismo
le pasa al supervisor o gerente que reporta un peligro a mano (§5 riesgo F): reportar y
comprometer son hoy dos actos separados por una espera evitable, justo cuando quien vio el
problema tiene el contexto más fresco —lo que la planilla prescribía, lo que encontró, cuánto
urge.

R2 exige una persona nombrada y una fecha límite. No exige que quien las declare sea siempre
el coordinador. La regla que faltaba es una relación con el registro puntual —"yo reporté
este hallazgo"—, de la misma clase que `assignee` ya es sobre una transición, y no un rol
ancho nuevo.

Este change **no cierra ninguna etapa nueva de §7**: la etapa 5 (la acción correctiva) sigue
completa. Lo que hace es enmendar R2 —quién puede declarar el compromiso—, igual que
ADR-016 enmendó R3 sobre la evidencia de cierre. Va con un ADR nuevo, ADR-017, por el mismo
motivo que aquel: el alcance vigente cambia y una spec escrita («creation only from an
`hs_coordinator`») que queda desactualizada es la forma en que el código y el documento
empiezan a contar dos historias distintas.

## What Changes

- **BREAKING** `ActionsService.create` acepta la creación de una cuenta `hs_coordinator` **o
  de la cuenta nombrada por `finding.reported_by`** del hallazgo sobre el que se abre la
  acción. La comprobación de rol se mueve DESPUÉS de resolver el hallazgo: uno fuera del
  alcance de la sesión responde `action_not_found`, nunca `forbidden` — el 404 sigue siendo
  del hallazgo y no de la acción, como ya documenta el servicio para el resto de sus lecturas.
  `ActionsService.createForInvestigation` **no cambia**: sigue siendo solo del coordinador,
  porque una investigación no tiene ese reportante.
- Nuevo `GET /findings/:id/roster`: el subconjunto activo de personas de la planta del
  hallazgo, con la misma forma de cuatro columnas (`PersonOption`) que ya sirve
  `GET /scheduled-inspections/:id/roster` — §4 exige elegir a una persona sin ver su perfil.
  Sin comprobación de rol: quien puede leer el hallazgo puede elegir a quién lo arregla.
- El formulario de creación de la acción (`CreateActionForm.tsx`) deja de leer `GET /people`
  —que es del coordinador y devuelve el perfil completo— y pasa a leer la ruta nueva, para
  **todos** los roles que lo abren, coordinador incluido: un solo camino para la misma
  elección.
- `canCreateAction` en `apps/web/src/permissions/actions.ts` pasa a recibir también el
  hallazgo y a ofrecer el control al coordinador o a quien lo reportó. Sigue siendo
  comodidad de interfaz, no garantía: el servidor vuelve a exigirlo.
- Se enmienda §3 R2 de `docs/Requisitos_V1.2.md` y se registra la decisión en ADR-017, con su
  fila en `docs/adr/README.md`. Los ADR aceptados no se reescriben.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: el requisito «Who may create, execute and verify an action» deja de aceptar la
  creación únicamente de un `hs_coordinator`: acepta también la cuenta nombrada por
  `finding.reported_by` del hallazgo sobre el que se abre la acción. La creación sobre una
  investigación no cambia. Ningún otro requisito del módulo cambia: la máquina de estados,
  el verificador distinto del ejecutor, el plazo congelado y el escalamiento quedan como
  están.
- `findings`: se agrega el requisito de que el responsable se elige sin ver su perfil —cuatro
  columnas y nada más—, calcado del que ya rige la selección de sujeto de un incidente. El
  requisito «Coordinators open a corrective action from the finding that justifies it» se
  enmienda sin cambiar de título —es el que el emparejamiento de OpenSpec usa para ubicar el
  requisito existente—: el control de creación se ofrece también a quien reportó el hallazgo,
  no solo al coordinador.

`immutability` **no cambia**: no se agrega ninguna tabla ni columna. `identity` **no
cambia**: `GET /people` sigue siendo del coordinador; la ruta nueva cuelga de `findings`, no
del roster general.

## Impact

- API: `apps/api/src/actions/actions.service.ts` (el permiso de `create`, su docblock, y el
  de `createForInvestigation` explicando por qué no cambia), `apps/api/src/findings/
  findings.service.ts` (`rosterPackage`) y `apps/api/src/findings/findings.controller.ts`
  (`GET /findings/:id/roster`). Sin migración: no se agrega columna ni tabla.
- Contratos: ninguno. `PersonOption` y `finding.reported_by` ya existían.
- Web: `apps/web/src/api/findings.ts` (`listFindingRoster`), `apps/web/src/api/query-keys.ts`
  (`findingRoster`), `apps/web/src/permissions/actions.ts` (`canCreateAction`),
  `apps/web/src/routes/InspectionFindingsRoute/presentation.ts` (`nextStep`),
  `apps/web/src/routes/InspectionFindingsRoute/index.tsx` y `CreateActionForm.tsx`.
- Tests: `apps/api/test/corrective-actions.int-spec.ts` gana los casos de quien reportó
  abriendo su acción, de otro `jhsc_member` rechazado, y del hallazgo fuera de alcance
  respondiendo 404; `apps/api/test/findings.int-spec.ts` gana el roster del hallazgo;
  `apps/web/src/permissions/actions.test.ts`, `presentation.test.ts` e `index.test.tsx` se
  actualizan a la nueva firma y ganan los casos del reportante.
- Producto y documentación: §3 R2 de `docs/Requisitos_V1.2.md`, ADR-017 y
  `docs/adr/README.md`.
