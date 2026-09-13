## Why

A typo in a person's name or employee number, or in the email of an invitation nobody has
accepted yet, has no remedy from the People console. The name can only be corrected by editing the
ADP file and importing it again; the employee number cannot be corrected at all — the `identity`
spec declares it "immutable once assigned" and `hs_identity_guard` refuses it with `HS001` — so a
mistyped number added by hand forces deactivating the person and adding her again, which splits
her history across two roster records.

This closes no stage of `Requisitos_V1.2.md` §7. It extends stage 2 — Sitio, Persona, Usuario and
the roster — which is already implemented, by giving the console the correction act that stage
left to the CSV.

## What Changes

- Every **active** row of the People console offers an "Edit" action to administrative accounts,
  opening a dialog prefilled with the person's `first_name`, `last_name` and `employee_number`.
- The dialog also shows the account `email` when, and only when, the person holds an active
  account that cannot sign in yet (an invitation not accepted). An account that can already sign
  in keeps the existing rule: its email is not corrected from the roster.
- `PATCH /people/:personId` accepts, besides the existing `{ deactivated: true }`, a correction of
  `first_name`, `last_name` and/or `employee_number`. It is refused for `jhsc_member`, for an
  inactive person, and for an `employee_number` already carried by another person; a person
  outside the session's scope reads as nonexistent.
- **BREAKING (spec)**: `person.employee_number` stops being immutable. It stays mandatory and
  unique, and correcting it becomes an audited `person.renumbered` event written by the database.
- The email correction reuses `PATCH /accounts/:id` with `email` alone — already accepted today for
  an account that cannot sign in — and does not reissue the link.
- The roster listing stops claiming that no route renames a single person.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: the employee number becomes correctable (still unique and mandatory); the roster
  listing's "no rename through a companion route" clause is lifted; a new requirement defines the
  correction of a person from the roster, its guards and the invited-account email field.
- `audit`: roster audit covers the correction of an employee number as its own event carrying the
  previous and the new value.

## Impact

**Schema.** New migration: `hs_identity_guard()` drops `employee_number` from `person`'s frozen
columns; `GRANT UPDATE (employee_number) ON person TO hs_app`; `hs_person_audit()` gains the
`person.renumbered` branch. `person` is a partially mutable table (ADR-002/ADR-004); no immutable
table is touched.

**Contracts.** `packages/contracts/src/identity.ts`: an update-person request schema next to
`deactivatePersonRequestSchema`.

**API.** `apps/api/src/roster/` (controller, service, repository, errors). No change to
`apps/api/src/auth/`.

**Web.** `src/api/roster.ts`; `RosterRoute` (`presentation.ts`, a new `EditPersonDialog.tsx`,
`RosterDialogs.tsx`).

**Tests.** `apps/api/test/identity.int-spec.ts` inverts the test that expects `HS001` when the
employee number changes.

**Docs.** None. `Requisitos_V1.2.md` §4 ("identificada por número de empleado de ADP") still
holds, and no ADR declares the number immutable.
