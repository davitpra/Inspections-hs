## 1. API — el permiso

- [x] 1.1 En `apps/api/src/actions/actions.service.ts`, reemplazar `requireFindingSite` por
  `requireFinding`, que también devuelve `reported_by`.
- [x] 1.2 `create()`: mover la comprobación de rol adentro de `withSessionClient`, después de
  resolver el hallazgo, aceptando `hs_coordinator` o `session.userId === finding.reportedBy`.
- [x] 1.3 `createForInvestigation()`: sin cambios de comportamiento; anotar en su docblock por
  qué no gana el mismo permiso (no tiene reportante).
- [x] 1.4 Actualizar el docblock de cabecera de la clase.

## 2. API — el selector de responsable

- [x] 2.1 `FindingsService.rosterPackage(session, findingId)`: mismo criterio que
  `InspectionsService.rosterPackage` — cuatro columnas, solo activas, del sitio del hallazgo.
- [x] 2.2 `GET /findings/:id/roster` en `FindingsController`, sin comprobación de rol.

## 3. Web

- [x] 3.1 `apps/web/src/api/findings.ts`: `listFindingRoster(findingId)`.
- [x] 3.2 `apps/web/src/api/query-keys.ts`: `findingRoster(findingId?)`.
- [x] 3.3 `apps/web/src/permissions/actions.ts`: `canCreateAction(account, finding)` acepta
  coordinador o `account.userId === finding.reported_by`.
- [x] 3.4 `presentation.ts`: `nextStep` recibe el hallazgo; la rama `raised` usa la nueva
  `canCreateAction` y actualiza `waitingOn`.
- [x] 3.5 `index.tsx`: pasar `finding` a `nextStep`.
- [x] 3.6 `CreateActionForm.tsx`: leer el roster con `listFindingRoster(finding.id)` en vez de
  `listPeople(finding.site_id)`.

## 4. Tests

- [x] 4.1 `apps/api/test/corrective-actions.int-spec.ts`: el reportante de un hallazgo
  derivado lo abre; el supervisor que reportó un hallazgo manual abre el suyo; otro
  `jhsc_member` es rechazado; un hallazgo fuera de alcance responde `action_not_found`.
- [x] 4.2 `apps/api/test/findings.int-spec.ts`: `rosterPackage` devuelve cuatro columnas, solo
  activas, solo del sitio del hallazgo, y 404 para uno fuera de alcance.
- [x] 4.3 `apps/web/src/permissions/actions.test.ts`: `canCreateAction` con el reportante de
  cualquier rol, con el coordinador que no reportó, y sin sesión.
- [x] 4.4 `apps/web/src/routes/InspectionFindingsRoute/presentation.test.ts`: la rama `raised`
  ofrece el control al reportante y no a un lector cualquiera.
- [x] 4.5 `apps/web/src/routes/InspectionFindingsRoute/index.test.tsx`: mock de
  `listFindingRoster` en vez de `listPeople`; caso del reportante no coordinador.

## 5. Papeleo

- [x] 5.1 ADR-017 y su fila en `docs/adr/README.md`.
- [x] 5.2 §3 R2 de `docs/Requisitos_V1.2.md`.
- [x] 5.3 Deltas `specs/actions/spec.md` y `specs/findings/spec.md` de este change.
- [x] 5.4 Enmendar el requisito «A recorded finding offers one next step at a time» del
  change pendiente `ciclo-de-vida-del-hallazgo` — su texto y su implementación ya asumían
  «solo coordinador» para la etapa `raised`, y quedaría contradicho por este change si no se
  corrige antes de archivarlo.

## 6. Validación

- [x] 6.1 `pnpm -r build && pnpm typecheck && pnpm lint`. Los tres limpios.
- [x] 6.2 `pnpm --filter api exec vitest run --config vitest.integration.config.mts test/corrective-actions.int-spec.ts test/findings.int-spec.ts` — 102 tests, todos verdes.
- [x] 6.3 `openspec validate quien-abre-la-accion --strict` y
  `openspec validate ciclo-de-vida-del-hallazgo --strict` (el change enmendado) — los dos
  válidos.
- [x] 6.4 `pnpm test` en `api`, `contracts` y `web` excluyendo
  `InspectionFindingsRoute/index.test.tsx` — todo verde. Ese archivo tiene 6 fallos
  preexistentes, no introducidos por este change: dependen de `FindingCommitments.tsx`
  —retirado por `ciclo-de-vida-del-hallazgo`, todavía sin archivar y con su verificación
  manual (6.2 de ese change) pendiente— y esperan un `link` con la descripción de la acción
  que la UI actual ya no dibuja. Confirmado con `git diff HEAD` de ese archivo: mis únicos
  cambios ahí son `listPeople` → `listFindingRoster`; las aserciones que fallan no las tocó
  ni esta sesión ni ADR-017.
