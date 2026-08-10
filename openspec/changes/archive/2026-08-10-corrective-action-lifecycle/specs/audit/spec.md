## ADDED Requirements

### Requirement: The creation of a corrective action is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `action.created` for every
`corrective_action` row, written by a database trigger rather than by application code, in the
same transaction as the insert. Its `payload` SHALL name `action_id`, `finding_id`, `site_id`,
`assignee_person_id`, `severity` and `due_at`, so that the record states what was promised, by
when, and on what severity that deadline was based. Its `actor_user_id` SHALL be the account that
created it.

#### Scenario: Creating an action appends one entry

- **WHEN** the HS coordinator creates a corrective action
- **THEN** one new `audit_log` entry of type `action.created` exists for that site
- **AND** its `payload` names the `action_id`, the `finding_id`, the `assignee_person_id`, the
  `severity` and the `due_at`

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** a `corrective_action` row is inserted directly, without going through the endpoint
- **THEN** the `action.created` entry is still appended
- **AND** the site's chain verifies as intact

### Requirement: Every transition of a corrective action is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `action.transitioned` for every
`corrective_action_event` row, written by the same trigger mechanism. Its `payload` SHALL name
`action_id`, `site_id`, `from_state`, `to_state`, `position` and the `reason` when the event
carries one. Its `actor_user_id` SHALL be the `actor_user_id` of the event, which for a closing
event is the verifier and never the executor. The entry for the first event of an action SHALL
carry a null `from_state` and `to_state` `open`.

#### Scenario: An action that runs its full course leaves four entries

- **GIVEN** an action created, started, completed and closed
- **WHEN** the site's chain is read
- **THEN** four `action.transitioned` entries exist for it, with `to_state` `open`,
  `in_progress`, `awaiting_verification` and `closed` in that order
- **AND** the chain verifies as intact

#### Scenario: The closing entry names the verifier

- **WHEN** an action is closed by an account other than the one that completed it
- **THEN** the `action.transitioned` entry with `to_state` `closed` carries that verifier as
  `actor_user_id`

#### Scenario: A refused verification records its reason

- **WHEN** a verifier refuses the work and the action returns to `in_progress`
- **THEN** the `action.transitioned` entry carries `from_state` `awaiting_verification`,
  `to_state` `in_progress` and the `reason` given

#### Scenario: A rejected transition leaves no entry

- **GIVEN** an action whose current state is `open`
- **WHEN** a transition to `closed` is rejected
- **THEN** no new `audit_log` entry exists for that site
- **AND** the chain verifies as intact

### Requirement: Evidence added to a corrective action is recorded in the chain

The system SHALL append one `audit_log` entry of type `action.evidence_added` for every
`corrective_action_evidence` row, naming `action_id`, `site_id`, `event_id`, `kind` and
`object_key`. The entry SHALL record the object key and SHALL NEVER carry the file's bytes.

#### Scenario: Completing with three files appends three entries

- **WHEN** the assignee declares the work done with one `before` and two `after` object keys
- **THEN** three `action.evidence_added` entries exist for that site
- **AND** each names its `kind` and its `object_key`

#### Scenario: The entry carries no image bytes

- **WHEN** an `action.evidence_added` entry is read back
- **THEN** its `payload` contains the `object_key` and no encoded file content

### Requirement: Every escalation of an overdue action is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `action.escalated` for every
`corrective_action_escalation` row, naming `action_id`, `site_id`, `level`, `due_at` and the
number of days the action was overdue when it escalated. Its `actor_user_id` SHALL be null,
because the escalation is the scheduler's act and not a person's, and the entry SHALL still be
linked into the site's chain like any other.

#### Scenario: Escalating to the supervisor appends one entry

- **GIVEN** an action overdue by four days
- **WHEN** the escalation job runs
- **THEN** one `audit_log` entry of type `action.escalated` exists with `level` `supervisor`
- **AND** its `actor_user_id` is null

#### Scenario: Repeated runs append nothing further

- **GIVEN** an action already escalated to both levels
- **WHEN** the escalation job runs on each of the next ten days
- **THEN** no new `action.escalated` entry is appended
- **AND** the site's chain verifies as intact

#### Scenario: Both levels are distinguishable in the record

- **GIVEN** an action overdue by eight days that escalated to both levels
- **WHEN** its escalation entries are read
- **THEN** one carries `level` `supervisor` and the other `level` `management`
- **AND** each names the `due_at` it passed and how many days late it was
