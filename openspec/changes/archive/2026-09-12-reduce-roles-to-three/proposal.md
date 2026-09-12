## Why

`Requisitos_V1.2.md` §4 names five roles and the schema has enforced all five since `0005`. Two of
them were never reachable. The only account-creation path the product exposes is the roster's invite
dialog, which posts `role: 'jhsc_member'` as a literal; no screen, command or seed ever produces a
`supervisor` or an `external_auditor`, and the development database holds none. Their existence is
not free: three columns and a lifecycle `CHECK` on `app_user`, a record-window RLS policy over
`audit_log`, the system's only read-logging exception, and a two-step escalation whose first
recipient no account can ever be.

At the same time the organization needs something the five-role table does not give it: a second
account that can administer the platform and appoint a coordinator, so that promoting a JHSC member
does not require the developer and a `UPDATE`. `management` is already the role §4 places above the
coordinator ("Lectura completa + dashboards. Recibe escalamientos"), and the incident visibility
policy of `0012` already treats it as an account that sees everything.

This closes no stage of §7. It is a preproduction retirement and redefinition spanning the identity
of stage 2, the escalations of stage 5 and the incident reporting of stage 6, of the same class as
ADR-013, ADR-014 and ADR-015: the surface is removed before any deployment carries regulatory
evidence, and the reduced role table is the one stages 7 and 8 will build on.

## What Changes

- **BREAKING** The role set shrinks from five to three: `hs_coordinator`, `jhsc_member`,
  `management`. `supervisor` and `external_auditor` are removed from the contract, the Drizzle
  schema and the `app_user` role `CHECK`. The migration refuses to run if any row carries one.
- **BREAKING** `management` gains every administrative permission of `hs_coordinator` — roster,
  accounts and invitations, templates, catalog and locations, scheduling, incident closure — and one
  the coordinator does not have: promoting a `jhsc_member` account to `hs_coordinator`.
- **BREAKING** The escalation of an overdue action retargets its first step. `ESCALATION_LEVELS`
  becomes `['hs_coordinator', 'management']`: three days overdue reaches the coordinator, seven
  reaches management. The notification kind `corrective_action_overdue_supervisor` is replaced by
  `corrective_action_overdue_coordinator` in the `CHECK` that `0011` wrote and `0012` restated.
- **BREAKING** The external-auditor lifecycle is removed root and branch: the columns `expires_at`,
  `records_from` and `records_to`, the `app_user_auditor_lifecycle` `CHECK`, the
  `hs_apply_record_window` policy over `audit_log` with its two settings readers, the
  `hs_auditor_read_event` function, and the auditor branch of `withSessionScope`. Risk I of §5 and
  the read-logging exception it justified cease to exist.
- A `management` account may hold a JHSC seat: the `CHECK` added by `0035` widens to
  `role IN ('hs_coordinator', 'management')`, so a manager who sits on the committee is eligible as
  `inspector_id` on the same terms as a coordinator who does.
- Reporting a finding by hand and reporting an incident in the third person become
  `hs_coordinator` and `management` only.
- Existing `audit_log` entries naming a removed role or an auditor read are left untouched. They
  describe past facts, not a live capability.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: the role set has three values; `management` holds the administrative permissions of
  `hs_coordinator`; a new promotion of a `jhsc_member` account to `hs_coordinator`, reserved to
  `management`; the external-auditor account lifecycle disappears; the JHSC seat admits `management`.
- `actions`: the first escalation step reaches the coordinator instead of the supervisor, with its
  own notification kind; the roles admitted on the completion and verification transitions, and on
  creating an action, lose `supervisor`.
- `incidents`: an incident is reported in the third person by an `hs_coordinator` or a `management`
  account.
- `findings`: a finding raised by hand is reported by an `hs_coordinator` or a `management` account.
- `catalog`: registering, renaming and deactivating a site, and administering locations, admit
  `management`.
- `templates`: authoring, saving, publishing, revising and reading a draft admit `management`.
- `audit`: the requirement that an external auditor's reads are recorded is withdrawn; the account
  role-change entry now covers the promotion.
- `inspections`: eligibility as `inspector_id` extends to a `management` account holding a JHSC
  seat; the coordinator-only scheduling operations admit `management`.
- `immutability`: the incident visibility policy keeps its shape while the role it was written
  against disappears; what remains restricted is the `jhsc_member` account.

## Impact

**Schema (destructive, preproduction only).** A new migration `0046` after
`0045_advance_scheduled_inspection_visibility.sql`: it narrows the `app_user` role `CHECK`, drops the
three auditor columns and their lifecycle `CHECK` together with the `GRANT UPDATE` naming them,
drops the `audit_log` record-window policy and the three functions of `0006` that serve it, widens
the JHSC seat `CHECK` of `0035`, and rewrites the notification-kind `CHECK`. It converts no row and
aborts if a `supervisor` or `external_auditor` account exists.

**ADR.** ADR-022 records the retirement and the redefinition, and states which parts of ADR-011 —
the external-auditor lifecycle and the read-logging exception — it leaves without effect. ADR-011
continues to govern authentication, invitations and sessions.

**Contracts.** `identity.ts` (`ROLES`, `ROLE_LABELS`, the auditor lifecycle of
`createAccountRequest`), `actions.ts` (`ESCALATION_LEVELS`, `ESCALATION_DAYS`,
`ESCALATION_RECIPIENT_ROLE`, two transition role lists), `incidents.ts` (the `reported` transition),
`notifications.ts` (the escalation kinds), `auth.ts` (the session record window).

**API.** `db/site-scope.ts` loses the auditor branch and the `ReadDescriptor` it exists for;
`auth/account.service.ts` and `account.errors.ts` lose the auditor branches and gain the promotion;
`findings.service.ts` `CAN_REPORT`; `actions/escalation.service.ts` and its notification kinds; and
every `session.role !== 'hs_coordinator'` refusal in `templates`, `roster`, `catalog/sites`,
`catalog/locations`, `auth` and `incidents`, which becomes a shared predicate admitting both
administrative roles.

**Web.** The eight predicates of `src/permissions/session.ts` admit `management`; the promotion needs
a control in `RosterRoute`; `ROLE_LABELS` shrinks with the contract.
