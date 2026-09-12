## MODIFIED Requirements

### Requirement: Account and scope changes are audited in the chain of every site they reach

The system SHALL record an audit entry for the creation of an account, for a change of its `role`
or its `email`, for its deactivation and reactivation, and for every grant and revocation of a
site scope, written by the database in the same transaction as the change. The promotion of a
`jhsc_member` to `hs_coordinator` SHALL be recorded as the role change it is, and SHALL be the only
role change the system produces.

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

- **WHEN** an account's `role` is changed from `jhsc_member` to `hs_coordinator`
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `role`

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

### Requirement: Every escalation of an overdue action is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `action.escalated` for every
`corrective_action_escalation` row, naming `action_id`, `site_id`, `level`, `due_at` and the
number of days the action was overdue when it escalated. Its `actor_user_id` SHALL be null,
because the escalation is the scheduler's act and not a person's, and the entry SHALL still be
linked into the site's chain like any other.

#### Scenario: Escalating to the coordinator appends one entry

- **GIVEN** an action overdue by four days
- **WHEN** the escalation job runs
- **THEN** one `audit_log` entry of type `action.escalated` exists with `level` `hs_coordinator`
- **AND** its `actor_user_id` is null

#### Scenario: Repeated runs append nothing further

- **GIVEN** an action already escalated to both levels
- **WHEN** the escalation job runs on each of the next ten days
- **THEN** no new `action.escalated` entry is appended
- **AND** the site's chain verifies as intact

#### Scenario: Both levels are distinguishable in the record

- **GIVEN** an action overdue by eight days that escalated to both levels
- **WHEN** its escalation entries are read
- **THEN** one carries `level` `hs_coordinator` and the other `level` `management`
- **AND** each names the `due_at` it passed and how many days late it was


## REMOVED Requirements

### Requirement: The reads of an external auditor are recorded, and only those

**Reason**: The `external_auditor` role is withdrawn from the closed set, so no session can produce
the entry this requirement demands. It was the system's only exception to not logging reads, and it
existed for that role alone: with the role gone the exception has nothing to except.

**Migration**: None. No `audit_log` entry of an auditor read exists to convert, and any that existed
would be left untouched — an entry describes a past fact and is never rewritten or removed, which
ADR-002 already guarantees. Reads by the three surviving roles are not recorded, which is what this
requirement already stated for every role but the auditor. The `hs_auditor_read_event` function is
dropped with the role.
