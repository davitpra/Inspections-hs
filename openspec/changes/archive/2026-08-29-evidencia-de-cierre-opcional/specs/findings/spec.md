## MODIFIED Requirements

### Requirement: A corrective action is advanced from the finding that justifies it

The system SHALL offer, for every corrective action shown against a recorded finding, a control
that opens that action's complete event history and the work left to do on it, without leaving the
findings-only reading of the inspection. The history SHALL be presented in the order the events
were recorded, each event naming the state it moved to, when it occurred, and the reason, note and
evidence counts it carried. The system SHALL offer exactly the transitions the state machine allows
from the action's current state and that the reader's role and relationship to the action permit,
and SHALL offer none otherwise, saying instead that the action is waiting on someone else. Before
submitting a transition the system SHALL request the reason that transition requires, and SHALL
present the control to attach evidence whenever the work can be declared done, without making the
evidence a condition of submitting. A corrective action in the terminal state SHALL be offered no
transition at all, including any form of reopening. The transitions offered SHALL be derived from
the same state machine the server enforces, and offering one SHALL NOT replace the server's
authorization or its verifier rule.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a recorded finding has a corrective action in `open` assigned to the reader
- **WHEN** the reader opens that action from the findings-only screen and records progress
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading of the inspection is still on screen, showing the action in its new state

#### Scenario: A reader who may write nothing still reads the history

- **GIVEN** a recorded finding has a corrective action with three recorded events
- **WHEN** a `jhsc_member` opens that action from the findings-only screen
- **THEN** the three events are shown in the order they were recorded
- **AND** no transition is offered, and the screen says the action is waiting on someone else

#### Scenario: Declaring the work done offers the evidence control without demanding it

- **GIVEN** a corrective action in `in_progress` whose next transition is `awaiting_verification`
- **WHEN** the assignee opens it from the findings-only screen
- **THEN** the control to attach after evidence is presented
- **AND** the transition can be submitted with no evidence attached

#### Scenario: A closed action is offered nothing

- **GIVEN** a recorded finding has a corrective action in the terminal state
- **WHEN** any role opens it from the findings-only screen
- **THEN** its history is shown
- **AND** no transition is offered, and no control to reopen it exists

#### Scenario: A refused transition is not reported as done

- **GIVEN** a verifier who is the same person that declared the work done opens the action from the findings-only screen
- **WHEN** they submit the verification the state machine allows
- **THEN** the server's refusal is shown against that action
- **AND** the action is still shown in the state it was in

#### Scenario: The corrective action keeps its own screen

- **GIVEN** a corrective action reachable from an escalation notice or the corrective actions workspace
- **WHEN** it is opened by its own identifier rather than from a finding
- **THEN** its history and the transitions available to the reader are presented there as well
