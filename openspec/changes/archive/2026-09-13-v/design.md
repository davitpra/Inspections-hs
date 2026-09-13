## Context

See `proposal.md` for why. The current state that shapes the approach:

- The closed role set lives in three places that must agree: the `app_user_role_check` CHECK
  (last written by `0046_reduce_roles_to_three.sql`), `ROLES` in `packages/contracts/src/identity.ts`,
  and its mirror in `apps/api/src/db/schema/identity.ts`. `ROLE_LABELS` is a `Record<Role, string>`,
  so the compiler finds every label that is missing.
- Three database objects still compare against a role literal:
  - the `incident_visibility` policy (`0012_incidents.sql`), which reads `app.role`;
  - `hs_action_verifier_guard()` (`0042_coordinator_verifier_exception.sql`), with
    `actor_role = 'hs_coordinator'`. 0043 and 0044 replaced `hs_corrective_action_guard()` and did
    not touch this function;
  - `corrective_action_escalation_level_check` (`0046`), with `UNIQUE (action_id, level)` from
    `0011`.
- `app_user` has no RLS and keeps `GRANT UPDATE (email, role, deactivated_at)` to `hs_app` (0047).
  Any change to `role` fires `hs_account_changed_audit()`, which writes `user.role_changed` into the
  chain of every site in the account's scope.
- `corrective_action_escalation` is immutable (`hs_make_immutable`, ADR-002) and uses FORCE RLS.
  `audit_log` is immutable and hash-chained.
- The session resolves `role` from `app_user` on every request (`auth/session.service.ts`) and sets
  it as `app.role` (`db/site-scope.ts`). No token carries a role.
- The local database holds real accounts (not only demo data), so the migration cannot assume an
  empty table.

## Goals / Non-Goals

**Goals:**
- One identifier and one label per role, the same in the database, contracts, API, web and scripts.
- Existing accounts keep working with no new invitation, no lost session and no scope change.
- Immutable history (audit chain, emitted escalations) stays exactly as it was written.

**Non-Goals:**
- No change to what any role is allowed to do (ADR-022, ADR-023).
- No rename of `inspection.inspector_id`, `listInspectorCandidates`, `inspector-eligibility.ts`, the
  `/inspectors` candidate endpoint, or the notification kind `corrective_action_overdue_coordinator`.
  They already name a field, an assignment or a level, not a role.
- No rename of the TypeScript helpers that already say "coordinator" (`requireCoordinator`,
  `promoteToCoordinator`, `COORDINATOR_ID`). They are correct as they are.
- No rewrite of existing `audit_log` payloads or of old migrations.

## Decisions

### D1. ADR-024 supersedes only the vocabulary, not ADR-022

A new `docs/adr/024-renombre-de-roles.md` records that the roles are `coordinator`, `inspector` and
`management`, and that "Assigned to" is the on-screen name of `inspector_id`. It supersedes, in
ADR-022, only the consequence "`inspector` continúa siendo un campo, no un rol", and in
`Requisitos_V1.2.md` §4 the recommendation of the vocabulary note. The rest of ADR-022 (three roles,
the shared administrative authority, the escalation to management at seven days) and all of ADR-023
still apply and are cited, not rewritten. The §4 note gets a short line that points to ADR-024, and
its original reasoning stays in place.

*Alternative:* edit ADR-022 in place. Rejected, because ADRs are cited by number and never rewritten
(CLAUDE.md).

### D2. The migration converts accounts; it does not refuse them

`0048_rename_roles.sql`, written by hand, in this order:

1. `ALTER TABLE app_user DROP CONSTRAINT app_user_role_check`.
2. A `DO` block that first declares every site as the transaction's scope,
   `set_config('app.site_ids', (SELECT string_agg(id::text, ',') FROM site), true)`, and then runs
   `UPDATE app_user SET role = CASE role WHEN 'hs_coordinator' THEN 'coordinator' WHEN 'jhsc_member'
   THEN 'inspector' END WHERE role IN ('hs_coordinator','jhsc_member')`. The scope has to be
   declared because `hs_account_audit_fanout` raises `HS002` for any site of the account outside
   `hs_declared_sites()`, and because `audit_log` has FORCE RLS, whose `WITH CHECK` reads the same
   `app.site_ids`. `app.user_id` stays empty, so the entries carry `actor_user_id` null: the author
   is the migration, not an account. `app.site_ids` is set only for the length of that transaction.
3. A guard `DO` block that raises if any role outside `('coordinator','inspector','management')`
   remains.
4. `ADD CONSTRAINT app_user_role_check CHECK (role IN ('coordinator','inspector','management'))`.
5. `DROP POLICY incident_visibility ON incident` + `CREATE POLICY` with the same `AS RESTRICTIVE FOR
   ALL` shape and `('coordinator','management')` in both `USING` and `WITH CHECK`.
6. `CREATE OR REPLACE FUNCTION hs_action_verifier_guard()` with the 0042 body and
   `actor_role = 'coordinator'`. The `HINT` text says "the coordinator".
7. The escalation CHECK (D3).

Converting the rows fires `hs_account_changed_audit()` once per account, so one `user.role_changed`
entry lands in each site of that account's scope. That is intended: the identifier really did
change, and the chain should say so (`specs/audit`).

*Alternative:* refuse when old roles are present, like 0046 did. Rejected, because 0046 was removing
roles nobody held, and this change renames roles every account holds.

The migration adds no `GRANT`, no `REVOKE` and no new mutability. RLS and FORCE RLS on every table
stay as they are. The `REVOKE`/RLS task rule is met by leaving the 0047 privileges untouched, and the
migration int-spec checks that.

### D3. Emitted escalations keep `hs_coordinator` (touches an immutable table)

**This change touches the immutable table `corrective_action_escalation`, but only its CHECK (DDL),
never its rows.** Rows already carrying `level = 'hs_coordinator'` cannot be updated without
disabling `hs_forbid_mutation`, and that would break ADR-002. So:

- The CHECK becomes `level IN ('coordinator', 'management', 'hs_coordinator')`. A second
  constraint, or a `BEFORE INSERT` check in `hs_make_immutable` style, refuses new
  `hs_coordinator` rows. The simplest form is a trigger function
  `hs_escalation_level_current()` that raises on `INSERT` when `NEW.level = 'hs_coordinator'`. A
  CHECK cannot tell a new row from a historical one, which is why a trigger is needed.
- `UNIQUE (action_id, level)` would let a `coordinator` row sit next to a historical
  `hs_coordinator` row. So the "not yet escalated" query in `escalation.service.ts`
  (`overdueWithoutEscalation`) looks for either value for the first level, through a
  `LEVEL_ALIASES` map in the same file.
- Readers that show or group escalations map `hs_coordinator` to the first level.

*Alternative A:* temporarily disable the immutability trigger to rewrite the rows. Rejected, because
of ADR-002.
*Alternative B:* keep `hs_coordinator` as the permanent level name, since it is a level and not a
role. Rejected, because the user wants the identifiers renamed and it would leave the retired name
live in code.
*Alternative C:* refuse to migrate when escalation rows exist. Rejected, because the local database
has demo escalations and real accounts.

### D4. "Inspector" in spec prose

From now on, specs write the role as `` `inspector` `` (backticks) or "an inspector account". Plain
prose such as "the inspector of an inspection" or "two inspectors each completed…" keeps naming the
assigned account, as `inspector_id` does, and the delta specs do not rewrite those sentences. The UI
does not rely on that nuance: it says "Assigned to" (`specs/inspections`).

### D5. Labels

`ROLE_LABELS = { coordinator: 'Coordinator', inspector: 'Inspector', management: 'Management' }`.
Inside sentences, roles are lowercase: "Promote Reid, Ada (10472) to coordinator", "Demote … to
inspector", "Only coordinators and management can write templates". API refusal messages follow the
same pattern ("Only the coordinator can …", "Only management can promote an account to
coordinator").

### D6. Contracts and scripts accept only the new values

`roleSchema` accepts only `coordinator | inspector | management`, with no compatibility alias. There
are no deployed clients, and ADR-001 has no offline role cache: the stored session is revalidated on
open and `role` comes from the server. `create-account.mjs --role` and `roster-import.mjs` use the new
values, and an old value fails with the usual "unknown role" message.

## Risks / Trade-offs

- [The retired name `hs_coordinator` survives in escalation rows and audit payloads] → It is limited
  to immutable history, and D3 isolates it in a single alias map plus a trigger that blocks new
  uses. The migration int-spec checks both.
- [The spec delta is large (~90 requirements modified by substitution), so a mistake could hide in
  it] → The substitution was mechanical and checked with `openspec validate --strict`. The only
  requirements with real behavior change are the closed role set (identity), the role labels
  (identity), the rename conversion and the historical entries (audit), historical escalation
  (actions), and "Assigned to" (inspections).
- [A stray literal in code still compares against `'hs_coordinator'` and silently denies] → The
  `Role` type makes such a comparison a TypeScript error (`no overlap`), and the apply ends with a
  `grep` that should find the old names only in historical migrations, the alias map and tests of
  historical data.
- [A developer's stale local Dexie session shows the old role until it is revalidated] → The session
  is revalidated on open. At worst the chip label is stale for one load, and no permission is
  decided from it.

## Migration Plan

1. `pnpm --filter api db:migrate` applies `0048`. Real accounts on localhost:5433 are converted in
   place, with no credential reset and no new invitation.
2. Deploy the API and the web together. There is no mixed-version window to support, because the
   system is in preproduction.
3. Rollback: a reverse migration is only needed before step 2. It would drop and re-add the CHECK
   and policy, `UPDATE` the roles back (adding one more pair of audited role changes), and restore
   the 0042 function body. Escalation rows written as `coordinator` in between would block restoring
   the old CHECK. In that case, stop and review, the same stance ADR-022 took.
