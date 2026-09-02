## MODIFIED Requirements

### Requirement: A recorded finding presents its persisted five-state lifecycle and one next step

The system SHALL present `finding.state` as the current position in the ordered lifecycle Raised,
Assigned, In progress, Verification and Closed. The system SHALL identify the state in words and
SHALL NOT rely on colour alone. The system SHALL use corrective actions only to identify the
blocking commitment, its nearest deadline and the permitted next transition; it SHALL NOT
recalculate the finding state from those actions. For a raised finding, the system SHALL offer
creation of a corrective action to an authenticated `hs_coordinator` or to the account named by
`reported_by`, and to no other account (ADR-017). The system SHALL accept that composition within
the finding's next step itself, without leaving the findings-only reading or opening a separate
view, and SHALL NOT present the control that begins the composition alongside the composition it
began. For a later non-closed state, the system SHALL offer at most one primary transition
permitted by the action state machine and the reader's role or relationship. When the reader may attempt no transition, the system SHALL name who the finding
is waiting on. The system SHALL offer a closed finding no action transition, while still allowing
an authorized account to create another corrective action. After a successful action creation or
transition, the system SHALL refresh cached action, finding and submitted-inspection readings that
can contain the changed state.

The system SHALL present the next step within the record of the state the finding is currently
in, and SHALL open that state by default. An unsubmitted composition or transition SHALL NOT
move the lifecycle indicator, SHALL NOT add a state to those the reader may open, and SHALL NOT
be presented in a state the finding has not reached.

The system SHALL let the reader open any lifecycle state the finding has already reached and read
the business decisions recorded there, without leaving the findings-only reading. Raised SHALL
present the observation facts recorded with the finding. Assigned SHALL present each corrective
action commitment with its responsible person, description and `due_at`. In progress SHALL present
the decision that began or resumed the work. Verification SHALL present each declaration that the work was done,
including its submitted note and before/after evidence counts when present. Closed SHALL present
each verification decision and its submitted note when present. A decision that sent verification
back to In progress SHALL be presented in In progress with its required reason and optional note.
If several actions or repeated passes through a state contribute decisions, the system SHALL
present every applicable decision in recorded order and SHALL NOT collapse a later decision into
an earlier one.

Reading a reached state SHALL be read-only: it SHALL NOT offer any transition and SHALL NOT
change the state the finding is reported to be in. The system SHALL NOT offer a state the finding
has not reached, with no exception, and SHALL NOT offer this navigation while a corrective action
commitment is being composed or amended. When the record of a reached state cannot be read, the
system SHALL say so and SHALL NOT report that nothing was recorded there.

#### Scenario: The persisted state drives the lifecycle indicator

- **GIVEN** `finding.state` is `verification`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as the current lifecycle state
- **AND** the screen does not derive another state from cached actions

#### Scenario: A reached state presents decisions without moving the finding

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the reader opens the Assigned state
- **THEN** each applicable action's responsible person, description and `due_at` are presented
- **AND** In progress is still named as the current lifecycle state
- **AND** no transition is offered for the state being read

#### Scenario: The next step is read inside the current state

- **GIVEN** `finding.state` is `assigned` and its blocking action is `open`
- **WHEN** a reader permitted to begin the work opens the findings-only screen
- **THEN** Assigned is the lifecycle state opened by default
- **AND** the commitment recorded in Assigned is presented above the next step
- **AND** the transition from `open` to `in_progress` is offered in that same state
- **AND** In progress cannot be opened

#### Scenario: A state the finding has not reached is not offered

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as a lifecycle state
- **AND** Verification cannot be opened

#### Scenario: An unreadable record is not reported as an empty one

- **GIVEN** a reader opens a reached state and its corrective action cannot be read
- **WHEN** the record is presented
- **THEN** the screen says the decisions need a connection
- **AND** it does not report that no decision was recorded in that state

#### Scenario: Completion is read as a decision rather than an event

- **GIVEN** an action reached `awaiting_verification` with a note, one before item and two after items
- **WHEN** the reader opens the Verification state
- **THEN** the decision to declare the work done is presented with that note and the two evidence counts
- **AND** no event position or raw destination state is presented

#### Scenario: A rejected verification is read where work resumed

- **GIVEN** verification sent an action from `awaiting_verification` to `in_progress` with a required `reason` and an optional `note`
- **WHEN** the reader opens the In progress state
- **THEN** the decision to send the work back is presented with its `reason` and `note`
- **AND** an earlier decision that began the work remains present before it

#### Scenario: Repeated and parallel decisions are not collapsed

- **GIVEN** two actions of one finding contributed decisions to the same reached state and one action passed through that state twice
- **WHEN** the reader opens that state
- **THEN** every applicable decision from both actions is presented in recorded order

#### Scenario: The reporter can assign a raised finding

- **GIVEN** a finding has `state` `raised` and its `reported_by` names the reader
- **WHEN** that reader opens the findings-only screen
- **THEN** the one primary next step is to create a corrective action

#### Scenario: The assignee is offered the blocking action's next step

- **GIVEN** a finding has `state` `in_progress` and its least advanced action is `in_progress` and
  assigned to the reader
- **WHEN** the reader opens the findings-only screen
- **THEN** the one primary next step names the move from `in_progress` to `awaiting_verification`

#### Scenario: A reader who cannot act is told who owes the step

- **GIVEN** a finding has `state` `in_progress` and its blocking action belongs to another person
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** no next step control is offered
- **AND** the blocking action's `assignee_name` is named as who the finding is waiting on

#### Scenario: A new action is still available after closure

- **GIVEN** a finding has `state` `closed`
- **WHEN** an account authorized to create corrective actions reads it
- **THEN** no transition is offered for a closed action
- **AND** the control to create another corrective action remains available

#### Scenario: A successful transition refreshes every affected reading

- **GIVEN** an action transition changes a finding from `in_progress` to `verification`
- **WHEN** the transition succeeds from the findings-only screen
- **THEN** the action list and detail are refreshed as applicable
- **AND** cached finding lists and submitted-inspection readings are refreshed
- **AND** the screen remains on the inspection and shows `finding.state` `verification`
