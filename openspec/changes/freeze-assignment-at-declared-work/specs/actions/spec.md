## MODIFIED Requirements

### Requirement: The deadline is stated when the action is created and frozen at closure

The system SHALL require a future `due_at` when a corrective action is created and whenever its
assignment is replaced. The system SHALL store the current deadline directly on
`corrective_action`, SHALL use it for subsequent deadline processing, and SHALL allow an authorized
replacement while the derived state is `open` or `in_progress`. Once the action reaches
`awaiting_verification`, the system SHALL refuse every change to `due_at` until a refused
verification returns it to `in_progress`, and SHALL refuse them permanently once it is `closed`. The
system SHALL NOT derive the deadline from its parent and SHALL NOT store severity on the action.

#### Scenario: A current deadline can be corrected while the work is in progress

- **GIVEN** an action is `in_progress` with a future `due_at`
- **WHEN** an authorized account replaces its assignment with a later future `due_at`
- **THEN** the `corrective_action.due_at` value is replaced

#### Scenario: A deadline awaiting verification cannot move

- **GIVEN** an action is `awaiting_verification`
- **WHEN** any role attempts to update `corrective_action.due_at`
- **THEN** the database rejects the update and preserves the value

#### Scenario: A closed deadline cannot move

- **GIVEN** an action is `closed`
- **WHEN** any role attempts to update `corrective_action.due_at`
- **THEN** the database rejects the update and preserves the final value

#### Scenario: A past replacement deadline is refused

- **WHEN** an authorized account replaces an assignment with a `due_at` before the request instant
- **THEN** the request is rejected with the code `invalid_due_at`

### Requirement: A corrective action assignment is replaceable until closure

The system SHALL allow an authenticated `hs_coordinator`, or the account named by the parent
finding's `reported_by`, to submit a complete replacement `assignee_person_id`, `description` and
`due_at` while the corrective action's derived state is `open` or `in_progress`. Each accepted
request SHALL update those three columns on the same `corrective_action` row and SHALL NOT append an
assignment version. The system SHALL require an active assignee from the action's site and a future
`due_at`. It SHALL refuse replacement when the state is `awaiting_verification` or `closed` with
`invalid_action_state`. A refused verification that returns the action to `in_progress` SHALL make
the assignment replaceable again.

#### Scenario: Work in progress can be corrected

- **GIVEN** an action is `in_progress`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the same `corrective_action` row exposes the replacement values
- **AND** no new corrective action or assignment-history row is created

#### Scenario: Declared work freezes the assignment

- **GIVEN** an action is `awaiting_verification`
- **WHEN** an otherwise authorized account submits replacement assignment fields
- **THEN** the request is rejected with `invalid_action_state`
- **AND** the assignment being verified remains unchanged

#### Scenario: A refused verification reopens the assignment

- **GIVEN** an action was returned from `awaiting_verification` to `in_progress` with a reason
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the replacement is accepted

#### Scenario: Closure freezes the assignment

- **GIVEN** an action is `closed`
- **WHEN** an otherwise authorized account submits replacement assignment fields
- **THEN** the request is rejected with `invalid_action_state`
- **AND** the final assignment remains unchanged

### Requirement: A newly created action waits for work to start

The system SHALL create a corrective action with exactly one initial `corrective_action_event` whose
`to_state` is `open`. The system SHALL NOT append `open` to `in_progress` during creation. Starting
work SHALL remain the existing explicit state transition available to the assigned person or an
`hs_coordinator`, and SHALL NOT freeze assignment editing.

#### Scenario: Creation leaves the action assigned

- **WHEN** an authorized account creates a corrective action
- **THEN** its derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: Starting work keeps the assignment correctable

- **GIVEN** an open action has its current commitment
- **WHEN** the assigned person or an `hs_coordinator` moves it to `in_progress`
- **THEN** the transition is accepted
- **AND** an authorized account can still replace the assignment

#### Scenario: Declaring the work done stops being correctable

- **GIVEN** an action is `in_progress`
- **WHEN** the assigned person or an `hs_coordinator` moves it to `awaiting_verification`
- **THEN** the transition is accepted
- **AND** no account can replace the assignment until the verification is refused

### Requirement: An overdue action escalates to the supervisor at three days and to management at seven

The system SHALL use the current `corrective_action.due_at` to find every non-closed action more than
3 or 7 days overdue and SHALL retain the existing supervisor and management escalation behavior.
Each level SHALL still be emitted at most once. Replacing `due_at` SHALL affect future decisions but
SHALL NOT delete, withdraw or repeat an escalation already emitted. An action whose work is declared
done SHALL keep escalating against the frozen `due_at`, which SHALL be movable only after a refused
verification returns it to `in_progress`.

#### Scenario: Three days past the deadline reaches the supervisor

- **GIVEN** an action whose current state is `in_progress` and whose `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `supervisor` exists for it
- **AND** every active `supervisor` account of its site has a notification of kind
  `corrective_action_overdue_supervisor` naming the action

#### Scenario: A replacement deadline governs future escalation

- **GIVEN** an `open` or `in_progress` action has not escalated
- **WHEN** its `due_at` is replaced with a later future value
- **THEN** subsequent escalation runs use the replacement value

#### Scenario: An action awaiting verification escalates on its frozen deadline

- **GIVEN** an action is `awaiting_verification` and its `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `supervisor` exists for it
- **AND** its `due_at` cannot be replaced while it stays in that state

#### Scenario: A past escalation survives a replacement

- **GIVEN** an action already has a `corrective_action_escalation` row
- **WHEN** its assignment is replaced with a later `due_at`
- **THEN** the escalation row and its notifications remain unchanged

#### Scenario: Seven days past the deadline reaches management

- **GIVEN** an action already escalated to the supervisor and whose `due_at` was 8 days ago
- **WHEN** the escalation job runs
- **THEN** a second row with `level` `management` exists for it
- **AND** every active `management` account of its site has a notification of kind
  `corrective_action_overdue_management`

#### Scenario: Thirty daily runs escalate once

- **GIVEN** an action that has been overdue for 30 days
- **WHEN** the escalation job runs on each of those days
- **THEN** exactly one `supervisor` row and one `management` row exist for it
- **AND** each recipient has exactly one notification per level

#### Scenario: A closed action does not escalate

- **GIVEN** an action closed one day before its deadline
- **WHEN** the escalation job runs ten days later
- **THEN** no `corrective_action_escalation` row exists for it

#### Scenario: An action inside its deadline does not escalate

- **GIVEN** an action whose `due_at` is two days in the future
- **WHEN** the escalation job runs
- **THEN** no escalation row and no notification exist for it

#### Scenario: Escalation adds no event to the stream

- **GIVEN** an action escalated to both levels
- **WHEN** its events are read
- **THEN** its current state is unchanged by the escalation
- **AND** no event of the stream refers to an escalation
