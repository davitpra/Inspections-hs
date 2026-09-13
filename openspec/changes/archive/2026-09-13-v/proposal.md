## Why

The two non-management roles carry names nobody at the sites uses. `hs_coordinator` shows up as
"H&S coordinator" and `jhsc_member` as "JHSC member". On the floor and in the organization these
are **the coordinator** and **the inspectors**. With `reduce-roles-to-three` there are only three
roles left, and `jhsc-membership-by-role` makes committee membership follow the role for all three.
So the prefix `hs_` no longer tells two coordinators apart, and "JHSC member" no longer tells one
role apart from the others: `hs_coordinator` and `management` sit on the committee too.

The vocabulary note of `Requisitos_V1.2.md` §4 asked for one term used in tables, endpoints and UI,
and recommended `jhsc_member` because "inspector" was free to name the account assigned to an
inspection. ADR-022 wrote down the consequence: "`inspector` continúa siendo un campo, no un rol".
This change takes the other branch of that choice. `inspector` becomes the role, and the assigned
account keeps its `inspector_id` column but is no longer labelled "Inspector" on screen, so a
coordinator assigned to a period does not appear under the name of a role they do not hold.

This closes no stage of §7. It is a preproduction correction of the identity of stage 2, of the same
class as ADR-022 and ADR-023. The identifiers change now, before any deployment carries regulatory
evidence that names them.

## What Changes

- **BREAKING** `app_user.role` is restricted to `coordinator`, `inspector` and `management`. The
  values `hs_coordinator` and `jhsc_member` are no longer accepted. Existing accounts are converted
  in place, and each conversion is audited as a role change in every site of the account's scope.
- **BREAKING** The same identifiers change in the shared contracts (`ROLES`, `roleSchema`,
  `isAdministrator`), in every request and response that carries a role, in the
  `app.role` connection setting read by the incident visibility policy, in the database function
  that allows the coordinator to verify their own work, and in the account-creation and
  roster-import commands (`--role inspector`).
- **BREAKING** Account promotion and demotion name the new roles: `promote_to: coordinator`, and a
  demotion to `inspector`. Refusal messages read "Only management can promote an account to
  coordinator" and similar.
- The roles are labelled **Coordinator**, **Inspector** and **Management**. Every user-facing text
  that says "H&S coordinator", "HS coordinator" or "JHSC member" says "coordinator" or "inspector"
  instead.
- The account assigned to an inspection is labelled **Assigned to** wherever the scheduling console
  and the period dialog show or select it. The column `inspection.inspector_id`, the candidate
  endpoint and the eligibility rule are unchanged.
- The escalation level `hs_coordinator` of `corrective_action_escalation` becomes `coordinator` for
  new escalations. Rows already written keep their value, because the table is immutable. The
  notification kind `corrective_action_overdue_coordinator` keeps its name.
- `audit_log` entries that already name `hs_coordinator` or `jhsc_member` are left untouched and stay
  readable.
- ADR-024 records the decision and supersedes the ADR-022 sentence about `inspector` and the §4
  vocabulary note. Committee membership still follows the role (ADR-023): renaming `jhsc_member`
  does not take any account off the committee.

No permission changes. Every act allowed or refused to a role before this change is allowed or
refused to its renamed counterpart after it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: the closed set of roles, the equivalence of administrative authority, promotion and
  demotion, invitation and withdrawal of access, account creation, roster import and the role labels
  shown on screen all name `coordinator` and `inspector`.
- `catalog`: site and location administration names the coordinator instead of the H&S coordinator.
- `templates`: template authoring and publication name the coordinator.
- `inspections`: scheduling, assignment, the early-opening job and completed-inspection reading name
  the coordinator and the inspector role, and the assigned account is labelled "Assigned to".
- `findings`: who opens and advances a corrective action from a finding names the coordinator and
  the inspector role.
- `actions`: the coordinator verifier exception, who creates, executes and verifies, and the first
  escalation level name `coordinator`.
- `incidents`: incident visibility and the notification on report name the coordinator.
- `audit`: account changes, escalations and the other audited acts that name a role use the new
  identifiers, and historical entries with the old ones stay readable.
- `immutability`: the incident visibility restriction names `coordinator`.

## Impact

**Schema.** A new migration `0048_rename_roles.sql` after `0047_jhsc_membership_by_role.sql`. It
converts `app_user.role`, replaces `app_user_role_check`, recreates the `incident_visibility`
policy, replaces the functions that still compare against `'hs_coordinator'`, and widens
`corrective_action_escalation_level_check` so historical rows stay valid. It grants no new `UPDATE`
or `DELETE`, and it keeps RLS and `FORCE ROW LEVEL SECURITY` exactly as they are.

**Contracts.** `packages/contracts/src/identity.ts`: `ROLES`, `isAdministrator`, `ROLE_LABELS`, and
any schema that names a role literal (promotion, account creation).

**API.** Role comparisons and refusal messages in `actions`, `incidents`, `auth` (account, session,
controller), `roster`, `templates`, `catalog` and `inspections`, together with the escalation tables
of `actions/escalation.service.ts` and the Drizzle mirrors in `db/schema/identity.ts` and
`db/schema/actions.ts`.

**Web.** `permissions/session.ts`, the People & Access route (promote and demote dialogs, role
labels), the "Only H&S coordinators and management…" notices, `IncidentRoute`,
`AcceptInvitationRoute`, and the "Inspector" labels of the scheduling console and the period dialog.

**Scripts and seeds.** `create-account.mjs`, `roster-import.mjs`, `demo-data.mjs`,
`demo-content.mjs`, `bootstrap-invitation.mjs` comments, and `seeds/004_bootstrap_coordinator.sql`.

**Docs.** ADR-024; `Requisitos_V1.2.md` §4 vocabulary note; README and CLAUDE.md where they name the
roles.
