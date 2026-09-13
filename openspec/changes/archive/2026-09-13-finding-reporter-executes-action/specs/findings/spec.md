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

For a raised finding whose reader may create the corrective action, the system SHALL present that
composition folded behind a single control naming the act, and SHALL present neither the lifecycle
states nor the composition until that control is used. The system SHALL NOT fold the lifecycle of
any other finding, nor of a raised finding whose reader may not create the action: a finding that
has already recorded a decision SHALL present its lifecycle without asking for a gesture first.
The system SHALL request the roster of people available as assignee only for a finding whose
composition has been opened.

The system SHALL present the next step within the record of the state the finding is currently
in, and SHALL open that state by default. The single exception SHALL be an opened corrective action
composition, which the system SHALL present in the Assigned state that composition would write and
SHALL open by default; the system SHALL then mark that state in words as not yet recorded and
SHALL present no deadline for it. An unsubmitted composition or transition SHALL NOT move the
lifecycle indicator, which SHALL keep naming the persisted state. No other state the finding has
not reached SHALL be presented or offered.

The system SHALL let the reader open any lifecycle state the finding has already reached and read
the business decisions recorded there, without leaving the findings-only reading. Raised SHALL
present the observation facts recorded with the finding. Assigned SHALL present each corrective
action commitment with its responsible person, description and `due_at`. In progress and Verification
SHALL present one shared thread of every decision recorded in either of them — each decision that
began or resumed the work, and each declaration that the work was done with its submitted note and
before/after evidence counts when present — and opening either state SHALL present that same thread.
A decision that sent verification back to In progress SHALL be presented in that thread with its
required reason and optional note. Closed SHALL present each verification decision and its submitted
note when present, and SHALL NOT be merged into that thread. The system SHALL name each decision in
a record by the step that recorded it, and SHALL NOT name it by an event position or by a raw
destination state. A step that recorded no reason, note or evidence SHALL be presented as its named
decision alone rather than omitted.
If several actions or repeated passes through a state contribute decisions, the system SHALL
present every applicable decision in recorded order and SHALL NOT collapse a later decision into
an earlier one.

Reading a reached state SHALL be read-only: it SHALL NOT offer any transition and SHALL NOT
change the state the finding is reported to be in. The system SHALL NOT offer a state the finding
has not reached, other than the Assigned state of an opened corrective action composition. The
system SHALL NOT offer this navigation while an assignment replacement is being composed, whose
entered values would not survive changing panels; an unsubmitted corrective action composition
SHALL NOT withdraw that navigation, and SHALL be presented with its entered values intact when its
state is opened again. When the record of a reached state cannot be read, the system SHALL say so
and SHALL NOT report that nothing was recorded there.

#### Scenario: The persisted state drives the lifecycle indicator

- **GIVEN** `finding.state` is `verification`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as the current lifecycle state
- **AND** the screen does not derive another state from cached actions

#### Scenario: A raised finding offers the act before the lifecycle

- **GIVEN** `finding.state` is `raised` and the reader is named by its `reported_by`
- **WHEN** the findings-only screen is read
- **THEN** one control naming the creation of a corrective action is offered
- **AND** no lifecycle state and no composition are presented for that finding
- **AND** the roster of people available as assignee is not requested

#### Scenario: An opened composition is read in the state it would write

- **GIVEN** `finding.state` is `raised` and its reader may create the corrective action
- **WHEN** that reader uses the control that begins the composition
- **THEN** Assigned is the lifecycle state opened, and the composition is presented in it
- **AND** Assigned is named in words as not yet recorded, with no deadline presented
- **AND** Raised is still named as the current lifecycle state
- **AND** the control that began the composition is no longer presented

#### Scenario: Reading Raised does not discard the composition

- **GIVEN** an opened composition holds a responsible person, a description and a deadline that were not submitted
- **WHEN** the reader opens Raised and then opens Assigned again
- **THEN** the observation facts recorded with the finding are presented in Raised
- **AND** the composition is presented again with the same entered values
- **AND** no corrective action was created

#### Scenario: A raised finding a reader cannot assign is not folded

- **GIVEN** `finding.state` is `raised` and a `jhsc_member` who did not raise it reads the screen
- **WHEN** the findings-only screen is read
- **THEN** the lifecycle states are presented without asking for a gesture first
- **AND** Raised is the lifecycle state opened by default
- **AND** no composition and no control that begins one are offered
- **AND** Assigned cannot be opened

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

#### Scenario: A rejected verification is read beside the declaration it refused

- **GIVEN** verification sent an action from `awaiting_verification` to `in_progress` with a required `reason` and an optional `note`
- **WHEN** the reader opens either the In progress state or the Verification state
- **THEN** the decision to send the work back is presented with its `reason` and `note`
- **AND** the declaration it refused is presented before it in the same thread
- **AND** an earlier decision that began the work remains present before both

#### Scenario: A step that recorded nothing else is still named

- **GIVEN** an action moved from `open` to `in_progress` with no note and no evidence
- **WHEN** the reader opens the In progress state
- **THEN** that decision is presented, named as the step that started the work
- **AND** no reason, note or evidence is presented for it

#### Scenario: Closure is not merged into the work thread

- **GIVEN** an action was closed with a submitted note
- **WHEN** the reader opens the Verification state
- **THEN** the closure note is not presented there
- **AND** it is presented when the reader opens the Closed state

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

#### Scenario: The reporter is offered the step of work assigned to someone else

- **GIVEN** a finding has `state` `assigned`, its `reported_by` names the reader, and its least
  advanced action is `open` and assigned to another person
- **WHEN** the reader opens the findings-only screen
- **THEN** the one primary next step names the move from `open` to `in_progress`

#### Scenario: A reader who cannot act is told who owes the step

- **GIVEN** a finding has `state` `in_progress` and its blocking action belongs to another person
- **WHEN** a `jhsc_member` who did not raise the finding reads the findings-only screen
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
relationship permit, presented within the finding's next step itself — with no control that
reveals them, and without leaving the findings-only reading or opening a separate view — so that
the step takes one interaction to submit. When the reader may attempt no transition, the
system SHALL offer none and SHALL say that the action is waiting on someone else. Before a
transition that requires a reason, the system SHALL request it. When work can be declared done,
the system SHALL present the control to attach evidence without making evidence a condition of
submission. The system SHALL NOT present a note field for a transition that takes no note, so
that starting the work assigned by a corrective action is submitted by its control alone. The
system SHALL offer a corrective action in its terminal state no transition.

The findings-only reading SHALL NOT present the action's event history as a technical history or
timeline. The complete history SHALL remain available from the action API as source data. The
findings-only reading SHALL instead present the result of each
submitted next-step decision under the reached finding state to which that decision contributes,
using the values submitted by the same creation or transition control. The system SHALL derive
offered transitions from the same state machine enforced by the server and SHALL NOT treat an
offered transition as authorization. After a successful transition, the system SHALL refresh the
action and every cached Finding reading whose persisted state may have changed.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader submits the next step, which was presented with nothing to reveal first
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading remains on screen with `finding.state` `in_progress`

#### Scenario: The reporter advances work assigned to someone else without leaving the finding

- **GIVEN** a finding has `state` `assigned`, its `reported_by` names the reader, and an action in
  `open` assigned to another person
- **WHEN** the reader submits the next step
- **THEN** the action moves to `in_progress`
- **AND** the action is still assigned to the same person
- **AND** the findings-only reading remains on screen with `finding.state` `in_progress`

#### Scenario: Starting the work asks for nothing

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader opens the findings-only screen
- **THEN** the next step presents no note field
- **AND** the move from `open` to `in_progress` is submitted by its control alone

#### Scenario: A reader who may write nothing is offered no next step

- **GIVEN** a recorded finding has a corrective action the reader may not advance
- **WHEN** a `jhsc_member` who did not raise the finding reads the findings-only screen
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
