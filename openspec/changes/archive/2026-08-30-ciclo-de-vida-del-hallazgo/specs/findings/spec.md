## ADDED Requirements

### Requirement: Every finding has an immutable state event stream

The system SHALL record each finding state exclusively as an append-only `finding_state_event`
stream whose allowed `to_state` values are `raised`, `assigned`, `in_progress`, `verification`
and `closed`. The system SHALL append an initial event from no prior state to `raised` in the same
transaction that creates every finding. The system SHALL prevent a transaction from committing a
finding without that initial event. The system SHALL prevent every update, deletion and truncation
of the state stream at the database privilege and trigger layers. The system SHALL isolate state
events by the finding's `site_id` through row level security and SHALL include every appended state
event in the site's audit chain.

#### Scenario: An inspection finding starts raised atomically

- **WHEN** an accepted inspection submission creates a finding
- **THEN** that transaction also creates its position `0` state event with `from_state` null and `to_state` `raised`
- **AND** the finding and its initial event either both commit or both roll back

#### Scenario: A manual finding also starts raised

- **WHEN** an authorized account creates a manual finding
- **THEN** its first state event is `raised`
- **AND** no caller supplies that state

#### Scenario: A state event cannot be rewritten

- **GIVEN** a `finding_state_event` has committed
- **WHEN** an application or owner connection attempts to update, delete or truncate it
- **THEN** the database refuses the mutation
- **AND** the original event remains unchanged

#### Scenario: State history is isolated and audited

- **GIVEN** a finding state event belongs to Glencoe
- **WHEN** a session scoped only to St. Thomas reads state events
- **THEN** that event is not visible
- **AND** its original insertion remains represented in the Glencoe audit chain

### Requirement: Corrective action events atomically drive finding state

The system SHALL automatically derive a finding's state after every appended corrective action
event for an action that references that finding. The system SHALL derive `raised` when no action
references the finding; otherwise it SHALL use the least advanced current action state, mapping
`open` to `assigned`, `in_progress` to `in_progress`, `awaiting_verification` to `verification`
and all actions `closed` to `closed`. When the derived value differs from the finding's latest
state event, the system SHALL append the next `finding_state_event` in the same transaction and
SHALL reference the causal corrective action event. When the derived value is unchanged, the
system SHALL NOT append a duplicate state event. The system SHALL allow later action events to
move a finding backward as well as forward.

#### Scenario: The first action assigns a raised finding and starts it

- **GIVEN** a finding's latest state event is `raised`
- **WHEN** a corrective action is created, which appends its `open` and `in_progress` events
- **THEN** the same transaction appends a finding state event from `raised` to `assigned`
- **AND** it then appends one from `assigned` to `in_progress`
- **AND** the finding's current state is `in_progress`

#### Scenario: The least advanced action determines state

- **GIVEN** a finding has one current action in `closed` and another in `open`
- **WHEN** the aggregate state is derived after an action event
- **THEN** the finding's current state is `assigned`
- **AND** it is not `closed`

#### Scenario: Every action must close before the finding closes

- **GIVEN** a finding has two corrective actions and one remains in `verification`
- **WHEN** the other action moves to `closed`
- **THEN** no `closed` finding event is appended
- **AND** the finding remains in `verification`

#### Scenario: Refusing verification returns the finding to work

- **GIVEN** a finding in `verification` has one corrective action in `awaiting_verification`
- **WHEN** verification is refused and the action event moves to `in_progress`
- **THEN** the same transaction appends a finding state event from `verification` to `in_progress`

#### Scenario: A new action regresses a closed finding

- **GIVEN** a finding's latest state event is `closed` and all its existing actions are closed
- **WHEN** an authorized account creates another corrective action for that finding
- **THEN** the same transaction appends a finding state event from `closed` to `assigned` and then
  one from `assigned` to `in_progress`
- **AND** the new action remains valid

#### Scenario: An unchanged aggregate creates no noise

- **GIVEN** one action in `in_progress` already keeps a finding in `in_progress`
- **WHEN** another action of that finding moves to `awaiting_verification`
- **THEN** no additional finding state event is appended
- **AND** the finding remains `in_progress`

#### Scenario: A causal failure rolls back both streams

- **GIVEN** an action event would change its finding's aggregate state
- **WHEN** appending the corresponding finding state event fails
- **THEN** the corrective action event also rolls back
- **AND** neither stream exposes a partial transition

### Requirement: Every Finding response exposes the latest persisted state

The system SHALL include a required `state` in every current `Finding` response and SHALL obtain
it from the latest event by that finding's event position. The system SHALL NOT infer the response
state from a client-provided value or from the action list. The system SHALL treat a persisted
finding without a state event as invalid data rather than silently reporting it as `raised`.

#### Scenario: The findings list carries current state

- **GIVEN** a finding's latest event has `to_state` `in_progress`
- **WHEN** an authorized reader lists findings
- **THEN** that finding's `state` is `in_progress`

#### Scenario: A submitted inspection carries current finding state

- **GIVEN** a submitted inspection contains a finding whose latest event is `verification`
- **WHEN** the submitted inspection is read
- **THEN** its embedded finding has `state` `verification`

#### Scenario: A stale action snapshot does not redefine state

- **GIVEN** the latest finding event is `assigned`
- **WHEN** a client reads that finding alongside an older cached action list
- **THEN** the Finding response still reports `state` `assigned`

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
began. While such an account is composing a corrective
action that has not been submitted, the system MAY indicate the lifecycle state that composition
would reach, and SHALL then mark that state in words as not yet recorded and SHALL present no
deadline for it. Abandoning the composition SHALL return the indicator to the persisted state. For a later non-closed state, the system SHALL
offer at most one primary transition permitted by the action state machine and the reader's role
or relationship. When the reader may attempt no transition, the system SHALL name who the finding
is waiting on. The system SHALL offer a closed finding no action transition, while still allowing
an authorized account to create another corrective action. After a successful action creation or
transition, the system SHALL refresh cached action, finding and submitted-inspection readings that
can contain the changed state.

The system SHALL let the reader open any lifecycle state the finding has already reached and read
what was recorded there, without leaving the findings-only reading. Reading a reached state SHALL
be read-only: it SHALL NOT offer any transition and SHALL NOT change the state the finding is
reported to be in. The system SHALL NOT offer a state the finding has not reached, and SHALL NOT
offer this navigation while a corrective action is being composed. When the record of a reached
state cannot be read, the system SHALL say so and SHALL NOT report that nothing was recorded
there.

#### Scenario: The persisted state drives the lifecycle indicator

- **GIVEN** `finding.state` is `verification`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as the current lifecycle state
- **AND** the screen does not derive another state from cached actions

#### Scenario: A reached state can be read without moving the finding

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the reader opens the Assigned state
- **THEN** what was recorded in that state is presented
- **AND** In progress is still named as the current lifecycle state
- **AND** no transition is offered for the state being read

#### Scenario: A state the finding has not reached is not offered

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as a lifecycle state
- **AND** Verification cannot be opened

#### Scenario: An unreadable record is not reported as an empty one

- **GIVEN** a reader opens a reached state and its corrective action cannot be read
- **WHEN** the record is presented
- **THEN** the screen says the record needs a connection
- **AND** it does not report that nothing was recorded in that state

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

## MODIFIED Requirements

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

The findings-only reading SHALL NOT present the action's event history; that history is read from
the action's own screen. The system SHALL derive offered transitions from the same state machine
enforced by the server and SHALL NOT treat an offered transition as authorization. After a successful transition, the system SHALL refresh
the action and every cached Finding reading whose persisted state may have changed.

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

#### Scenario: A closed action is offered nothing

- **GIVEN** a corrective action is in its terminal state
- **WHEN** any role reads the findings-only screen
- **THEN** no next step, transition or action-reopening control is offered
- **AND** the action's event history is not presented there

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

#### Scenario: The corrective action keeps its own screen

- **GIVEN** a corrective action is reachable from an escalation notice or the corrective actions workspace
- **WHEN** it is opened by its own identifier
- **THEN** its complete event history is presented there in recorded order, each event naming its destination state, time, reason, note and evidence counts
- **AND** the transitions available to the reader are presented there
