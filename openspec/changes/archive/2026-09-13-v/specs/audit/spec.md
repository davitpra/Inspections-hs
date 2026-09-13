## MODIFIED Requirements

### Requirement: Account and scope changes are audited in the chain of every site they reach

The system SHALL record an audit entry for the creation of an account, for a change of its `role`
or its `email`, for its deactivation and reactivation, and for every grant and revocation of a
site scope, written by the database in the same transaction as the change.
The promotion of an `inspector` to `coordinator` and the demotion of a `coordinator` to
`inspector` SHALL each be recorded as the role change it is, and SHALL be the only role changes
the system produces, apart from the single conversion of `hs_coordinator` to `coordinator` and of
`jhsc_member` to `inspector` that renames the roles. That conversion SHALL be recorded in the same
way, as a role change naming the retired identifier as the previous `role`.

Entries written before the roles were renamed, whose payload names `hs_coordinator` or
`jhsc_member`, SHALL remain in their chains unchanged and readable, and the chains SHALL continue to
verify.

Because an account is not itself a site-scoped record while every audit entry belongs to exactly
one site, an account event SHALL be written once into the chain of each site in the account's
effective scope, and a scope event SHALL be written into the chain of the site being granted or
revoked. "Who was given access to this workplace, and when" is part of that workplace's record.

#### Scenario: Creating an account with two sites writes an entry in each chain

- **WHEN** an account is created with an active scope of both sites
- **THEN** one `audit_log` entry identifying the account creation exists in the chain of
  `st-thomas` and one in the chain of `glencoe`
- **AND** both payloads carry the account identifier, the `person_id` and the `role`

#### Scenario: A promotion is recorded with both roles

- **WHEN** an account's `role` is changed from `inspector` to `coordinator`
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `role`

#### Scenario: A demotion is recorded with both roles

- **WHEN** an account's `role` is changed from `coordinator` to `inspector`
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `role`

#### Scenario: Renaming the roles is recorded as a role change

- **GIVEN** an account whose `role` is `jhsc_member`, scoped to `st-thomas`
- **WHEN** the roles are renamed
- **THEN** an entry exists in the chain of `st-thomas` whose `payload` carries `previous_role`
  `jhsc_member` and `role` `inspector`

#### Scenario: Entries naming the retired identifiers stay in the chain

- **GIVEN** a site whose chain contains an account creation entry whose `role` is `hs_coordinator`,
  written before the roles were renamed
- **WHEN** that chain is read
- **THEN** the entry is present and unchanged
- **AND** the chain verifies

#### Scenario: An email change is recorded with both values

- **WHEN** an account's `email` is updated
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `email`

#### Scenario: A scope grant is recorded in the site being granted

- **WHEN** an account is granted the site `glencoe`
- **THEN** an `audit_log` entry identifying the grant exists in the chain of `glencoe`
- **AND** no entry for that grant exists in the chain of `st-thomas`

#### Scenario: A scope revocation is recorded in the site being revoked

- **WHEN** `revoked_at` is set on an account's scope row for `glencoe`
- **THEN** an `audit_log` entry identifying the revocation exists in the chain of `glencoe`

#### Scenario: Deactivating an account is recorded in every site it reached

- **WHEN** `deactivated_at` is set on an account whose active scope is both sites
- **THEN** an entry identifying the deactivation exists in both chains

#### Scenario: An account with an empty scope writes no account entry

- **WHEN** an account is created with no active scope row
- **THEN** the creation succeeds
- **AND** no `audit_log` entry is written for it, because it reaches no workplace

### Requirement: A roster import is auditable as one operation per site

The system SHALL record, for each site whose roster an import touched, one audit entry naming the
import, the source file and the counts of rows read, applied and rejected for that site, in
addition to the per-person entries the import produces. The entry SHALL carry the
`actor_user_id` of the account that ran the import.

#### Scenario: An import touching both sites writes one summary entry per site

- **WHEN** an import applies rows for people of both `st-thomas` and `glencoe`
- **THEN** one import summary entry exists in each site's chain
- **AND** each carries the source file name and the counts for that site

#### Scenario: An import touching one site writes one summary entry

- **WHEN** an import applies rows for people of `st-thomas` only
- **THEN** exactly one import summary entry exists, in the chain of `st-thomas`

#### Scenario: The summary entry names the acting account

- **WHEN** an import is run by a `coordinator` account
- **THEN** every entry it produced carries that account's identifier as `actor_user_id`

### Requirement: Authentication events are recorded in the chain

The system SHALL record an audit entry for every invitation issued, revoked or accepted, every
credential created or revoked, every sign-in, every sign-out and every session revocation. The entry SHALL carry an `event_type` naming the event, the
`actor_user_id` of the account the event is about, and a `payload` describing it.

Each of these events SHALL be recorded in the chain of every site in the account's effective
scope, by the same rule that already governs account and scope changes: an account is not a fact
of one workplace, and an event about it has to be visible from either chain.

Entries already recorded for events this system no longer produces SHALL remain readable and
SHALL remain part of the chain. Removing the ability to produce an event SHALL NOT remove the
record that it once occurred.

#### Scenario: A sign-in is recorded in both chains of a two-site account

- **WHEN** an account whose active `user_site_scope` rows name both sites signs in
- **THEN** one `audit_log` entry naming the sign-in exists in the chain of `st-thomas`
- **AND** one exists in the chain of `glencoe`

#### Scenario: A sign-in is recorded once for a single-site account

- **WHEN** an account granted only `st-thomas` signs in
- **THEN** exactly one `audit_log` entry naming the sign-in exists, in the chain of `st-thomas`

#### Scenario: An invitation is recorded with who issued it

- **WHEN** a `coordinator` session issues an invitation for another account
- **THEN** an `audit_log` entry exists whose `payload` names the invited `user_id` and whose
  `actor_user_id` is the coordinator's account

#### Scenario: Accepting an invitation is recorded

- **WHEN** an invitation is accepted and a credential is created
- **THEN** an `audit_log` entry naming the credential creation exists for every site in the
  account's scope

#### Scenario: A sign-out and a revocation are recorded

- **WHEN** an account signs out, and a coordinator later revokes the sessions of a third account
- **THEN** an entry exists for each, naming the account whose session ended

#### Scenario: A rolled back sign-in leaves no entry

- **WHEN** a sign-in transaction is rolled back
- **THEN** no `audit_log` entry for that sign-in exists

#### Scenario: An entry for a withdrawn event type survives its removal

- **GIVEN** an `audit_log` entry recorded before the second factor was removed from the platform
- **WHEN** the chain of its site is read and verified
- **THEN** the entry is still present and the chain still verifies

### Requirement: Every classification and reclassification is recorded in the chain

The system SHALL append one `audit_log` entry of type `finding.classified` per
`finding_risk_assessment` row inserted. Its `payload` SHALL name `finding_id`,
`assessment_id`, `probability`, `severity`, the engine-computed `risk_level`, `control_level`,
`supersedes_id` and `reason`, so that the chain records what the risk was said to be, by whom and
why it changed.

#### Scenario: Classifying appends one entry

- **WHEN** the coordinator classifies a finding as `possible` × `moderate` with `control_level`
  `engineering`
- **THEN** one `finding.classified` entry is appended for that site
- **AND** its `payload` carries `risk_level` `medium` and `control_level` `engineering`
- **AND** its `supersedes_id` and `reason` are null

#### Scenario: Reclassifying appends a second entry that names the reason

- **GIVEN** a finding already classified
- **WHEN** the coordinator reclassifies it with a reason
- **THEN** a second `finding.classified` entry is appended
- **AND** its `payload` names the superseded assessment and the reason given
- **AND** the first entry is unchanged

#### Scenario: A rejected classification leaves no entry

- **WHEN** a classification is rejected because the account is not the coordinator
- **THEN** the site's chain is unchanged

### Requirement: The creation of a corrective action is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `action.created` for every
`corrective_action` row, written by a database trigger rather than by application code, in the
same transaction as the insert. Its `payload` SHALL name `action_id`, parent identifier and
`site_id`, and its `actor_user_id` SHALL identify the creator. The payload SHALL NOT include
provisional `assignee_person_id`, `description` or `due_at`, and replacing those fields before
closure SHALL NOT append audit entries.

#### Scenario: Creating an action appends one entry

- **WHEN** the coordinator creates a corrective action
- **THEN** one new `audit_log` entry of type `action.created` exists for that site
- **AND** its payload omits `assignee_person_id`, `description` and `due_at`

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** a `corrective_action` row is inserted directly, without going through the endpoint
- **THEN** the `action.created` entry is still appended
- **AND** the site's chain verifies as intact

### Requirement: Every escalation of an overdue action is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `action.escalated` for every
`corrective_action_escalation` row, naming `action_id`, `site_id`, `level`, `due_at` and the
number of days the action was overdue when it escalated. Its `actor_user_id` SHALL be null,
because the escalation is the scheduler's act and not a person's, and the entry SHALL still be
linked into the site's chain like any other.

#### Scenario: Escalating to the coordinator appends one entry

- **GIVEN** an action overdue by four days
- **WHEN** the escalation job runs
- **THEN** one `audit_log` entry of type `action.escalated` exists with `level` `coordinator`
- **AND** its `actor_user_id` is null

#### Scenario: Repeated runs append nothing further

- **GIVEN** an action already escalated to both levels
- **WHEN** the escalation job runs on each of the next ten days
- **THEN** no new `action.escalated` entry is appended
- **AND** the site's chain verifies as intact

#### Scenario: Both levels are distinguishable in the record

- **GIVEN** an action overdue by eight days that escalated to both levels
- **WHEN** its escalation entries are read
- **THEN** one carries `level` `coordinator` and the other `level` `management`
- **AND** each names the `due_at` it passed and how many days late it was

### Requirement: Advancing scheduled inspection visibility is audited

The system SHALL append one `inspection.visibility_advanced` entry when
`scheduled_inspection.visible_early` advances from `false` to `true`. The entry SHALL identify
the `scheduled_inspection_id`, `site_id`, `period_start`, `period_end`, `template_id`,
`template_version_id`, and the acting account resolved by the audit mechanism.

#### Scenario: Making a future period visible appends one audit entry

- **WHEN** a `coordinator` advances `visible_early` from `false` to `true`
- **THEN** exactly one `inspection.visibility_advanced` entry is appended for that
  `scheduled_inspection_id`
- **AND** its actor is the requesting account

#### Scenario: A rejected visibility request is not audited

- **WHEN** an early-visibility request is rejected without changing `visible_early`
- **THEN** no `inspection.visibility_advanced` entry is appended
