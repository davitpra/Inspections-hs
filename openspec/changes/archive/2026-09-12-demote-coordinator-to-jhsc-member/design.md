## Context

See `proposal.md` — Why. What shapes the approach is how the promotion is already built, because the
demotion is its mirror:

- `PATCH /accounts/:id` (`apps/api/src/auth/account.controller.ts`) parses
  `updateAccountRequestSchema` and hands it to `AccountService.update()`. The promotion is a
  solitary act in that request, `promote_to: z.literal('hs_coordinator')`, with a `refine` that
  forbids combining it with `deactivated`, `email` or `invite`.
- `update()` refuses `promote_to` to every role but `management` before opening the transaction,
  then calls `promote()` inside `asAdministrator`. `promote()` reads the target `FOR UPDATE` together
  with `hs_account_is_active`, `can_sign_in` and an `in_scope` check (no live scope row of the target
  outside the actor's `siteIds`), applies the guards in order — not found, out of scope, self, wrong
  role, inactive — and runs a single `UPDATE app_user SET role`.
- The audit entry is not written by the service. `hs_account_changed_audit()` (restated by `0047`)
  fans out `user.role_changed` with `previous_role` and `role` on any `role IS DISTINCT FROM`, in
  either direction, to every site of the account's scope; `asAdministrator` declares the actor.
- The session guard reads `app_user.role` on every request (`session.service.ts`), so a role change
  is effective on the next request without touching tokens.
- On the web, `canPromote` (`src/permissions/session.ts`) gates the `Promote` row action that
  `rowActions` builds from `canPromoteAccount` (`RosterRoute/presentation.ts`), which opens
  `PromoteDialog.tsx` through `RosterDialogs.tsx`.

ADR-002 (engine-enforced immutability), ADR-011 (authentication, invitations and sessions), ADR-022
(the three roles and management's exclusive promotion) and ADR-023 (committee membership follows the
role) apply and are not rewritten here. No new ADR is needed: the demotion is the inverse of a
decision ADR-022 already took, under the same authority.

**Immutable tables touched.** None. `app_user` is partially mutable by design and `hs_app` already
holds `UPDATE (role)` on it; `audit_log` only receives the `INSERT` its trigger already performs.
No schema object, grant, policy or migration changes.

## Goals / Non-Goals

**Goals:**

- Give management a way back from a promotion that is symmetric with it in contract, guards, audit
  and UI, so that the two acts cannot drift apart.
- Keep the demoted account whole: same credential, sessions, scope and committee membership, only
  without administrative authority.

**Non-Goals:**

- A free role field. `updateAccountRequestSchema` keeps exposing two concrete transitions, not
  `role: Role`.
- Demoting or promoting `management`. Who holds `management` stays outside the system.
- Reassigning work held by the demoted account. Pending verifications, assigned actions and scheduled
  inspections stay where they are (see D5).
- Withdrawing a coordinator's access. That is a different act and this change does not open it.

## Decisions

### D1 — A second literal act, `demote_to: 'jhsc_member'`, on the same route

The request gains `demote_to: z.literal('jhsc_member').optional()`, and the exclusivity `refine` of
`promote_to` is widened so that each of `promote_to` and `demote_to` is solitary: neither combines
with the other, with `deactivated`, with `email` or with `invite`.

*Alternatives.* A single `role_change: 'promote' | 'demote'` field would read shorter but loses what
the literal says: the target role is in the request, so a client and a log both show where the
account is going. A free `role` would reopen every transition, including into and out of
`management`, which this change refuses. A new route (`POST /accounts/:id/demotion`) would split the
account acts across two shapes when the promotion already lives on `PATCH`.

### D2 — One guarded read shared by both transitions

`promote()` is generalized rather than copied: a helper reads the target with the existing query
(`FOR UPDATE OF u`, `active`, `can_sign_in`, `email`, `in_scope`) and applies the common guards —
not found, out of scope, self — and then each transition checks its own source role and inactivity
and runs its `UPDATE`. The `management`-only check stays in `update()`, before the transaction, for
both fields.

The order of guards is the promotion's: `account_not_found` → `account_out_of_scope` →
self → wrong role → inactive. Checking scope before role keeps a manager from learning the role of an
account outside their sites.

*Alternative.* A second function with its own copy of the SQL. Rejected: the scope predicate is the
part most likely to change, and two copies is how one ends up checking something the other does not.

### D3 — Errors mirror the promotion's, by name

`account.errors.ts` gains `account_demotion_forbidden` (403), `account_role_not_demotable` (409,
naming the current role), `account_demotion_inactive` (409) and `account_demotion_self` (403).
`account_not_found` and `account_out_of_scope` are shared.

*Alternative.* Renaming the promotion errors to generic `account_role_change_*`. Rejected: they are
already part of the contract the web reads, and the benefit is cosmetic.

### D4 — No session or credential side effect

The demotion does not call `revokeAllForUser`, unlike `withdraw()`. `role` is resolved at each
request, so the first request after `COMMIT` is already judged as `jhsc_member`; a demoted
coordinator in the middle of a shift keeps their session and simply stops seeing administrative
screens. Revoking would also sign them out of any inspection draft in progress on a shared device,
which ADR-001 accepts losing only when the account loses the right to hold a session — and this one
does not.

### D5 — Nothing tied to the account is reassigned

A demoted account's assigned corrective actions, raised findings and scheduled inspections are
resolved against the account and person, not the role (identity — "Administrative authority…"), and
remain valid. Anything that *requires* an administrator — a verification pending on an action the
account completed as coordinator (ADR-019), an escalation step addressed to `hs_coordinator` — is
addressed to the role and is picked up by whoever holds it. Committee eligibility is unchanged by
ADR-023.

### D6 — Roster control: a separate predicate and a separate dialog

`src/permissions/session.ts` gains `canDemote`, with the same body as `canPromote` but its own name
and test, following that file's rule of one function per decision. `RosterRoute/presentation.ts`
gains `canDemoteAccount` (active `hs_coordinator`), `demoteButtonLabel`, the `'demote'` action kind
and its `RosterDialog` variant; `rowActions` receives the demotion flag next to `mayPromote`.
`DemoteDialog.tsx` is a sibling of `PromoteDialog.tsx`, with copy that says what changes (loses
administrative access on their next action) and what does not (still on the JHSC, same sign-in,
sites and email).

*Alternative.* One `RoleChangeDialog` taking a direction. Rejected for now: the two dialogs share
layout classes, not logic, and the copy is the whole content. If a third transition ever appears,
that is the moment to fold them.

## Risks / Trade-offs

- [A site left without any `hs_coordinator`] → Accepted. `management` holds every administrative
  permission (identity — "Administrative authority…"), so the platform stays administrable, and the
  overdue escalation's second step still reaches management. The system does not decide how many
  coordinators a site needs.
- [A demoted coordinator has a screen open with administrative controls] → The next request is
  refused by the server (403), which is the guarantee; `src/permissions/` is convenience only. The
  session refetch on that error brings the UI in line.
- [Two managers act on the same account at once] → `FOR UPDATE OF u` serializes them; the second one
  sees the new role and gets `account_role_not_demotable`, so only one `user.role_changed` is written.

## Migration Plan

No schema migration. Deploy the contract, API and web together as usual; rollback is reverting the
code, and any demotion already performed is a legitimate `role` value with its audit entry.
