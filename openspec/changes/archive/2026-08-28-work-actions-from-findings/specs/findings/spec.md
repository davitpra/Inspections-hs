## MODIFIED Requirements

### Requirement: Coordinators open a corrective action from the finding that justifies it

The system SHALL offer, on the findings-only reading of a submitted inspection, a control to
create a corrective action for each recorded finding, to an authenticated `hs_coordinator`
and to no other role. The assignee choices SHALL contain only active people of that
finding's site. The system SHALL show, for every recorded finding and to every role, the
corrective actions that already reference it, each identified by its description, the person
responsible for it, the deadline it was created with, its current state, whether it is past
that deadline, and the escalation levels it has reached, and each linked to that action's own
screen. Showing the standing of a commitment SHALL NOT require reading anything beyond the
corrective action listing the screen already reads. When the corrective actions cannot be read,
the system SHALL say so and SHALL NOT report that a finding has none. A finding that already
has corrective actions SHALL remain available for another one. This presentation rule SHALL NOT
replace server authorization.

#### Scenario: The coordinator is offered the creation control

- **GIVEN** a submitted inspection recorded a finding
- **WHEN** an `hs_coordinator` reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: Another role reads the commitments without being offered creation

- **GIVEN** a recorded finding already has one corrective action
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** that corrective action is shown with its description, responsible person, deadline
  and state
- **AND** no control to create a corrective action is shown

#### Scenario: A late commitment is read as late against its finding

- **GIVEN** a recorded finding has a corrective action in `in_progress` whose deadline has
  passed and which has escalated to the supervisor
- **WHEN** the findings-only screen is read
- **THEN** that corrective action is shown as past its deadline and as escalated to the
  supervisor
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

### Requirement: A corrective action is advanced from the finding that justifies it

The system SHALL offer, for every corrective action shown against a recorded finding, a control
that opens that action's complete event history and the work left to do on it, without leaving
the findings-only reading of the inspection. The history SHALL be presented in the order the
events were recorded, each event naming the state it moved to, when it occurred, and the reason,
note and evidence counts it carried. The system SHALL offer exactly the transitions the state
machine allows from the action's current state and that the reader's role and relationship to
the action permit, and SHALL offer none otherwise, saying instead that the action is waiting on
someone else. Before submitting a transition the system SHALL request the reason and the
evidence that transition requires. A corrective action in the terminal state SHALL be offered no
transition at all, including any form of reopening. The transitions offered SHALL be derived from
the same state machine the server enforces, and offering one SHALL NOT replace the server's
authorization, its verifier rule or its evidence rule.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a recorded finding has a corrective action in `open` assigned to the reader
- **WHEN** the reader opens that action from the findings-only screen and records progress
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading of the inspection is still on screen, showing the action in
  its new state

#### Scenario: A reader who may write nothing still reads the history

- **GIVEN** a recorded finding has a corrective action with three recorded events
- **WHEN** a `jhsc_member` opens that action from the findings-only screen
- **THEN** the three events are shown in the order they were recorded
- **AND** no transition is offered, and the screen says the action is waiting on someone else

#### Scenario: Declaring the work done asks for the evidence it requires

- **GIVEN** a corrective action in `in_progress` whose next transition requires after evidence
- **WHEN** the assignee opens it from the findings-only screen
- **THEN** the control to attach after evidence is presented before the transition can be
  submitted

#### Scenario: A closed action is offered nothing

- **GIVEN** a recorded finding has a corrective action in the terminal state
- **WHEN** any role opens it from the findings-only screen
- **THEN** its history is shown
- **AND** no transition is offered, and no control to reopen it exists

#### Scenario: A refused transition is not reported as done

- **GIVEN** a verifier who is the same person that declared the work done opens the action from
  the findings-only screen
- **WHEN** they submit the verification the state machine allows
- **THEN** the server's refusal is shown against that action
- **AND** the action is still shown in the state it was in

#### Scenario: The corrective action keeps its own screen

- **GIVEN** a corrective action reachable from an escalation notice or the corrective actions
  workspace
- **WHEN** it is opened by its own identifier rather than from a finding
- **THEN** its history and the transitions available to the reader are presented there as well
