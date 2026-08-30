## MODIFIED Requirements

### Requirement: Coordinators open a corrective action from the finding that justifies it

The system SHALL offer, on the findings-only reading of a submitted inspection, a control to
create a corrective action for each recorded finding, to an authenticated `hs_coordinator`
account or to the account named by that finding's `reported_by`, and to no other account. The
assignee choices SHALL contain only active people of that finding's site. The system SHALL
associate every existing corrective action with its own recorded finding and SHALL use those
actions to present that finding's persisted lifecycle, next step, nearest blocking deadline and
reached-state decisions without linking to an independent action screen. When the corrective
actions cannot be read, the system SHALL say so and SHALL NOT report that a finding has none. A
finding that already has corrective actions SHALL remain available for another one. This
presentation rule SHALL NOT replace server authorization.

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

#### Scenario: Existing corrective actions drive only their own finding

- **GIVEN** two corrective actions reference one recorded finding and one references another finding
- **WHEN** the findings-only screen is read
- **THEN** only the first two contribute to the lifecycle, next step and reached-state decisions of that finding
- **AND** none is linked to an independent corrective action screen

#### Scenario: An unreadable list is not reported as no commitments

- **GIVEN** the corrective actions cannot be read
- **WHEN** the findings-only screen is read
- **THEN** the screen reports that existing corrective actions need a connection
- **AND** it does not state that the finding has no corrective action

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation control for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

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
began. While such an account is composing a corrective action that has not been submitted, the
system MAY indicate the lifecycle state that composition would reach, and SHALL then mark that
state in words as not yet recorded and SHALL present no deadline for it. Abandoning the composition
SHALL return the indicator to the persisted state. For a later non-closed state, the system SHALL
offer at most one primary transition permitted by the action state machine and the reader's role
or relationship. When the reader may attempt no transition, the system SHALL name who the finding
is waiting on. The system SHALL offer a closed finding no action transition, while still allowing
an authorized account to create another corrective action. After a successful action creation or
transition, the system SHALL refresh cached action, finding and submitted-inspection readings that
can contain the changed state.

The system SHALL let the reader open any lifecycle state the finding has already reached and read
the business decisions recorded there, without leaving the findings-only reading. Raised SHALL
present the observation facts recorded with the finding. Assigned SHALL present each corrective
action commitment with its responsible person, description and `due_at`. In progress SHALL present
the decision that began or resumed the work. When creation put the action under way automatically,
In progress SHALL identify that outcome as part of the same commitment and SHALL NOT claim that a
second decision was submitted. Verification SHALL present each declaration that the work was done,
including its submitted note and before/after evidence counts when present. Closed
SHALL present each verification decision and its submitted note when present. A decision that sent
verification back to In progress SHALL be presented in In progress with its required reason and
optional note. If several actions or repeated passes through a state contribute decisions, the
system SHALL present every applicable decision in recorded order and SHALL NOT collapse a later
decision into an earlier one.

Reading a reached state SHALL be read-only: it SHALL NOT offer any transition and SHALL NOT change
the state the finding is reported to be in. The system SHALL NOT expose corrective-action event
positions, raw destination states or an event timeline in this reading. It SHALL NOT offer a state
the finding has not reached, and SHALL NOT offer this navigation while a corrective action is being
composed. When the decisions of a reached state cannot be read, the system SHALL say so and SHALL
NOT report that nothing was recorded there.

#### Scenario: The persisted state drives the lifecycle indicator

- **GIVEN** `finding.state` is `verification`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as the current lifecycle state
- **AND** the screen does not derive another state from cached actions

#### Scenario: A reached state presents decisions without moving the finding

- **GIVEN** `finding.state` is `verification`
- **WHEN** the reader opens the Assigned state
- **THEN** each applicable action's responsible person, description and `due_at` are presented
- **AND** Verification is still named as the current lifecycle state
- **AND** no transition is offered for the state being read

#### Scenario: Completion is read as a decision rather than an event

- **GIVEN** an action reached `awaiting_verification` with a note, one before item and two after items
- **WHEN** the reader opens the Verification state
- **THEN** the decision to declare the work done is presented with that note and the two evidence counts
- **AND** no event position or raw destination state is presented

#### Scenario: Creation starts work without inventing another decision

- **GIVEN** creating an action wrote its `open` and `in_progress` events in one transaction
- **WHEN** the reader opens the In progress state
- **THEN** the screen states that the created commitment put the work under way
- **AND** it does not present the automatic transition as a separately submitted decision

#### Scenario: A rejected verification is read where work resumed

- **GIVEN** verification sent an action from `awaiting_verification` to `in_progress` with a required `reason` and an optional `note`
- **WHEN** the reader opens the In progress state
- **THEN** the decision to send the work back is presented with its `reason` and `note`
- **AND** an earlier decision that began the work remains present before it

#### Scenario: Repeated and parallel decisions are not collapsed

- **GIVEN** two actions of one finding contributed decisions to the same reached state and one action passed through that state twice
- **WHEN** the reader opens that state
- **THEN** every applicable decision from both actions is presented in recorded order

#### Scenario: A state the finding has not reached is not offered

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as a lifecycle state
- **AND** Verification cannot be opened

#### Scenario: An unreadable decision record is not reported as empty

- **GIVEN** a reader opens a reached state and its corrective action cannot be read
- **WHEN** the state decisions are presented
- **THEN** the screen says the decisions need a connection
- **AND** it does not report that no decision was recorded in that state

#### Scenario: An unsubmitted composition is marked as not recorded

- **GIVEN** `finding.state` is `raised` and an authorized reader has begun composing a corrective action
- **WHEN** the findings-only screen is read
- **THEN** Assigned is indicated as the state that composition would reach
- **AND** that state is named in words as not yet recorded
- **AND** no deadline is presented for it

#### Scenario: Abandoning the composition restores the persisted state

- **GIVEN** an authorized reader has begun composing a corrective action for a raised finding
- **WHEN** that reader abandons the composition without submitting it
- **THEN** Raised is again indicated as the current lifecycle state
- **AND** no corrective action was created

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

### Requirement: A corrective action is advanced from the finding that justifies it

The system SHALL offer, for the corrective action currently holding a recorded finding at its
persisted state, the transitions the action state machine allows and that the reader's role and
relationship permit, presented within the finding's next step itself, with no control that reveals
them, and without leaving the findings-only reading or opening a separate view, so that the step
takes one interaction to submit. When the reader may attempt no transition, the system SHALL offer
none and SHALL say that the action is waiting on someone else. Before a transition that requires a
reason, the system SHALL request it. When work can be declared done, the system SHALL present the
control to attach evidence without making evidence a condition of submission. The system SHALL NOT
present a note field for a transition that takes no note. The system SHALL offer a corrective action
in its terminal state no transition.

The findings-only reading SHALL NOT present the action's event history as a technical history or
timeline. It SHALL instead present the result of each submitted next-step decision under the
reached finding state to which that decision contributes, using the values submitted by the same
creation or transition control. The system SHALL derive offered transitions from the same state
machine enforced by the server and SHALL NOT treat an offered transition as authorization. After a
successful transition, the system SHALL refresh the action and every cached Finding reading whose
persisted state may have changed.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader submits the next step, which was presented with nothing to reveal first
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading remains on screen with `finding.state` `in_progress`

#### Scenario: Starting the work asks for nothing

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader opens the findings-only screen
- **THEN** the next step presents no note field
- **AND** the move from `open` to `in_progress` is submitted by its control alone

#### Scenario: A reader who may write nothing is offered no next step

- **GIVEN** a recorded finding has a corrective action the reader may not advance
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** no next step control is offered to that reader
- **AND** the screen says the action is waiting on someone else

#### Scenario: Declaring work done offers evidence without demanding it

- **GIVEN** a corrective action in `in_progress` can move to `awaiting_verification`
- **WHEN** the assignee reads the finding's next step
- **THEN** the control to attach after evidence is presented
- **AND** the transition can be submitted without evidence

#### Scenario: A closed action is offered no transition or technical timeline

- **GIVEN** a corrective action is in its terminal state
- **WHEN** any role reads the findings-only screen
- **THEN** no next step, transition or action-reopening control is offered
- **AND** its submitted decisions can be read by reached finding state without an event timeline

#### Scenario: Verification refusal records the regression

- **GIVEN** a verifier is permitted to reject an action in `awaiting_verification`
- **WHEN** the verifier submits the required reason
- **THEN** the action moves to `in_progress`
- **AND** the persisted finding state is refreshed from its new `in_progress` event

#### Scenario: A refused transition is not reported as done

- **GIVEN** a verifier is the same person who declared the work done
- **WHEN** that verifier submits approval from the findings-only screen
- **THEN** the server's refusal is shown against the action
- **AND** neither the action stream nor the finding state stream advances

#### Scenario: The action API retains the complete immutable history

- **GIVEN** a corrective action is read through `GET /actions/:id`
- **WHEN** the independent action detail route is no longer available
- **THEN** the response still carries its complete `events` and evidence in recorded order
- **AND** no findings-only screen renders those records as an event timeline
