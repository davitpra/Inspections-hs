## Why

A promotion from `jhsc_member` to `hs_coordinator` cannot be undone. The `identity` spec states it
outright — "The promotion SHALL be the only role change the system exposes" — and the `audit` spec
repeats it, so neither the API nor the roster offers a way back. An appointment made by mistake, or a
coordinator who hands the role back while staying on the committee, has no exit other than the
developer and an `UPDATE`, which is exactly what the promotion was introduced to avoid.

This closes no stage of `Requisitos_V1.2.md` §7. It completes the promotion added by
`reduce-roles-to-three` (ADR-022) within stage 2 — accounts and permissions per site — by giving the
one role change the system exposes its inverse, reserved to the same role and bounded by the same
guards.

## What Changes

- An account whose `role` is `management` can demote an active `hs_coordinator` account back to
  `jhsc_member`. Every other role is refused, `hs_coordinator` included: a coordinator neither
  appoints nor removes another coordinator.
- The demotion is refused when the target is not currently `hs_coordinator` (a `management` account
  cannot be demoted), when it is inactive, when it is outside the requesting account's site scope and
  when the requesting account is the target.
- The demotion touches only `app_user.role`. The account keeps its `person_id`, `email`, site scope,
  credential, sessions and invitations, stays on the committee (ADR-023) and stays eligible as
  `inspector_id`. It loses administrative authority on its next request, because `role` is resolved
  from `app_user` at each request.
- The database records it as the `user.role_changed` entry it already writes for any role change;
  no migration is needed.
- `PATCH /accounts/:id` accepts a new solitary act, `demote_to: 'jhsc_member'`, alongside the
  existing `promote_to: 'hs_coordinator'`.
- The roster offers management a confirmed "Demote" action on the row of an active coordinator.
- Promotion and demotion become the only two role changes the system exposes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: the single asymmetry between the administrative roles becomes promoting and demoting a
  coordinator; the promotion requirement stops claiming to be the only role change; a new
  requirement defines the demotion, its guards, its effects and its roster control.
- `audit`: the account-change requirement records the demotion as a role change, and the promotion
  and the demotion are the only role changes the system produces.

## Impact

**Schema.** None. `hs_account_changed_audit()` (restated by `0047`) already audits any change of
`role` with both values, and `hs_app` already holds `UPDATE (role)` on `app_user`.

**Contracts.** `packages/contracts/src/identity.ts`: `updateAccountRequestSchema` gains `demote_to`
and its exclusivity rule.

**API.** `apps/api/src/auth/account.service.ts` gains the demotion next to `promote()`, sharing its
target read and scope check; `account.errors.ts` gains the demotion's refusals.

**Web.** `src/api/roster.ts`, `src/permissions/session.ts` (`canDemote`), and `RosterRoute`
(`presentation.ts`, a `DemoteDialog.tsx`, `RosterDialogs.tsx`).

**Docs.** `Requisitos_V1.2.md` §4 ("La promoción … es el único cambio de rol expuesto") is updated
to name both changes.
