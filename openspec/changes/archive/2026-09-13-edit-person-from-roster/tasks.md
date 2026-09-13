## 1. Schema

- [x] 1.1 Create `apps/api/drizzle/0049_correct_employee_number.sql` (after the existing `0048_rename_roles`, registered in `meta/_journal.json`): `CREATE OR REPLACE FUNCTION hs_identity_guard()` with `person`'s frozen columns reduced to `id` and `created_at` (`app_user` and `user_site_scope` unchanged)
- [x] 1.2 In the same migration, `GRANT UPDATE (employee_number) ON person TO hs_app`; no other grant, no REVOKE lifted, RLS on `person` unchanged
- [x] 1.3 In the same migration, `CREATE OR REPLACE FUNCTION hs_person_audit()` adding a `person.renumbered` branch with `previous_employee_number` and `employee_number`, independent of the `person.renamed` branch
- [x] 1.4 Integration (`apps/api/test/identity.int-spec.ts`): replace the test that expects `HS001` on `employee_number` with: correction succeeds for `hs_app` and keeps `id`; duplicate fails with unique violation; changing `id` still fails with `HS001`
- [x] 1.5 Integration (audit): renumbering writes one `person.renumbered` entry with both numbers; name + number in one update writes two entries

## 2. Contracts

- [x] 2.1 `packages/contracts/src/identity.ts`: `updatePersonRequestSchema` (strict, optional `first_name`, `last_name`, `employee_number`, each trimmed and non-empty, at least one present) and its type, next to `deactivatePersonRequestSchema`
- [x] 2.2 `packages/contracts/src/identity.test.ts`: accepts each field alone and together; refuses empty object, blank strings, unknown keys, and mixing with `deactivated`

## 3. API

- [x] 3.1 `apps/api/src/roster/roster.errors.ts`: a refusal for an inactive person and a 409 with its own code for an `employee_number` already in use
- [x] 3.2 `roster.repository.ts`: update of `first_name`/`last_name`/`employee_number` for one person under the session's RLS scope, returning the row or nothing; unique violation mapped to the 409
- [x] 3.3 `roster.service.ts`: `update(session, personId, request)` behind `requireCoordinator`, via `withSession`; not-found when invisible, refused when `deactivated_at` is non-null
- [x] 3.4 `roster.controller.ts`: `PATCH people/:personId` parses the body as deactivation or correction and dispatches to `deactivate` or `update`
- [x] 3.5 Integration: coordinator corrects name and number in scope; duplicate number refused with nothing written; inactive refused; other site returns not-found; `jhsc_member` refused; empty body refused; equal values write no audit entry

## 4. Web client

- [x] 4.1 `apps/web/src/api/roster.ts`: `updatePerson({ personId, first_name?, last_name?, employee_number? })` over `PATCH /people/:personId`, and `correctAccountEmail({ userId, email })` over `PATCH /accounts/:id` with `email` alone; update the header comment that says corrections go only through the CSV
- [x] 4.2 `apps/web/src/api/roster.test.ts`: both functions send the expected method, path and body

## 5. Roster presentation

- [x] 5.1 `RosterRoute/presentation.ts`: `'edit'` in `RosterActionKind`; `canEditPerson` (`deactivated_at === null`); "Edit" as the first act in `rowActions` with an accessible label built from `personLabel`
- [x] 5.2 `RosterDialog` gains `{ kind: 'edit'; personId; firstName; lastName; employeeNumber; account: { userId; email } | null; label }`, frozen in `dialogFor` with `account` set only when `canReissueInvitation(person)`
- [x] 5.3 `EditPersonState` and `editPersonButtonText` ("Save" / "Saving…" / "Try again"); a pure `personCorrection(initial, current)` returning only the changed person fields and whether the email changed
- [x] 5.4 Update the file's header docblock ("La consola no corrige nombres…")
- [x] 5.5 `presentation.test.ts`: edit offered on every active row and on no inactive row; email frozen only for an invited account; `personCorrection` sends only changed fields

## 6. Roster dialog

- [x] 6.1 `RosterRoute/EditPersonDialog.tsx` following `AddPersonDialog.tsx` (`showModal` in effect, close blocked while pending, `notice--warn` on error): fields prefilled, email field only when `account` is present, submit disabled when nothing changed or a field is blank
- [x] 6.2 On submit: `updatePerson` when person fields changed, then `correctAccountEmail` when the email changed; on success invalidate `queryKeys.roster(siteId)` and close; on failure keep the dialog open with the server message
- [x] 6.3 Mount it in `RosterDialogs.tsx` for `kind: 'edit'`; menu tone neutral in `RosterTable.tsx`
- [x] 6.4 `RosterRoute/index.test.tsx`: the act opens a prefilled dialog; email appears for an invited account and not for a worker or an active member; saving sends only the changes and refreshes the row; a 409 shows the error and keeps the dialog open
