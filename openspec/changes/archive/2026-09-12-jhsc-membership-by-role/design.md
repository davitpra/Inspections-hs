## Context

See `proposal.md` — Why. What shapes the approach is where "sits on the JHSC" is actually written
down, and how few places that is:

- **One predicate, deliberately.** `apps/api/src/inspections/inspector-eligibility.ts` exists so that
  the candidate list (`listInspectorCandidates`) and the validation (`requireInspector`) cannot
  diverge — the failure it was written to prevent is a screen that offers an account the server then
  refuses. `ACCOUNT_SITS_ON_JHSC` is the disjunction that this change removes; the module survives it.
- **The `CHECK` is the guarantee, not the service.** `0035` restricted a non-null
  `jhsc_seat_granted_at` to `hs_coordinator` and `0046` widened it to include `management`. The
  column has never been writable except through that one grant, so dropping it cannot leave a value
  behind anywhere.
- **The seat has exactly one act.** `PATCH /accounts/:id { jhsc_seat }`, dispatched to `seat()` in
  `apps/api/src/auth/account.service.ts` before the `can_sign_in` guard, refused by
  `accountRoleWithoutJhscSeat`, and rendered by `RosterRoute/JhscSeatDialog.tsx`. There is no second
  writer — no seed, no command, no import.
- **Two projections read it**: `account.repository.ts` and `roster.repository.ts`, both reducing the
  timestamp to a boolean because the console asks *who is on the committee*, not *since when*.

ADR-002 (engine-enforced immutability), ADR-004 (RLS per site), ADR-008 (module boundaries) and
ADR-011 (authentication, invitations and sessions) all apply and are not rewritten here. ADR-023 is
added by this change to record why the seat existed, what supersedes it, and the consequence
declared below. ADR-022 is the change that gave `management` the coordinator's administrative
authority, and is what makes that consequence coherent rather than a widening.

**Immutable tables touched.** None by row write. `audit_log` is not modified at all: the entries of
type `user.jhsc_seat_granted` and `user.jhsc_seat_withdrawn` already in the chains stay exactly as
written, and their hash links keep verifying — a retired event type is still a readable one, and
there is no catalogue `CHECK` of event types to narrow.

`app_user` is partially mutable by design (`0005` §11 grants `UPDATE` column by column). Dropping one
of its columns removes it from that grant; `hs_identity_guard`, which freezes `id`, `person_id` and
`created_at` against every role, is untouched, and `app_user` continues to carry no RLS policy
because its isolation is `user_site_scope`, a different table.

## Goals / Non-Goals

**Goals:**

- Leave exactly one way to be on the committee, so there is no second path to disagree with the
  first at a role change.
- Remove the state rather than automate it: an auto-granted seat that cannot be withdrawn would be a
  column whose value is a function of another column in the same row.
- Keep the candidate list and the assignment validation sharing one predicate, which is the property
  `inspector-eligibility.ts` was created to hold.

**Non-Goals:**

- Modelling worker-rep versus management-rep seats, certification, or committee composition. §4 says
  the seven members are all certified worker reps; that is context, not a rule this system enforces,
  and nothing in the schema has ever represented it.
- Rewriting or retiring past audit entries about seats.
- Any change to who may *schedule, reassign or cancel* — that stays `hs_coordinator` and
  `management`. This change is about who may be *assigned*.

## Decisions

**D1 — Membership is derived from the role, not auto-granted into the column.** The alternative was
to keep `jhsc_seat_granted_at`, fill it on account creation and on promotion, and have the engine
refuse a null for an administrative role. It preserves the grant moment and the audit event, at the
cost of a column that every write must keep consistent with `role` and that no read can ever find in
a second state. The precedent is already in the repo and in `0035`'s own words: a `jhsc_member` does
not carry the column because *its role already is the seat*. Extending that sentence to the other two
roles is the whole change; adding a third rule to keep a derived column honest is not.

**D2 — `ACCOUNT_SITS_ON_JHSC` disappears rather than becoming a role list.** Once every role in the
closed set is on the committee, a predicate naming all three of them is a tautology written out
longhand — and, worse, a place a fourth role would have to be remembered. `isEligibleInspector`
becomes active-plus-scope, which is what it now means. The module keeps its reason for existing with
two conditions: the list and the validation still have to be the same question.

**D3 — `requireInspector` keeps its shape and loses one message.** It projects conditions separately,
rather than asking `isEligibleInspector` for a boolean, because each failed condition produces a
different actionable refusal; that is still true with two. What goes is the branch that split the
refusal between "holds no seat on the JHSC" and "Role X cannot be assigned an inspection" — neither
sentence has a referent now.

**D4 — The column is dropped, not deprecated.** Preproduction, no deployment carries regulatory
evidence, and `0046` is the standing precedent for dropping columns from `app_user` (it dropped
three). A retained column with no writer is a second definition of membership waiting to be read.

**D5 — The order inside the migration is forced by Postgres.** `hs_account_changed_audit()` is
rewritten in full *before* the `DROP COLUMN`, because the function body references
`NEW.jhsc_seat_granted_at` and the dependency is registered. `CREATE OR REPLACE` does not compose, so
all three surviving branches are restated — the same thing `0035` and `0046` each did in turn.

**D6 — `management` becomes assignable, and that is stated, not absorbed.** With membership derived
from the role, a `management` account is eligible as `inspector_id` with no prior act. This retires
the §4 rule that a manager cannot receive an inspection. It is a consequence of the choice made here
and of ADR-022 before it — management already holds the coordinator's administrative authority — and
it belongs in ADR-023 in those words, so that a reader who later asks "when did a manager become
assignable?" finds the answer rather than an omission.

## Risks / Trade-offs

**A regulator reading the audit chain finds seat events that stop, with no event retiring them.** →
ADR-023 is the record, and the chain is immutable by design: entries describe what happened at the
time they were written, and the absence of later ones is not a contradiction. Nothing is rewritten
to make the history look uniform.

**"Who is on the JHSC today" stops being separately visible in the roster.** → It is visible in the
same cell it always was, as the role, for every account. The `· JHSC seat` suffix existed to say
something the role could not; it now says something the role already says.

**Losing the grant moment for accounts that hold a seat today.** → The moment was never exposed by
any read — the roster and the account contract both reduced it to a boolean on purpose. Where it was
readable is the audit chain, and that is untouched.

**A future need for management accounts that are *not* on the committee.** → It would be a new
requirement with a real shape (composition, worker-rep ratios), not a restoration of this column. The
migration is destructive and preproduction-only; this is the point at which that is cheap.

## Migration Plan

1. `0047_jhsc_membership_by_role.sql`, after `0046`: rewrite `hs_account_changed_audit()` without the
   seat branch; drop `app_user_jhsc_seat_check`; `REVOKE UPDATE (email, role, deactivated_at,
   jhsc_seat_granted_at)`; `DROP COLUMN jhsc_seat_granted_at`; `GRANT UPDATE (email, role,
   deactivated_at)`. No row is converted and the migration cannot fail on data.
2. Contracts, then API, then web — the order the build imposes (`packages/contracts` compiles to
   `dist` before either app types).
3. Rollback is `git revert` plus a fresh `pnpm setup`: the development database is rebuilt from
   migrations, and there is no deployment holding evidence that a down-migration would have to
   preserve.
