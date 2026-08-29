## Context

See `proposal.md` for motivation. The roster currently lists active people and supports
single-person creation, while all updates are performed by CSV import. `person` already has
`deactivated_at`, column-level UPDATE privilege for `hs_app`, site RLS, and a database audit
trigger. This change touches the immutable `person` table: it uses the existing permitted
deactivation update and never adds DELETE capability, consistent with ADR-002 and ADR-004.

## Goals / Non-Goals

**Goals:**

- Make one conditional state transition atomic: active person with no active account to inactive.
- Preserve site isolation and avoid disclosing whether an out-of-scope person exists.
- Reuse the existing roster query, audit trigger, dialog patterns, and query invalidation.

**Non-Goals:**

- Editing names, employee numbers, or site assignments from a row.
- Deactivating a person whose linked account is active.
- Reactivating a person or physically deleting any record.
- Adding an offline mutation; roster administration remains online per ADR-001.

## Decisions

### D1: Use `PATCH /people/:personId` with a fixed deactivation body

The web client sends `{ deactivated: true }`, matching the account lifecycle API while leaving
room for a future separately specified reactivation operation. `DELETE` is rejected because
the domain operation preserves the row. A specialized action URL was considered, but PATCH
expresses the resource state transition without creating an RPC-shaped endpoint.

### D2: Lock the person before checking eligibility and updating

The repository first selects the RLS-visible person `FOR UPDATE`, then locks any associated
`app_user`, reads its current activity through `hs_account_is_active`, and finally updates
`deactivated_at` in the same transaction only when the account is absent or inactive. The person
lock conflicts with the foreign-key lock needed to create an account, while the account lock
serializes concurrent reactivation. A single conditional UPDATE with `NOT EXISTS` was rejected
because its statement snapshot could miss an account transaction that committed while the
UPDATE waited for a lock.

### D3: Let RLS provide the site boundary

The service runs through `DbService.withSessionClient`; the person ID is selection, not a
security boundary. An out-of-scope ID and an unknown ID both return not found. Adding a
`site_id` supplied by the browser or manufacturing scope with `withSiteScope` was rejected as
contrary to ADR-004.

### D4: Keep audit generation in the database

The endpoint performs only the person update. The existing `hs_person_audit` trigger writes
`person.deactivated` atomically, satisfying the audit capability without caller-managed log
inserts. No migration is needed because the privilege, trigger, and RLS policy already cover
`deactivated_at`.

### D5: Model worker deactivation as a distinct row action and dialog

`rowActions` adds a danger action when the person is active and the same presentation predicate
that labels the row `Worker` reports no active account. Its dialog snapshots the person ID and
label, then a dedicated confirmation component performs the mutation and invalidates the roster
prefix. Reusing `RemoveAccessDialog` was rejected because account deactivation and person
deactivation have different targets and consequences.

## Risks / Trade-offs

- [A subsequent CSV can reactivate the person] -> Keep CSV as the authoritative bulk source
  and state in the confirmation that a later import can restore the worker if marked active.
- [A stale UI offers the action after an account is created or reactivated] -> The locked server
  check refuses an active account; the dialog shows the error and keeps the roster unchanged.
- [The operation uses three statements] -> Keep all statements in the existing session-scoped
  transaction and hold the person row lock until commit; the roster size makes lock duration
  negligible.

## Migration Plan

Deploy contracts and API before or together with the web application. No database migration or
data backfill is required. Rollback removes the endpoint and UI; already deactivated rows remain
valid and can be reactivated through the existing CSV import.
