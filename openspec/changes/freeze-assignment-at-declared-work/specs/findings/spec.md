## MODIFIED Requirements

### Requirement: An active finding exposes its current assignment for correction

The system SHALL present `Edit assignment` in the current next step of an `assigned` or
`in_progress` finding to an authenticated `hs_coordinator` or the account named by `reported_by`,
and to no other account. It SHALL decide that offer on the derived state of the corrective action
that holds the finding in its stage, using the same editable-state rule the server applies. The
inline form SHALL contain the current `assignee_person_id`, `description` and `due_at`. A successful
submission SHALL preserve the finding state, refresh affected readings and present only the
replacement values. A failed submission SHALL preserve the entered values. A `verification` or
`closed` finding SHALL offer no assignment editing.

#### Scenario: An authorized reader edits while the work is in progress

- **GIVEN** a finding is `in_progress` and the reader may edit its action
- **WHEN** the reader chooses `Edit assignment`
- **THEN** the current responsible person, work and due date are available inline

#### Scenario: Verification presents its decision without an assignment editor

- **GIVEN** a finding is `verification` and the reader may edit its action
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered
- **AND** the verification outcomes of the step are still offered

#### Scenario: A refused verification restores assignment editing

- **GIVEN** a `verification` finding whose reader may edit its action
- **WHEN** the reader sends the work back and the finding returns to `in_progress`
- **THEN** `Edit assignment` is offered again

#### Scenario: Closure removes assignment editing

- **GIVEN** a finding exposes `Edit assignment`
- **WHEN** its corrective action reaches `closed`
- **THEN** `Edit assignment` is no longer offered

#### Scenario: An unauthorized reader cannot edit an assignment

- **GIVEN** an `assigned` or `in_progress` finding whose reader is neither an `hs_coordinator` nor
  its `reported_by`
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered
