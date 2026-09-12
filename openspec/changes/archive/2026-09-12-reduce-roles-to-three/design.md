## Context

See `proposal.md` — Why. What shapes the approach is where the five roles are actually written down:

- The closed set lives in three places that must agree: `ROLES` in `packages/contracts/src/identity.ts`,
  the `app_user_role_check` of `0005`, and the mirror of that check in the Drizzle schema of
  `apps/api/src/db/schema/identity.ts`. `0005` says why it is a `CHECK` and not an enum — precisely
  so that the set can be narrowed without recreating a type and every column that uses it.
- Two roles are not just names. `external_auditor` owns three columns of `app_user`, a lifecycle
  `CHECK`, the `hs_apply_record_window` policy of `0006` applied to `audit_log`, the
  `hs_auditor_read_event` function and the auditor branch of `withSessionScope`. `supervisor` owns
  the first level of `corrective_action_escalation` and one of the four values of
  `notification_kind_check`.
- The permission checks are scattered as `session.role !== 'hs_coordinator'` across seven modules of
  the API and eight predicates of `apps/web/src/permissions/session.ts`. There is no shared predicate
  to widen; each one repeats the comparison.

ADR-002 (engine-enforced immutability), ADR-004 (RLS per site), ADR-008 (module boundaries) and
ADR-011 (authentication, invitations and sessions) all apply and are not rewritten here. ADR-022 is
added by this change to record the retirement and the redefinition.

**Immutable tables touched.** Two, and only through DDL by the owner, never through a row write:

- `corrective_action_escalation` — `hs_make_immutable` in `0011`. Its `level` `CHECK` is narrowed.
  No row is updated or deleted; the table holds no row at all in the development database.
- `notification` — its `notification_kind_check` is replaced, as `0011` and `0012` already each
  replaced it in turn.

`app_user` is partially mutable by design (`0005` §11 grants `UPDATE` column by column). Dropping
three of its columns removes them from that grant; the `hs_identity_guard` that freezes `id`,
`person_id` and `created_at` is untouched. `audit_log` itself is not modified: only a policy that
reads it is dropped, and no entry is rewritten or removed.

## Goals / Non-Goals

**Goals:**

- Make the three-value role set the single truth in the three places that state it, so a fourth
  value cannot enter through one of them.
- State the coordinator/management equivalence in one place, in the specs and in the code, so that
  separating the two roles later is one edit rather than forty.
- Remove the auditor machinery entirely rather than leaving it dormant, so no reader has to work out
  which of it is live.
- Keep the two-step escalation of §3 R3 intact, with a recipient that can exist.

**Non-Goals:**

- Building the screens the withdrawn roles never had. `/incidents` is still absent from the
  navigation and no notification inbox exists; both are real gaps and both stay open after this
  change.
- Demotion. Only `jhsc_member` → `hs_coordinator` is exposed. Reversing a promotion is not designed
  here and is not a hidden capability of the endpoint.
- Any relaxation of what a `jhsc_member` may read. The incident visibility policy keeps its shape.
- Migrating data. The migration is written for a database that holds no account, escalation or
  notification of a withdrawn kind, and aborts otherwise.

## Decisions

### The equivalence is stated once, not spread over forty requirements

`management` gains the coordinator's administrative permissions. Expressed literally, that edits
every requirement in six capabilities that names `hs_coordinator`, and every
`session.role !== 'hs_coordinator'` in the API.

Instead, the `identity` capability carries one requirement — *Administrative authority is held by
the coordinator and by management* — that says a requirement naming `hs_coordinator` as the
permitted account is read as naming `management` equally. The other capabilities' deltas then touch
only what actually breaks: a scenario whose actor is a role that no longer exists, or normative text
that would otherwise contradict the equivalence.

In the code the counterpart is a single predicate. `apps/api/src/auth/roles.ts` exports
`isAdministrator(role)`, and every `session.role !== 'hs_coordinator'` becomes
`!isAdministrator(session.role)`. On the web the eight predicates of `permissions/session.ts` keep
their names and their one-decision-per-function shape — that file already argues why they are eight
and not one `isCoordinator` — and each delegates to a shared `canAdminister(account)`.

*Alternative considered:* editing each requirement and each call site to name both roles. Rejected
because it spreads one decision across forty places, and because the day the roles diverge — which
the escalation and the verifier exception below show is already the case for two of them — every one
of those places has to be re-read to find out which ones meant "the coordinator specifically".

*The equivalence has three declared exceptions*, each stated where it lives: creating and advancing
a corrective action (`actions`), the verifier exception of ADR-019, and the promotion itself. They
are exceptions because they are not administrative acts — they follow from a relation to a record,
or from there being exactly one coordinator.

### The promotion is a field of the existing account update, not a new endpoint

`PATCH /accounts/:id` already carries `email`, `invite`, `deactivated` and `jhsc_seat`, and
`updateAccountRequestSchema` already models "one act on one account". The promotion becomes
`promote_to: z.literal('hs_coordinator').optional()`.

A literal rather than `roleSchema`: the request that exists is *promote this JHSC member*, and a
free role field would be a general "change the role" the specs do not grant. The value is spelled
out rather than being a boolean so that reading the request says what it does.

The audit entry needs no work: `hs_account_changed_audit` has written a `user.role_changed` branch
since `0005`, comparing `OLD.role` with `NEW.role`, and `role` is already in the column-by-column
`GRANT UPDATE` of `0005` §11. The promotion is an `UPDATE` the engine already knows how to record.

*Alternative considered:* `POST /accounts/:id/promotion` as its own resource. Rejected: it would be
the only account operation outside `PATCH`, and the guard, the scope check and the audit actor would
be duplicated for one field.

**The refusal is in the service, not in the engine.** `role` is grantable to `hs_app`, so the
database cannot tell a promotion by management from one by a coordinator. This is the same class of
tension `withSessionScope` already declares for the auditor read entry: stated here rather than
implied, and the reason the endpoint checks `session.role === 'management'` explicitly instead of
reusing `isAdministrator`.

### The first escalation level is a role, so the level values become role values

`ESCALATION_LEVELS` was `['supervisor', 'management']` — level names that happened to equal role
names, with `ESCALATION_RECIPIENT_ROLE` mapping each to itself. Retargeting the first step to the
coordinator keeps that shape: `['hs_coordinator', 'management']`, and the mapping stays the
identity. `corrective_action_escalation.level` then stores a role value, which is what it always
stored.

The notification kind is named `corrective_action_overdue_coordinator` and not
`..._hs_coordinator`, because the kinds read as English in a notification list and the existing pair
is `..._supervisor` / `..._management`.

*Alternative considered:* keeping `level` as an abstract `first`/`final` with a separate recipient
map. Rejected because `NOTIFICATION_KIND` in `escalation.service.ts` already argues the opposite —
two kinds and not one with a `level` field, so that inboxes differ by recipient rather than by
content. An abstract level would put the recipient back inside the payload.

### The auditor is removed root and branch, in one migration

Dropping the three columns is what makes the `app_user_auditor_lifecycle` `CHECK`, the
`records_from`/`records_to` plumbing in `SessionScope`, `session.service.ts` and `auth.ts`, and the
`ReadDescriptor` parameter of `withSessionScope` all unreachable at the type level. Leaving the
columns and removing only the role would have left the compiler with nothing to say and every one of
those paths still live but unreachable at runtime — the failure mode ADR-015 named when it retired
`finding_recurrence` rather than orphaning it.

`hs_apply_record_window`, `hs_record_window_from` and `hs_record_window_to` from `0006` are dropped
together with the policy they created over `audit_log`. It is the only table the window was applied
to.

The read-logging exception disappears with them. It was the system's only exception to not logging
reads and it existed for a role no account carried, so nothing else in the audit chain changes.

*Alternative considered:* keeping the columns dormant against a v2 auditor. Rejected by the user's
decision, and the shape of the return supports it: a bounded read-only account would come back with
its own requirement, and `0005` chose a `CHECK` over an enum precisely so the set can move again.

### The migration refuses rather than converts

`0046` opens with a guard that raises if `app_user` holds a `supervisor` or `external_auditor` row,
if `corrective_action_escalation` holds a `supervisor` level, or if `notification` holds a
`corrective_action_overdue_supervisor` row. The development database holds none of the three — 1
`hs_coordinator` and 3 `jhsc_member` accounts, no escalation and no notification of that kind.

Converting instead of refusing would mean deciding, inside a migration, what a supervisor's account
becomes. That decision belongs to a person looking at the account, not to DDL, and the whole change
rests on the preproduction precondition that ADR-013, ADR-014 and ADR-015 already established for
destructive migrations.

### The JHSC seat opens to management, and the seat check stays the guarantee

The `CHECK` of `0035` becomes `role IN ('hs_coordinator', 'management')`. `0035` argues that the
check — not the service — is what stops the seat becoming a quiet second door to being inspectable;
that argument is unchanged, the door is simply two roles wide now. `jhsc_member` still cannot carry
a seat, for the reason `0035` gives: that role already *is* the seat.

The consequence reaches `inspections`: the eligibility predicate for `inspector_id` and the listing
that feeds it both admit an administrative account with a non-null `jhsc_seat_granted_at`. The specs
require those two to use the same predicate, so this is one change in one place.

## Risks / Trade-offs

**A reader of a main spec sees "only an HS coordinator" and misses the governing requirement** →
The equivalence requirement is in `identity`, the capability that owns the role set, and each
capability whose text says "only" now names the administrative pair explicitly where the phrase is
normative. What is left implicit is only the scenario prose.

**Management is powerful and its only check is the site scope** → It always was: the incident
visibility policy of `0012` has treated `management` as an account that sees everything since it was
written. What is new is write access, and it is bounded the same way the coordinator's is — by
`user_site_scope` resolved per request and by RLS, never by the token.

**The coordinator now receives an escalation for an action they own** → Deliberate and stated in the
spec. A single-coordinator site would otherwise get no first-level notice at all, and an escalation
reports a deadline, not fault.

**The verifier exception stays coordinator-only, which makes the two roles unequal in one place** →
Recorded as an exception in `actions` with its reason: the exception exists because a site can hold
one coordinator whose work would otherwise stall, and a management account is by construction a
second account that can verify it. If it were extended, `0042`'s guard would let a manager close
their own work with no second pair of eyes.

**Dropping columns is irreversible** → It is DDL by the owner on a database that holds no
regulatory evidence, under the same preproduction precondition as ADR-013/014/015. Rollback is
restoring the database, not a down migration; the repository has no down migrations by design.

**The eligibility predicate now has two callers that must not drift** → Already a stated requirement
in `inspections`: the listing and the validation use the same predicate, and the spec tests that
every account the list offers is one an assignment accepts.

## Migration Plan

1. ADR-022 first, so the migration and the code can cite it.
2. `0046_reduce_roles_to_three.sql`, in one transaction: the guard that aborts on a withdrawn role
   or level; the narrowed `app_user_role_check`; the dropped `app_user_auditor_lifecycle` and the
   three auditor columns, with the `GRANT UPDATE` re-issued without them; the dropped `audit_log`
   record-window policy and the three functions of `0006` behind it; the dropped
   `hs_auditor_read_event`; the widened `app_user_jhsc_seat_check`; the narrowed
   `corrective_action_escalation_level_check`; and the replaced `notification_kind_check`.
3. Contracts, then API, then web — the build order the repository already requires.
4. Rollback is a database restore. Deploying the API build before the migration would leave
   `hs_auditor_read_event` called by a code path no session can reach, which is harmless; deploying
   the migration first is still the intended order.
