## MODIFIED Requirements

### Requirement: An active finding exposes its current assignment for correction

The system SHALL present `Edit assignment` in the current next step of an `assigned`, `in_progress`
or `verification` finding to an authenticated `hs_coordinator` or the account named by
`reported_by`, and to no other account. The inline form SHALL contain the current
`assignee_person_id`, `description` and `due_at`. A successful submission SHALL preserve the finding
state, refresh affected readings and present only the replacement values. A failed submission SHALL
preserve the entered values. A `closed` finding SHALL offer no assignment editing.

#### Scenario: An authorized reader edits during verification
- **GIVEN** a finding is `verification` and the reader may edit its action
- **WHEN** the reader chooses `Edit assignment`
- **THEN** the current responsible person, work and due date are available inline

#### Scenario: Closure removes assignment editing
- **GIVEN** a finding exposes `Edit assignment`
- **WHEN** its corrective action reaches `closed`
- **THEN** `Edit assignment` is no longer offered

#### Scenario: An unauthorized reader cannot edit an assignment
- **GIVEN** a non-closed finding whose reader is neither an `hs_coordinator` nor its `reported_by`
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered

### Requirement: The Assigned record presents one current assignment

The system SHALL present only the effective responsible person, description and `due_at` when the
reader opens the reached Assigned stage. It SHALL NOT present the original value, edit versions,
amendment labels or an assignment-history list. Reading that record SHALL remain read-only.

#### Scenario: A corrected assignment replaces the visible values
- **GIVEN** an action assignment was corrected twice
- **WHEN** the reader opens the Assigned stage record
- **THEN** only the latest responsible person, description and `due_at` are presented
- **AND** no previous value or amendment label is presented

## REMOVED Requirements

### Requirement: An assigned finding exposes its current commitment for correction

**Reason**: Editing now remains available through every non-closed state.

**Migration**: Replace it with the active-finding requirement above.

### Requirement: The Assigned record preserves every commitment version

**Reason**: Intermediate corrections are not final decisions and must not look like additional work.

**Migration**: Present the current values already carried by the action summary.
