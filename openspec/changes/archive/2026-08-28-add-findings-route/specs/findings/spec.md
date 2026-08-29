## ADDED Requirements

### Requirement: A finding is read together with the corrective action its template item prescribed

When a submitted inspection is read back, the system SHALL display, for every question that
recorded a finding, the corrective action prescribed by that item in the template document frozen
with the submission, alongside the description the inspector wrote and the count of photos attached
to the finding. The prescribed text SHALL be taken from the frozen document and never from the
template version published today. A question that recorded no finding SHALL NOT display a
prescribed corrective action, and an item whose template prescribes none SHALL display no heading
in its place. The full inspection report and the findings-only reading of the same submission SHALL
present this identically.

#### Scenario: The prescribed corrective action is read next to the finding

- **GIVEN** a submitted inspection whose item `general.guards` prescribes "Refit the guard before the line runs again." and recorded a finding
- **WHEN** the inspection is read at either the report or the findings-only screen
- **THEN** the prescribed corrective action is displayed with the finding description and photo count

#### Scenario: A clean question does not announce what would have been corrected

- **GIVEN** a submitted inspection whose item `general.photo` prescribes a corrective action and was answered without a finding
- **WHEN** the full report is read
- **THEN** that item's prescribed corrective action is not displayed

#### Scenario: An item without a prescription says nothing

- **GIVEN** a submitted inspection whose item recorded a finding and whose template prescribes no corrective action
- **WHEN** the finding is read
- **THEN** no corrective action heading is displayed for that item

### Requirement: Coordinators open a corrective action from the finding that justifies it

The system SHALL offer, on the findings-only reading of a submitted inspection, a control to
create a corrective action for each recorded finding, to an authenticated `hs_coordinator`
and to no other role. The assignee choices SHALL contain only active people of that
finding's site. The system SHALL show, for every recorded finding and to every role, the
corrective actions that already reference it, each identified by its description and its
current state and linked to that action. When the corrective actions cannot be read, the
system SHALL say so and SHALL NOT report that a finding has none. A finding that already has
corrective actions SHALL remain available for another one. This presentation rule SHALL NOT
replace server authorization.

#### Scenario: The coordinator is offered the creation control

- **GIVEN** a submitted inspection recorded a finding
- **WHEN** an `hs_coordinator` reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: Another role reads the commitments without being offered creation

- **GIVEN** a recorded finding already has one corrective action
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** that corrective action is shown with its description and state
- **AND** no control to create a corrective action is shown

#### Scenario: Existing corrective actions are listed against their own finding

- **GIVEN** two corrective actions reference the recorded finding and one references another finding
- **WHEN** the findings-only screen is read
- **THEN** only the two are shown under that finding, each linked to its own corrective action

#### Scenario: An unreadable list is not reported as no commitments

- **GIVEN** the corrective actions cannot be read
- **WHEN** the findings-only screen is read
- **THEN** the screen reports that existing corrective actions need a connection
- **AND** it does not state that the finding has no corrective action

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation control for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

### Requirement: A corrective action opened from a finding is a complete future commitment

The system SHALL submit a corrective action only when `assignee_person_id` names one of the
offered people, `description` satisfies the corrective action contract, and `due_at` is later
than the current instant. While the creation is pending, the system SHALL prevent a duplicate
submission. After a successful creation, the system SHALL close the form and show the created
corrective action against its finding. If creation fails, the system SHALL keep the entered
values available for correction and SHALL present the failure without claiming that the
corrective action was created.

#### Scenario: A coordinator creates a complete corrective action

- **GIVEN** the coordinator has selected an active `assignee_person_id` of the finding's site,
  entered a valid `description`, and selected a future `due_at`
- **WHEN** the coordinator submits the form
- **THEN** one corrective action is created for that finding with those three values
- **AND** the form closes and the created corrective action is shown against that finding

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
- **THEN** the form remains open with `assignee_person_id`, `description` and `due_at` preserved
- **AND** the failure is shown to the coordinator
