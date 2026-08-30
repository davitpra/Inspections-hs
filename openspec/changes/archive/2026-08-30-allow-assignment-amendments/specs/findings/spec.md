## ADDED Requirements

### Requirement: An assigned finding exposes its current commitment for correction

The system SHALL present an `Edit assignment` control in the current next step of an `assigned`
finding to an authenticated `hs_coordinator` or the account named by `reported_by`, and to no other
account. The control SHALL open an inline form populated with the current `assignee_person_id`,
`description` and `due_at`. A successful submission SHALL keep the finding in `assigned`, refresh
all affected readings and present the replacement values. A failed submission SHALL preserve the
entered values for correction.

#### Scenario: An authorized reader reopens all assignment fields

- **GIVEN** a finding is `assigned` and the reader is allowed to create its corrective action
- **WHEN** the reader chooses `Edit assignment`
- **THEN** the current responsible person, work and due date are available to edit inline
- **AND** `Start work` has not been executed

#### Scenario: An unauthorized reader cannot edit an assignment

- **GIVEN** a finding is `assigned` and the reader is neither an `hs_coordinator` nor its `reported_by`
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered

#### Scenario: Starting work removes assignment editing

- **GIVEN** an assigned finding exposes `Edit assignment` and `Start work`
- **WHEN** an authorized account starts work
- **THEN** the finding advances to `in_progress`
- **AND** `Edit assignment` is no longer offered

### Requirement: The Assigned record preserves every commitment version

The system SHALL present the original commitment and every accepted amendment in recorded order
when the reader opens the reached Assigned stage. Each version SHALL present its responsible
person, description, `due_at`, actor and occurrence time. Reading that record SHALL remain read-only.

#### Scenario: A corrected assignment retains both decisions

- **GIVEN** an action was assigned and then amended before work started
- **WHEN** the reader opens the Assigned stage record
- **THEN** the original commitment is presented before the amendment
- **AND** neither recorded decision offers an editing control
