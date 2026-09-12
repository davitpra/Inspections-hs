## 1. Domain Decision And Persistence

- [x] 1.1 Add ADR-022 recording the retirement of `supervisor` and `external_auditor`, the
      redefinition of `management` as the second administrative role with the promotion as its own
      power, and which parts of ADR-011 it leaves without effect (the auditor lifecycle and the
      read-logging exception); state the preproduction precondition the way ADR-013/014/015 state theirs.
- [x] 1.2 Write `apps/api/drizzle/0046_reduce_roles_to_three.sql` as one handwritten migration,
      opening with the guard that raises if any `app_user` row carries `supervisor` or
      `external_auditor`, if any `corrective_action_escalation` row carries `level` `supervisor`, or if
      any `notification` row carries `corrective_action_overdue_supervisor` — the migration refuses, it
      does not convert.
- [x] 1.3 In `0046`, narrow `app_user_role_check` to `('hs_coordinator', 'jhsc_member',
'management')`, stating that no site isolation policy applies to `app_user` (`0005` §10) and that
      `hs_identity_guard` is untouched.
- [x] 1.4 In `0046`, drop `app_user_auditor_lifecycle` and the columns `expires_at`, `records_from`
      and `records_to`, and re-issue the column-by-column `GRANT UPDATE` of `0005` §11 without them,
      leaving every other granted column exactly as it was.
- [x] 1.5 In `0046`, drop the `audit_log` record-window policy created by
      `hs_apply_record_window('audit_log', 'occurred_at')` together with the three functions of `0006`
      behind it — `hs_apply_record_window`, `hs_record_window_from`, `hs_record_window_to` — and drop
      `hs_auditor_read_event`; state that `audit_log` keeps its site isolation, its immutability and
      every existing entry, auditor reads included.
- [x] 1.6 In `0046`, widen `app_user_jhsc_seat_check` to `role IN ('hs_coordinator', 'management')`,
      keeping `jhsc_member` excluded for the reason `0035` gives.
- [x] 1.7 In `0046`, narrow `corrective_action_escalation_level_check` to
  `('hs_coordinator', 'management')` and replace `notification_kind_check` with the set that carries
  `corrective_action_overdue_coordinator` in place of `corrective_action_overdue_supervisor`;
  declare that `corrective_action_escalation` remains immutable (`hs_make_immutable`), that
  `notification` retains only its guarded monotonic updates to `read_at` and `withdrawn_at`, and that
  this is owner DDL that writes, updates and deletes no row.
- [x] 1.8 Update `apps/api/src/db/schema/identity.ts` so its mirrored `app_user_role_check` and the
      role union match `0046`, and remove the three auditor columns from the table definition.
- [x] 1.9 Update the escalation and notification schema definitions in `apps/api/src/db/schema/` to
      the new level and kind sets.

## 2. Contracts

- [x] 2.1 Reduce `ROLES` and `ROLE_LABELS` in `packages/contracts/src/identity.ts` to the three
      roles, keeping the vocabulary note that `inspector` is not a role.
- [x] 2.2 Remove the external-auditor lifecycle from `createAccountRequest` — `expires_in_days`,
      `records_from`, `records_to` and the two refinements that guard them — and from the account and
      session shapes in `identity.ts` and `auth.ts`.
- [x] 2.3 Add `promote_to: z.literal('hs_coordinator').optional()` to `updateAccountRequestSchema`,
      with the comment explaining why it is a literal and not `roleSchema`.
- [x] 2.4 Retarget the escalation in `packages/contracts/src/actions.ts`: `ESCALATION_LEVELS` to
      `['hs_coordinator', 'management']`, `ESCALATION_DAYS` to 3 and 7 against those keys, and
      `ESCALATION_RECIPIENT_ROLE` accordingly; keep `escalationLevelsDue` pure and clock-free as the
      lint rule requires.
- [x] 2.5 Replace `corrective_action_overdue_supervisor` with `corrective_action_overdue_coordinator`
      in `packages/contracts/src/notifications.ts`, in both the kind list and the discriminated payload.
- [x] 2.6 Drop `supervisor` from the two action transition role lists in `actions.ts` and from the
      `reported` transition in `incidents.ts`.
- [x] 2.7 Export `isAdministrator(role)` from contracts as the one predicate that answers whether a
      role is `hs_coordinator` or `management`, so the API and the web read the same rule.

## 3. API Authorization

- [x] 3.1 Replace every `session.role !== 'hs_coordinator'` refusal with `!isAdministrator(...)` in
      `templates`, `roster`, `catalog/sites`, `catalog/locations`, `auth` and `incidents`, leaving each
      module's own error code and message untouched.
- [x] 3.2 Widen `CAN_REPORT` in `apps/api/src/findings/findings.service.ts` to the two
      administrative roles.
- [x] 3.3 Leave creating and advancing a corrective action naming `hs_coordinator` specifically in
      `actions.service.ts`, and add the comment saying it is a declared exception to the equivalence and
      why (ADR-017: a relation to the record, not a role).
- [x] 3.4 Leave the verifier exception of `0042` coordinator-only and record in
      `account.errors.ts` or alongside the guard why it does not extend to `management`.

## 4. Promotion

- [x] 4.1 Implement the promotion in `apps/api/src/auth/account.service.ts`: refuse unless the
      session role is exactly `management`, refuse a target that is not an active `jhsc_member`, refuse
      a target outside the session's site scope, refuse the session's own account, and perform the
      `UPDATE` through the administrator path so the audit actor is declared.
- [x] 4.2 Add the refusal codes and messages in `apps/api/src/auth/account.errors.ts`, naming the
      target's current role when that is the cause.
- [x] 4.3 Confirm by integration test that `hs_account_changed_audit` writes the
      `user.role_changed` entry with both roles into the chain of every site in the promoted account's
      scope, without the endpoint writing it.

## 5. Removing The External Auditor From The API

- [x] 5.1 Remove the auditor branch of `withSessionScope` in `apps/api/src/db/site-scope.ts`: the
      `isAuditor` test, the window settings, `recordAuditorRead`, the `ReadDescriptor` parameter and the
      `recordsFrom`/`recordsTo` fields of `SessionScope`; keep `withSiteScope`/`withSessionScope` split
      exactly as it is.
- [x] 5.2 Remove the record-window columns and the account-expiry check from
      `apps/api/src/auth/session.service.ts` and `account.repository.ts`, keeping session expiry and
      `deactivated_at` as the two things that end a session.
- [x] 5.3 Remove the auditor branches from `account.service.ts` and `account.errors.ts`, including
      the expiry computed at creation.
- [x] 5.4 Update every call site that passed a `ReadDescriptor` so the removal leaves no unused
      parameter behind.

## 6. Escalation

- [x] 6.1 Retarget `apps/api/src/actions/escalation.service.ts` to the new levels and recipient
      roles, keeping the per-level `ON CONFLICT DO NOTHING` that makes each level emit once.
- [x] 6.2 Update `NOTIFICATION_KIND` to the new pair and confirm the job still writes one row per
      level per action.
- [x] 6.3 Confirm the coordinator who created or owns the action still receives the first-level
      notification, as the spec requires.

## 7. Web

- [x] 7.1 Point the eight predicates of `apps/web/src/permissions/session.ts` at a shared
      `canAdminister(account)` built on `isAdministrator`, keeping the eight names and the
      one-decision-per-function shape the file argues for.
- [x] 7.2 Update `apps/web/src/permissions/session.test.ts` and the per-predicate tests so
      `management` is admitted and `jhsc_member` is still refused.
- [x] 7.3 Add the promotion to `RosterRoute`: a control on the row of an active `jhsc_member`
      account, offered only when `canPromote(account)` holds, with its confirmation and its own
      dialog file alongside `JhscSeatDialog.tsx`.
- [x] 7.4 Add `promoteToCoordinator` to `apps/web/src/api/roster.ts` as a `PATCH /accounts/:id`
      carrying `promote_to`, next to the existing seat and deactivation calls.
- [x] 7.5 Update `RosterRoute/presentation.ts` so the Role cell reads the promoted account
      correctly, and extend `presentation.test.ts` for the three surviving roles.
- [x] 7.6 Remove the auditor from the web's account shapes wherever the contract change surfaces it.

## 8. Fixtures, Seeds And Tests

- [x] 8.1 Update every unit and integration test that constructs a `supervisor` or
      `external_auditor` session so it uses a surviving role, and delete the tests whose only subject
      was the auditor window or the auditor read entry.
- [x] 8.2 Update `apps/api/src/actions/escalation.spec.ts`, which asserts
      `ESCALATION_LEVELS` equals `['supervisor', 'management']`, and the audit integration tests that
      assert the escalation levels and kinds.
- [x] 8.3 Add the integration tests for the promotion: accepted for `management`, refused for
      `hs_coordinator` and `jhsc_member`, refused for a non-member, an inactive account, an account out
      of scope and the caller's own account, each asserting `app_user.role` is unchanged on refusal.
- [x] 8.4 Add the integration test that a `management` account holding a JHSC seat is accepted as
      `inspector_id` and appears in the eligible-accounts listing, and that one without a seat is
      refused and absent.
- [x] 8.5 Add the migration test that `0046` aborts when a withdrawn role, level or notification
      kind is present.
- [x] 8.6 Update `apps/api/scripts/demo-data.mjs` and any seed or fixture naming a withdrawn role.

## 9. Documentation

- [x] 9.1 Update the §4 role table of `docs/Requisitos_V1.2.md` to the three roles, fold what the
      supervisor row said into `management`, and mark risk I of §5 as withdrawn by ADR-022.
- [x] 9.2 Note in `docs/adr/README.md` that ADR-022 supersedes the auditor part of ADR-011.
- [x] 9.3 Update `CLAUDE.md` where it describes the permissions directory if the shared predicate
      changes what that section says.
