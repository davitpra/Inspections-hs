## 1. Contratos — la tabla de transiciones

- [ ] 1.1 En `packages/contracts/src/actions.ts`, agregar `FINDING_REPORTER = 'finding_reporter'`
  junto a `ASSIGNEE`, con su docblock (actor relativo a la acción, resuelto contra la CUENTA de
  `finding.reported_by`; una acción de investigación nunca lo satisface), y ensanchar
  `TransitionActor`.
- [ ] 1.2 Agregar `FINDING_REPORTER` a las filas `open → in_progress` e `in_progress →
  awaiting_verification`; actualizar el docblock de `TRANSITIONS` y de `TransitionActor`
  («las cinco filas son la respuesta completa…»).
- [ ] 1.3 `packages/contracts/src/actions.test.ts`: el reportante solo ejecuta, nunca verifica ni
  crea; conservar que `jhsc_member` no aparece como rol en ninguna fila.

## 2. API — el actor en `transition`

- [ ] 2.1 En `apps/api/src/actions/actions.service.ts`, `requireActor` recibe el `findingId` del
  encabezado; si la fila incluye `FINDING_REPORTER` y hay hallazgo, acepta cuando
  `findingReporter(client, findingId) === session.userId`. Mensaje de `forbidden` sin cambios.
- [ ] 2.2 Actualizar los docblocks de `transition` y `requireActor`, citando ADR-024.
- [ ] 2.3 Confirmar que la comparación de pares de `apps/api/test/corrective-actions.int-spec.ts`
  contra la guarda de 0011 no compara actores (no hay migración que tocar).

## 3. Web — el paso en la ficha

- [ ] 3.1 `apps/web/src/permissions/actions.ts`: `canAttempt(transition, action, session,
  finding)` con `finding: Pick<Finding, 'reported_by'> | null`; acepta `FINDING_REPORTER` cuando
  `session.userId === finding.reported_by`. Docblock actualizado.
- [ ] 3.2 `apps/web/src/routes/InspectionFindingsRoute/presentation.ts`: `nextStep` pasa el
  hallazgo a `canAttempt`.
- [ ] 3.3 `FindingNextStep.tsx` y `AdvanceActionForm.tsx`: pasar el `reported_by` del hallazgo
  hasta `canAttempt` (hoy `FindingNextStep` recibe solo `findingId`).
- [ ] 3.4 Revisar el texto «waiting on» de `nextStep` para que no nombre al responsable como
  única cuenta que puede actuar cuando el lector es el reportante.

## 4. Tests

- [ ] 4.1 `apps/api/test/corrective-actions.int-spec.ts`: un `jhsc_member` reportante inicia y
  declara hecho el trabajo asignado a otra persona (evento con su cuenta,
  `assignee_person_id` intacto); otro `jhsc_member` recibe `forbidden`; un `management`
  reportante que declaró hecho recibe `verifier_is_executor` al cerrar; la acción de
  investigación no acepta al reportante del incidente; el `management` que no reportó sigue
  recibiendo `forbidden`.
- [ ] 4.2 `apps/web/src/permissions/actions.test.ts`: `canAttempt` con el reportante en las dos
  filas de ejecución, rechazado en verificación, con `finding` nulo y sin sesión.
- [ ] 4.3 `InspectionFindingsRoute/presentation.test.ts`: `nextStep` ofrece `Start work` y
  `Mark work done` al reportante con la acción asignada a otra persona; un `jhsc_member` que no
  reportó sigue sin control.
- [ ] 4.4 `InspectionFindingsRoute/index.test.tsx`: el reportante ve y envía `Start work` sobre
  una acción de otra persona, y la ficha queda en `in_progress`.

## 5. Papeleo

- [ ] 5.1 ADR-024 «Quien reportó el hallazgo también ejecuta la acción» y su fila en
  `docs/adr/README.md`; cita ADR-017, ADR-019 y ADR-021 sin editarlas.
- [ ] 5.2 Enmendar §3 R3 de `docs/Requisitos_V1.2.md`: el responsable ejecuta la acción, o quien
  reportó el hallazgo (ADR-024).
- [ ] 5.3 `openspec validate finding-reporter-executes-action --strict`.
