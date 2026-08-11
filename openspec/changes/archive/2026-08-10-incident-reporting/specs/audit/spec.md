## ADDED Requirements

### Requirement: A reported incident is recorded in the chain by the database

The system SHALL record an audit entry for every `incident` row, written by the database as part
of the same transaction that reports it. A committed incident with no corresponding audit entry
MUST be an impossible state, and producing the entry SHALL NOT depend on the endpoint remembering
to write it. The entry SHALL carry the incident's `site_id`, an `event_type` identifying a
reported incident, and a `payload` containing the incident's identifier, its `classification`, its
`form_version`, its `location_id`, its `occurred_at`, its `reported_at` and the number of
witnesses recorded. The payload SHALL NOT contain any narrative field nor the subject's name or
employee number: it SHALL identify the subject by `subject_person_id` alone, because the audit log
is read under a different visibility rule than the incident and the narrative MUST NOT reach it.
The acting user SHALL be taken from the scope declared by the transaction.

#### Scenario: Reporting an incident writes an entry

- **WHEN** a supervisor reports an incident
- **THEN** an `audit_log` entry exists with that incident's `site_id` and an `event_type`
  identifying a reported incident
- **AND** its `payload` contains the incident's identifier and `classification`
- **AND** its `actor_user_id` is the reporting account

#### Scenario: The entry carries no narrative

- **WHEN** the audit entry of a reported incident is read
- **THEN** its `payload` contains no value of `what_happened`, `task_performed`,
  `equipment_involved` or `immediate_action`
- **AND** it identifies the subject by `subject_person_id` and by nothing else

#### Scenario: A rejected report leaves no entry

- **WHEN** a report is rejected and the transaction rolls back
- **THEN** no `audit_log` entry for it exists

#### Scenario: Witnesses add no entries of their own

- **WHEN** an incident is reported naming three witnesses
- **THEN** exactly one entry is written for the report
- **AND** its `payload` states that three witnesses were recorded

### Requirement: Every transition of an incident is recorded in the chain

The system SHALL record an audit entry for every `incident_event` row, written by the database in
the same transaction as the transition. The entry SHALL carry the incident's `site_id`, an
`event_type` identifying an incident transition, and a `payload` containing the incident's
identifier, the event's `position`, its `from_state`, its `to_state` and its `reason` where the
transition demanded one. A reopening SHALL produce an entry like any other transition and SHALL
NOT be distinguishable from an edit, because there are no edits.

#### Scenario: Moving to investigation writes an entry

- **WHEN** the coordinator moves a reported incident to `under_investigation`
- **THEN** an entry exists whose `payload` carries `from_state` `reported` and `to_state`
  `under_investigation`
- **AND** its `actor_user_id` is the coordinator

#### Scenario: Closing writes an entry

- **WHEN** an incident is closed
- **THEN** an entry exists whose `payload` carries `to_state` `closed`

#### Scenario: Reopening writes an entry carrying its reason

- **WHEN** a closed incident is reopened
- **THEN** an entry exists whose `payload` carries `from_state` `closed`, `to_state`
  `under_investigation` and the stated reason

#### Scenario: A refused transition leaves no entry

- **WHEN** a transition is refused by the state machine guard, by the open-actions guard or by the
  mandatory-investigation guard
- **THEN** no `audit_log` entry for that attempt exists

### Requirement: Opening an investigation and recording a cause are recorded in the chain

The system SHALL record an audit entry for every `investigation` row and for every
`investigation_cause` row, written by the database in the same transaction as the insert. The
investigation entry SHALL carry the incident's `site_id`, an `event_type` identifying an opened
investigation, and a `payload` containing the investigation's identifier, its `incident_id` and
its `method`. The cause entry SHALL carry an `event_type` identifying a recorded cause and a
`payload` containing the investigation's identifier, the cause's `position` and its `is_root`
flag, and SHALL NOT contain the cause `statement`, for the same reason the narrative stays out of
the log.

#### Scenario: Opening an investigation writes an entry

- **WHEN** an investigation is opened with the method `five_whys`
- **THEN** an entry exists whose `payload` carries the `incident_id` and the method

#### Scenario: Each cause writes its own entry

- **WHEN** four causes are recorded, the last of them the root
- **THEN** four entries exist
- **AND** the entry of the last one states `is_root` true

#### Scenario: The cause statement stays out of the log

- **WHEN** the entry of a recorded cause is read
- **THEN** it carries no `statement`

#### Scenario: Every incident entry chains within its own site

- **WHEN** incidents are reported and advanced in both sites concurrently
- **THEN** each entry's `prev_hash` links it to the previous entry of the same site
- **AND** the chain of each site verifies
