## ADDED Requirements

### Requirement: Coordinators can create corrective actions from findings in the actions workspace

The system SHALL show findings within the reader's site scope in the corrective actions workspace,
including findings with no corrective action and findings that already have one or more corrective
actions. For an authenticated `hs_coordinator`, the system SHALL offer a creation form for each
finding with exactly the required fields `assignee_person_id`, `description`, and `due_at`. The
assignee choices SHALL contain only active people of that finding's site. For every other role, the
system SHALL show the findings without offering the creation form. This presentation rule SHALL NOT
replace server authorization.

#### Scenario: A finding with no action is available to the coordinator

- **GIVEN** a finding in the coordinator's site scope has no corrective actions
- **WHEN** the coordinator opens the corrective actions workspace
- **THEN** the finding is shown with a control to create a corrective action

#### Scenario: A finding remains available after its first action

- **GIVEN** a finding in the coordinator's site scope already has one corrective action
- **WHEN** the coordinator opens the corrective actions workspace
- **THEN** the finding remains shown with its current action count
- **AND** the coordinator can open the form to create another corrective action for it

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation form for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

#### Scenario: A non-coordinator cannot attempt creation from the workspace

- **WHEN** a supervisor opens the corrective actions workspace
- **THEN** scoped findings and existing corrective actions remain readable
- **AND** no control to create a corrective action is shown

### Requirement: Creating an action from the workspace requires a complete future commitment

The system SHALL submit a finding action only when `assignee_person_id` names one of the offered
people, `description` satisfies the corrective action contract, and `due_at` is later than the
current instant. While the creation is pending, the system SHALL prevent a duplicate submission.
After a successful creation, the system SHALL close the form, show the created action in the
corrective actions workspace, and update the source finding's action count. If creation fails, the
system SHALL keep the entered values available for correction and SHALL present the failure without
claiming that the action was created.

#### Scenario: A coordinator creates a complete action

- **GIVEN** the coordinator has selected an active `assignee_person_id` of the finding's site,
  entered a valid `description`, and selected a future `due_at`
- **WHEN** the coordinator submits the form
- **THEN** one corrective action is created for that finding with those three values
- **AND** the created action appears in the corrective actions workspace
- **AND** the finding's action count increases by one

#### Scenario: A past deadline is not submitted

- **WHEN** the coordinator enters a `due_at` that is not later than the current instant
- **THEN** the form reports that the deadline must be in the future
- **AND** no creation request is submitted

#### Scenario: A pending creation cannot be submitted twice

- **GIVEN** a creation request is pending
- **WHEN** the coordinator attempts to submit the same form again
- **THEN** no second creation request is submitted

#### Scenario: A rejected creation preserves the draft

- **GIVEN** the coordinator has completed the creation form
- **WHEN** the creation request fails
- **THEN** the form remains open with `assignee_person_id`, `description`, and `due_at` preserved
- **AND** the failure is shown to the coordinator
