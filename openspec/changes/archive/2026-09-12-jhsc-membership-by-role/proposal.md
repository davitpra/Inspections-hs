## Why

`0035` introduced the JHSC seat to fix a real defect: the vocabulary note of
`Requisitos_V1.2.md` §4 declares that "inspector" and "JHSC member" are the same thing, but the
coordinator also sits on the committee and `app_user.person_id` is UNIQUE, so there is no second
account to give her the `jhsc_member` role. The seat — `jhsc_seat_granted_at`, a column granted and
withdrawn from the roster — made committee membership something an administrative account could
occupy without changing its role.

It also opened a second way to be on the committee, and the two disagree at the one moment they
meet. A `jhsc_member` sits **by role**. Promote that same account to `hs_coordinator` and it sits by
nothing: `reduce-roles-to-three` made the promotion explicitly grant no seat, so the person who
inspected last quarter disappears from the inspector candidates of her own site until somebody
remembers to seat her. The system asks an administrator to restore, as a separate act, a membership
that was never in question — and it fails silently, because a missing candidate looks exactly like
a candidate that was never there.

The seat is a mechanism for a problem the role table no longer has. Every account that can sign in
to this platform is on the committee or administers it: seven members, a coordinator, and a
management account that §4 places above the coordinator with the same administrative authority.
Deriving membership from the role removes the second path, and with it the moment the two can
disagree.

This closes no stage of §7. It is a preproduction correction of the identity of stage 2 and the
assignment of stage 3, of the same class as ADR-013, ADR-014, ADR-015 and ADR-022: the surface is
withdrawn before any deployment carries regulatory evidence.

## What Changes

- **BREAKING** Committee membership follows the role. Every account — `jhsc_member`,
  `hs_coordinator` and `management` — sits on the JHSC by virtue of its `role`. There is nothing to
  grant and nothing to lose.
- **BREAKING** The seat is withdrawn root and branch: the `app_user.jhsc_seat_granted_at` column
  and its `CHECK`, the `GRANT UPDATE` that names it, the `jhsc_seat` field of the account and roster
  contracts, the `PATCH /accounts/:id { jhsc_seat }` act with its `account_role_without_jhsc_seat`
  refusal, the roster's Join/Leave JHSC control and its confirmation dialog, and the two audit
  branches `user.jhsc_seat_granted` / `user.jhsc_seat_withdrawn`.
- **BREAKING** Eligibility as `inspector_id` becomes: an active account whose site scope includes
  the inspection's `site_id`. The role stops being part of the question, so `requireInspector`
  refuses for two reasons instead of three and the refusal "The account holds no seat on the JHSC"
  ceases to exist.
- **BREAKING** A `management` account is eligible as `inspector_id` with no prior act. The rule of
  §4 that a manager cannot receive an inspection is withdrawn: management holds the same
  administrative authority as the coordinator since `reduce-roles-to-three`, and the seat was the
  only thing still separating them here.
- Promoting a `jhsc_member` to `hs_coordinator` no longer interrupts that account's membership. The
  sentence of §4 "No concede un asiento en el JHSC como efecto lateral" and the requirement it
  produced are withdrawn together with the seat.
- Existing `audit_log` entries naming `user.jhsc_seat_granted` or `user.jhsc_seat_withdrawn` are
  left untouched. They describe past facts, and the chain is immutable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: committee membership follows the role; the seat as stored state, the roster act that
  grants and withdraws it, and the roster's report of who holds one are withdrawn; the promotion no
  longer has a seat to avoid granting.
- `inspections`: `inspector_id` references an active account whose scope includes the inspection's
  site, with no seat and no role condition; the refusals that named the seat are withdrawn.

## Impact

**Schema (destructive, preproduction only).** A new migration `0047` after
`0046_reduce_roles_to_three.sql`: it rewrites `hs_account_changed_audit()` without the seat branch,
drops `app_user_jhsc_seat_check`, and drops `jhsc_seat_granted_at` with the `REVOKE`/`GRANT UPDATE`
pair that names it. It converts no row. `hs_identity_guard` and the absence of RLS on `app_user`
are untouched.

**Contracts.** `identity.ts`: `jhsc_seat` leaves `personAccountSchema`, `accountSchema` and
`updateAccountRequestSchema`, and the `refine` that kept the seat a solitary act goes with it. The
acts remaining on `PATCH /accounts/:id` are email + invite, `deactivated: true` and `promote_to`.

**API.** `inspections/inspector-eligibility.ts` loses `ACCOUNT_IS_JHSC_MEMBER`,
`ACCOUNT_HOLDS_JHSC_SEAT` and `ACCOUNT_SITS_ON_JHSC` and keeps its reason for existing — the
candidate list and the validation must not diverge; `inspections.service.ts` `requireInspector`;
`auth/account.service.ts` (`seat()` and its dispatch), `account.errors.ts`, `account.repository.ts`;
`roster/roster.repository.ts`; `db/schema/identity.ts`.

**Web.** `RosterRoute/JhscSeatDialog.tsx` is deleted with its wiring in `RosterDialogs.tsx` and
`index.tsx`; `presentation.ts` loses the three seat functions, the `'seat'` action kind and the
`· JHSC seat` suffix of `accountRoleLabel`; `api/roster.ts` loses `setJhscSeat`.

**Docs.** `Requisitos_V1.2.md` §4 loses the sentence about the promotion not granting a seat. ADR-023
records why the seat existed, why deriving membership from the role supersedes it, and that the
retirement puts a `management` account within reach of an inspection assignment.
