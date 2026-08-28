## MODIFIED Requirements

### Requirement: A corrective action belongs to exactly one parent, a finding or an investigation

The system SHALL store every corrective action as a `corrective_action` row carrying `site_id`,
`assignee_person_id`, `description`, `due_at`, `created_by` and exactly one of `finding_id` and
`investigation_id`. A parent MAY have many corrective actions and a corrective action SHALL belong
to exactly one parent, as §4 closed; the exactly-one rule SHALL be a check constraint in the
database and not an application check. The system SHALL NOT require anything of the parent beyond
its existence within the session's scope: a finding carries no classification and yields no
property the action derives. The action's `site_id` SHALL be the `site_id` of its parent, enforced
by the engine through the composite foreign key of whichever parent it names.

#### Scenario: An action is created for a finding

- **WHEN** the HS coordinator creates an action for a finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that `finding_id`
- **AND** its `investigation_id` is null
- **AND** its `site_id` is the finding's `site_id`

#### Scenario: An action is created for an investigation

- **WHEN** the HS coordinator creates an action for an investigation, with an
  `assignee_person_id`, a `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that `investigation_id`
- **AND** its `finding_id` is null
- **AND** its `site_id` is the investigation's `site_id`

#### Scenario: A finding needs nothing else to receive an action

- **GIVEN** a derived finding just created by an accepted submission
- **WHEN** an action is created for it
- **THEN** the `corrective_action` row is created

#### Scenario: An action with no parent is refused

- **WHEN** a `corrective_action` row is inserted with both `finding_id` and `investigation_id` null
- **THEN** the insert fails on the check constraint

#### Scenario: An action with two parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint

#### Scenario: One parent carries several actions

- **WHEN** three actions are created for the same finding
- **THEN** three `corrective_action` rows reference that `finding_id`
- **AND** each carries its own `assignee_person_id` and its own `due_at`

#### Scenario: An action cannot name a site other than its parent's

- **WHEN** a `corrective_action` row is inserted whose `site_id` differs from the `site_id` of the
  parent it names
- **THEN** the insert fails on that parent's composite foreign key

#### Scenario: A description of two characters is refused

- **WHEN** an action is created with the `description` `fix`
- **THEN** the request is rejected and no `corrective_action` row is created

### Requirement: A shared remediation is grouped without changing anything

The system SHALL accept an optional `remediation_group_id` on a corrective action, shared by the
several actions that one piece of work resolves, as pregunta cerrada 9 decided. The system SHALL
NOT let that identifier alter deadlines, escalation or verification: each action of a group SHALL
keep the `due_at` it was created with, SHALL escalate on its own, and SHALL be closed by its own
verified event.

#### Scenario: Grouped actions keep their own deadlines

- **GIVEN** seven actions sharing one `remediation_group_id`, created with different deadlines
- **WHEN** their deadlines are read
- **THEN** each `due_at` is the one its creation declared

#### Scenario: Closing one action of a group closes only that one

- **GIVEN** seven actions sharing one `remediation_group_id`
- **WHEN** one of them is verified and closed
- **THEN** that action's state is `closed`
- **AND** the other six are unchanged

## REMOVED Requirements

### Requirement: The deadline is derived from the action's severity and frozen at creation

**Reason**: The classification the severity came from is withdrawn from the system. A table of
days per severity, written in code and never an authoritative legal rule, is replaced by the date
the HS coordinator commits to.

**Migration**: None. `corrective_action.severity` is dropped, the days-per-severity table and the
function that applied it leave the shared contracts, and callers state `due_at` instead. Deadlines
already stored are not recomputed.

## ADDED Requirements

### Requirement: The deadline is stated by the HS coordinator and frozen at creation

The system SHALL require a `due_at` when a corrective action is created, for a finding and for an
investigation alike, and SHALL store it unchanged on the row, so the record states what was
promised the day it was promised. The system SHALL refuse a creation with no `due_at`, and SHALL
refuse a `due_at` that is not later than the moment of creation with the code `invalid_due_at`,
because an action born overdue escalates before anyone can act on it. That comparison reads the
current time, so it SHALL be enforced when the request is served and not by a database check. The
system SHALL NOT derive the deadline from any property of the parent and SHALL NOT store a
severity on the action. An action's `due_at` SHALL never move afterwards; a different deadline is
obtained by opening a new action.

#### Scenario: The stored deadline is the one the coordinator stated

- **WHEN** the HS coordinator creates an action on `2026-08-10T09:00:00-04:00` stating `due_at`
  `2026-09-30T17:00:00-04:00`
- **THEN** the stored `due_at` is `2026-09-30T17:00:00-04:00`

#### Scenario: An action of an investigation states its deadline the same way

- **WHEN** the HS coordinator creates an action for an investigation stating a `due_at` two weeks
  out
- **THEN** the stored `due_at` is that date
- **AND** no `severity` is required and none is stored

#### Scenario: A deadline already past is refused

- **WHEN** an action is created with a `due_at` one day before the moment of creation
- **THEN** the request is rejected with the code `invalid_due_at`
- **AND** no `corrective_action` row is created

#### Scenario: An action with no deadline is refused

- **WHEN** an action is created with no `due_at`
- **THEN** the request is rejected
- **AND** no `corrective_action` row is created

#### Scenario: The deadline of an open action does not move

- **GIVEN** an action created with a `due_at` fourteen days out
- **WHEN** an `UPDATE` sets its `due_at` to a later date
- **THEN** the engine rejects the update and the stored `due_at` is unchanged
