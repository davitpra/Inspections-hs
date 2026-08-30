## MODIFIED Requirements

### Requirement: Coordinators open a corrective action from the finding that justifies it

The system SHALL offer, on the findings-only reading of a submitted inspection, a control to
create a corrective action for each recorded finding, to an authenticated `hs_coordinator`
account or to the account named by that finding's `reported_by`, and to no other account. The
assignee choices SHALL contain only active people of that finding's site. The system SHALL
show, for every recorded finding and to every role, the corrective actions that already
reference it, each identified by its description, the person responsible for it, the deadline
it was created with, its current state, whether it is past that deadline, and the escalation
levels it has reached, and each linked to that action's own screen. Showing the standing of a
commitment SHALL NOT require reading anything beyond the corrective action listing the screen
already reads. When the corrective actions cannot be read, the system SHALL say so and SHALL
NOT report that a finding has none. A finding that already has corrective actions SHALL remain
available for another one. This presentation rule SHALL NOT replace server authorization.

#### Scenario: The coordinator is offered the creation control

- **GIVEN** a submitted inspection recorded a finding
- **WHEN** an `hs_coordinator` reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: The finding's reporter is offered the creation control (ADR-017)

- **GIVEN** a submitted inspection recorded a finding whose `reported_by` names a
  `jhsc_member` account
- **WHEN** that account reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: Another JHSC member reads the same finding without the control

- **GIVEN** a submitted inspection recorded a finding whose `reported_by` names a different
  `jhsc_member` account
- **WHEN** a `jhsc_member` who did not raise that finding reads the findings-only screen
- **THEN** no control to create a corrective action is shown for that finding

#### Scenario: Another role reads the commitments without being offered creation

- **GIVEN** a recorded finding already has one corrective action
- **WHEN** a `jhsc_member` who did not raise that finding reads the findings-only screen
- **THEN** that corrective action is shown with its description, responsible person, deadline and state
- **AND** no control to create a corrective action is shown

#### Scenario: A late commitment is read as late against its finding

- **GIVEN** a recorded finding has a corrective action in `in_progress` whose deadline has passed and which has escalated to the supervisor
- **WHEN** the findings-only screen is read
- **THEN** that corrective action is shown as past its deadline and as escalated to the supervisor
- **AND** its responsible person and deadline are shown without any further request

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

## ADDED Requirements

### Requirement: The assignee is chosen without seeing a profile

The system SHALL offer, for choosing a corrective action's `assignee_person_id` from a
finding, the active people of that finding's site as `PersonOption` values —
`employee_number` and display name and nothing else — through a route scoped to the finding,
and SHALL NOT return through it a person's site, status, dates or any other roster attribute.
This route SHALL require no role beyond being able to read the finding itself: whoever may
choose an assignee for a finding may see this list, whether that is the coordinator or the
account named by the finding's `reported_by` (ADR-017). A deactivated person SHALL be absent
from the list, and a finding outside the reader's scope SHALL be refused with the same code as
one that does not exist.

#### Scenario: The selector returns only what a selector needs

- **WHEN** the account that raised a finding lists the people available as its assignee
- **THEN** each entry carries `employee_number` and the display name
- **AND** no other roster attribute is present in the response

#### Scenario: Deactivated people are not offered

- **GIVEN** a person whose `deactivated_at` is not null
- **WHEN** the assignee selector for a finding of their site is listed
- **THEN** that person is absent from the options

#### Scenario: The list is scoped to the finding's own site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** its assignee selector is listed
- **THEN** only active people of St. Thomas are present

#### Scenario: A finding outside the reader's scope is refused

- **WHEN** the assignee selector is requested for a finding of a site outside the reader's scope
- **THEN** the request is refused with the same code as a finding that does not exist
