## Why

Desde ADR-017, la cuenta que reportó un hallazgo abre su acción correctiva, y desde ADR-021
corrige su asignación. Pero no puede **moverla**: `open → in_progress` e `in_progress →
awaiting_verification` siguen siendo solo del `assignee` o del `hs_coordinator`. El miembro del
JHSC que recorrió la planta, abrió la acción y nombró a una persona del roster queda mirando un
`Start work` que no se le ofrece, aunque la ficha ya le ofrezca `Edit assignment` sobre la misma
acción.

El rodeo que hoy existe es reasignarse a sí mismo para poder iniciar el trabajo, y ese rodeo
**falsea el registro**: R2 pide una persona nombrada como responsable, y el registro pasa a
nombrar a quien reportó en vez de a quien realmente hace el trabajo. Es peor en el caso más
común de la planta: 200+ personas en el roster y 15-20 cuentas, así que el responsable casi
nunca tiene cuenta propia, y hoy solo el coordinador puede actuar en su nombre (design D12 de
`corrective-action-lifecycle`). Quien reportó tiene el mismo contexto que justificó abrir la
acción y es el que está en la planta para ver que el trabajo empezó.

Este change **no cierra ninguna etapa nueva de §7**: la etapa 5 (la acción correctiva) sigue
completa. Enmienda §3 R3 —quién ejecuta la acción—, igual que ADR-017 enmendó R2 sobre quién la
abre. Va con un ADR nuevo, ADR-024, porque la spec escrita («only from the account of the
assigned person or from an `hs_coordinator`») queda desactualizada y los ADR aceptados no se
reescriben.

## What Changes

- **BREAKING** La tabla de transiciones de `packages/contracts/src/actions.ts` gana un segundo
  actor relativo, junto a `assignee`: **la cuenta nombrada por `reported_by` del hallazgo de la
  acción**. Las dos filas de ejecución —`open → in_progress` e `in_progress →
  awaiting_verification`— lo aceptan. La creación y las dos filas de verificación no cambian.
- `ActionsService.transition` resuelve ese actor contra el hallazgo de la acción y la cuenta de
  la sesión. Una acción sobre una investigación no tiene reportante: para ella nada cambia.
- El evento sigue nombrando a la cuenta que actuó (`actor_user_id`), y `assignee_person_id` no
  cambia: quien reportó mueve el trabajo **sin** pasar a ser responsable.
- La regla del verificador distinto (R3, ADR-019) queda como está y se aplica sola: si quien
  reportó declaró el trabajo hecho, es el ejecutor, y una cuenta de `management` que lo haya
  hecho no puede verificarlo.
- `canAttempt` en `apps/web/src/permissions/actions.ts` pasa a recibir también el `reported_by`
  del hallazgo, para que la ficha ofrezca `Start work` y `Mark work done` a quien lo reportó
  aunque la acción esté asignada a otra persona. Sigue siendo comodidad, no garantía.
- Se enmienda §3 R3 de `docs/Requisitos_V1.2.md` y se registra la decisión en ADR-024, con su
  fila en `docs/adr/README.md`.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: el requisito «Who may create, execute and verify an action» deja de aceptar la
  ejecución —`open → in_progress` e `in_progress → awaiting_verification`— solo del responsable
  o del coordinador: la acepta también de la cuenta nombrada por `reported_by` del hallazgo de
  la acción. La creación, la verificación, el verificador distinto, el plazo y el escalamiento no
  cambian.
- `findings`: los dos requisitos que deciden qué paso ofrece la ficha —«A recorded finding
  presents its persisted five-state lifecycle and one next step» y «A corrective action is
  advanced from the finding that justifies it»— se enmiendan sin cambiar de título: quien
  reportó el hallazgo recibe el paso de ejecución aunque la acción sea de otra persona, y el
  lector al que se le dice a quién espera el hallazgo pasa a ser quien ni lo reportó ni es el
  responsable.

`immutability` **no cambia**: no se agrega tabla, columna ni guarda del motor — la migración
0011 compara pares de estados y `HS005`, no actores de las filas de ejecución. `identity` **no
cambia**: no se agrega ningún rol.

## Impact

- Contratos: `packages/contracts/src/actions.ts` (`FINDING_REPORTER`, `TransitionActor`, las dos
  filas de ejecución y su docblock) y `actions.test.ts`.
- API: `apps/api/src/actions/actions.service.ts` (`requireActor` y el docblock de `transition`).
  Sin migración.
- Web: `apps/web/src/permissions/actions.ts` (`canAttempt`),
  `apps/web/src/routes/InspectionFindingsRoute/presentation.ts` (`nextStep`),
  `AdvanceActionForm.tsx` y `FindingNextStep.tsx`.
- Tests: `apps/api/test/corrective-actions.int-spec.ts` gana los casos de quien reportó
  iniciando y declarando hecho el trabajo de otra persona, de otro `jhsc_member` rechazado, del
  reportante `management` rechazado como verificador de lo que ejecutó, y de la acción de
  investigación sin cambios; `apps/web/src/permissions/actions.test.ts`,
  `InspectionFindingsRoute/presentation.test.ts` e `index.test.tsx` ganan los casos del
  reportante.
- Producto y documentación: §3 R3 de `docs/Requisitos_V1.2.md`, ADR-024 y
  `docs/adr/README.md`.
