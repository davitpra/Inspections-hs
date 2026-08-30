## Why

Declarar el trabajo hecho exige hoy al menos una evidencia `after`, y esa exigencia está
puesta como compuerta en cuatro capas: el `.refine` del contrato, el chequeo del servicio, la
constraint diferida `HS006` de la migración 0011, y el requisito del spec. El efecto en la
planta es el contrario del que se buscaba: un responsable que ya arregló lo que había que
arreglar y no tiene una foto que subir —el arreglo no se ve, el teléfono se quedó sin
batería, el trabajo lo hizo un contratista que se fue— no puede mover la acción por ningún
camino. La acción se queda en `in_progress` diciendo que el peligro sigue abierto cuando no
lo está, y el escalamiento de +3 y +7 días sale por un problema de cámara.

La evidencia sigue siendo lo que se pide y lo que la pantalla ofrece primero. Deja de ser lo
que bloquea.

Este change **no cierra ninguna etapa de §7**: la etapa 5 quedó completa con R3, y lo que
hace acá es enmendar R3 —retirar la mitad "carga evidencia" como obligación y conservar
entera la mitad "una persona distinta del ejecutor verifica y cierra", que es la que sostiene
el control de cuatro ojos—. Existe porque el alcance vigente cambia, y un alcance que cambia
sin quedar escrito es la forma en que el documento de requisitos y el código empiezan a
contar dos historias. Va con ADR-016, igual que ADR-014 y ADR-015 registraron la retirada de
la clasificación de riesgo y la de la recurrencia.

## What Changes

- **BREAKING** La transición `in_progress → awaiting_verification` deja de exigir evidencia.
  En `packages/contracts/src/actions.ts` la fila de `TRANSITIONS` pierde
  `requires: ['after_evidence']`, `TRANSITION_REQUIREMENTS` queda en
  `['not_executor', 'reason']` —el miembro no le quedaría ningún uso— y
  `transitionRequestSchema` pierde su primer `.refine`. El segundo, el del `reason` al
  rechazar una verificación, no se toca.
- **BREAKING** El servicio deja de rechazar el completado sin evidencia y el código de error
  `evidence_required` desaparece del contrato de errores del módulo, junto con el `case
  'HS006'` que traducía la constraint.
- **BREAKING** Migración forward `0039_optional_completion_evidence.sql`: elimina el
  constraint trigger `corrective_action_evidence_required` y la función
  `hs_action_evidence_required()` de 0011. **No toca ningún GRANT ni ninguna política RLS**:
  `corrective_action_evidence` conserva intactas su inmutabilidad (`hs_make_immutable`) y su
  aislamiento por sitio (`hs_apply_site_isolation`). Lo único que se retira es la compuerta;
  ninguna fila se borra ni se reescribe, y la evidencia ya cargada queda donde está.
- Se conserva **todo lo demás de la evidencia**, que es lo que sostienen ADR-001 y ADR-006 y
  no está en discusión: viaja como `object_key` de un archivo ya subido y nunca como bytes,
  se rechaza una key fuera del prefijo derivado del `site_id` y del id de la acción, se
  acepta `before` en cualquier evento, y cada carga sigue escribiendo su evento de auditoría.
- La interfaz sigue pidiendo la foto primero. En `ActionProgressPanel` el selector de
  evidencia se mostraba porque una transición lo **exigía**; sin el requisito habría
  desaparecido justo donde más se lo quiere, así que pasa a mostrarse cuando existe una
  transición hacia `awaiting_verification`. `EvidencePicker` corrige el pie que promete
  «Required to complete the work».
- Se enmienda §3 R3 de `docs/Requisitos_V1.2.md` y se registra la decisión en ADR-016, con su
  fila en `docs/adr/README.md`. Los ADR aceptados no se reescriben.

## Capabilities

### New Capabilities

Ninguna.

### Modified Capabilities

- `actions`: el requisito «Declaring the work done requires evidence» deja de exigir la
  evidencia `after` y pasa a describir la evidencia como algo que se acepta y se conserva.
  Conserva el `object_key` sin bytes, el rechazo del prefijo ajeno y la aceptación de
  `before` en cualquier evento. Ningún otro requisito del ciclo de vida cambia: la máquina de
  estados, el verificador distinto del ejecutor, el plazo congelado y el escalamiento quedan
  como están.
- `findings`: en «A corrective action is advanced from the finding that justifies it», el
  control de evidencia se sigue ofreciendo antes de declarar el trabajo hecho, pero deja de
  condicionar el envío de la transición.

`immutability` **no cambia**: sus requisitos nombran las tablas de acciones, sus eventos, su
evidencia y sus escalamientos como inmutables y aisladas por sitio, y esta constraint no es
ninguna de las dos cosas.

## Impact

- Contratos: `packages/contracts/src/actions.ts` (la fila de `TRANSITIONS`,
  `TRANSITION_REQUIREMENTS`, el `.refine`) y `actions.test.ts`, que hoy afirma que la
  transición al `awaiting_verification` exige `after_evidence`.
- API: `actions.service.ts` —el chequeo y el docblock de cabecera que enumera las garantías
  del motor— y `actions.errors.ts` —el código, su constructor y el mapeo de `HS006`—.
- Persistencia: migración `0039` y su entrada de journal, posterior a `0038`. `0011` no se
  reescribe: el historial de migraciones es append-only.
- Web: `ActionProgressPanel.tsx` y `EvidencePicker.tsx`. Ninguna ruta cambia de forma.
- Tests: `apps/api/test/corrective-actions.int-spec.ts` pierde los dos casos de la compuerta
  —el rechazo del endpoint y el `HS006` al commitear— y gana el del completado aceptado sin
  evidencia; `incidents.int-spec.ts` conserva sus transiciones, que ya mandan evidencia;
  `packages/contracts/src/actions.test.ts` reformula su afirmación.
- Producto y documentación: §3 R3 de `docs/Requisitos_V1.2.md`, ADR-016 y `docs/adr/README.md`.
