## MODIFIED Requirements

### Requirement: The corrective actions of an investigation use the same engine as those of a finding

The system SHALL let a `coordinator` or `management` account create corrective actions whose parent is an
`investigation`, through the same routes, the same state machine, the same evidence rules, the
same verifier rule and the same overdue escalation as the actions of a finding. An action SHALL
belong to exactly one parent — a finding or an investigation — and never to both or to neither.

#### Scenario: An action is created for an investigation

- **WHEN** a `coordinator` or `management` account creates a corrective action naming an
  `investigation_id`, an assignee and a deadline input
- **THEN** a `corrective_action` row is created carrying that `investigation_id` and a null
  `finding_id`

#### Scenario: The action of an investigation advances like any other

- **GIVEN** an action whose parent is an investigation
- **WHEN** the assignee moves it to `in_progress`, attaches after evidence and declares the work
  done, and a different account verifies it
- **THEN** the same events are written as for an action of a finding
- **AND** an `inspector` executor cannot verify their own work, while a `coordinator` or
  `management` executor can (ADR-019, ADR-025)

#### Scenario: An inspector cannot open an action for an investigation

- **WHEN** an `inspector` account creates a corrective action naming an `investigation_id`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: An overdue action of an investigation escalates

- **GIVEN** an action of an investigation three days past its `due_at` and not closed
- **WHEN** the daily escalation runs
- **THEN** the coordinators of the site are notified, exactly as for an action of a finding

#### Scenario: An action naming both parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint
