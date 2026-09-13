## Context

See `proposal.md` for motivation. The relevant current state:

- `person` is partially mutable (ADR-002, ADR-004): `hs_app` holds `UPDATE (first_name, last_name,
  site_id, deactivated_at)` (`0005_identity.sql`), and `hs_identity_guard()` freezes `id`,
  `employee_number` and `created_at` for every role with `HS001`. `hs_person_audit()` already
  writes `person.renamed`, `person.transferred` and `person.(de|re)activated`, one entry per fact.
- `PATCH /people/:personId` exists only for `{ deactivated: true }` (`deactivate-worker-from-roster`).
- `PATCH /accounts/:id` with `email` alone already updates the email of an account that cannot sign
  in, without reissuing, and refuses one that can (`accountAlreadyActive`); the email change is
  audited by the existing `app_user` trigger.
- The import upserts by `employee_number` (`apply-roster.ts`).
- The roster console builds row acts in `rowActions` and freezes each dialog's data in `dialogFor`
  before the mutation invalidates the roster.

**Tables touched:** `person` (partially mutable; a new column grant and a relaxed guard). No
immutable table is touched.

## Goals / Non-Goals

**Goals:**
- Correct a mistyped name, employee number or invited-account email from the row, in one dialog.
- Keep every correction audited by the database, in the same transaction.

**Non-Goals:**
- Transferring a person to another site, or reactivating one, from the row.
- Correcting the email of an account that can already sign in (that stays the credential reset).
- Reissuing the invitation when the email is corrected here ("New link" already does both).
- Making the import aware of a renumbered person.

## Decisions

### D1 — The employee number is correctable, and a correction is its own audited fact

Lift the freeze on `person.employee_number` in the guard and grant the column to `hs_app`. Keep it
`NOT NULL` and unique: the number still identifies the person; what changes is that a typo in it is
fixable. `hs_person_audit()` writes `person.renumbered` with `previous_employee_number` and
`employee_number`, separate from `person.renamed` — the trigger already writes one entry per fact.

*Alternative:* keep it frozen and correct by deactivate + add. Rejected: it splits the history of
one human across two `person` rows, which is worse for a record defended before a regulator than an
audited correction.

### D2 — The CSV keeps precedence; renumbering presupposes ADP is corrected too

No change to the import. If ADP still delivers the old number, the next import creates a new person
under it. This is accepted and stated in the spec: the correction exists for numbers
mistyped by hand or already corrected at the source. Names corrected by hand are likewise
overwritten by the next import (`The CSV import takes precedence over a person added by hand`).

*Alternative:* have the import match by previous number via the audit log. Rejected: couples the
importer to the audit chain and invents a second identity.

### D3 — Two writes, not one cross-module transaction

The person correction goes to `PATCH /people/:personId` (module `roster`); the email correction goes
to `PATCH /accounts/:id` (module `auth`). A single endpoint writing both would make `roster` call
into `auth` against ADR-008's one-way dependencies. The dialog sends only the fields that changed,
person first, email second. If the second write fails the dialog stays open with the error; the
person correction is already applied and resending it is a no-op, so retrying is safe.

The request body of `PATCH /people/:personId` becomes a union of the existing deactivation and the
correction; the controller dispatches on its shape. Site isolation stays in RLS through
`withSession` (ADR-004); a person outside scope is a not-found. A unique violation on
`employee_number` maps to a dedicated 409 code with nothing written.

### D4 — Email only for an invitation not yet accepted, without reissuing

`dialogFor` freezes `email` and `userId` only when `canReissueInvitation(person)` holds; otherwise
the field is absent. This mirrors the server rule rather than adding a new one.

### D5 — Offered on every active row

`canEditPerson` is `deactivated_at === null`, regardless of account, behind the same `mayInvite`
gate as every other row act. It is the first act in the menu because it is the least destructive.

## Risks / Trade-offs

- [ADP still sends the old number → duplicate person on next import] → documented in the spec and
  the design; the audit entry `person.renumbered` names both numbers so the duplicate is traceable.
- [Person corrected but email write fails] → error shown in the open dialog; retry is idempotent.
- [Relaxing a guard the whole codebase trusted] → the integration test that asserted `HS001` is
  replaced by tests for the correction, the duplicate refusal and the audit entry; `id` and
  `created_at` stay frozen.

## Migration Plan

One forward migration (`CREATE OR REPLACE` of the two functions + `GRANT`). Rollback: a migration
restoring the previous function bodies and `REVOKE UPDATE (employee_number) ON person FROM hs_app`;
numbers already corrected stay as they are.
