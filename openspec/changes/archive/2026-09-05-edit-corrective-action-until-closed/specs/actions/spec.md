## MODIFIED Requirements

### Requirement: The deadline is stated when the action is created and frozen at closure

The system SHALL require a future `due_at` when a corrective action is created and whenever its
assignment is replaced. The system SHALL store the current deadline directly on
`corrective_action`, SHALL use it for subsequent deadline processing, and SHALL allow an authorized
replacement while the derived state is not `closed`. Once the action reaches `closed`, the system
SHALL refuse every change to `due_at`. The system SHALL NOT derive the deadline from its parent and
SHALL NOT store severity on the action.

#### Scenario: A current deadline can be corrected before closure
- **GIVEN** an action is `in_progress` with a future `due_at`
- **WHEN** an authorized account replaces its assignment with a later future `due_at`
- **THEN** the `corrective_action.due_at` value is replaced

#### Scenario: A closed deadline cannot move
- **GIVEN** an action is `closed`
- **WHEN** any role attempts to update `corrective_action.due_at`
- **THEN** the database rejects the update and preserves the final value

#### Scenario: A past replacement deadline is refused
- **WHEN** an authorized account replaces an assignment with a `due_at` before the request instant
- **THEN** the request is rejected with the code `invalid_due_at`

### Requirement: A newly created action waits for work to start

The system SHALL create a corrective action with exactly one initial `corrective_action_event` whose
`to_state` is `open`. The system SHALL NOT append `open` to `in_progress` during creation. Starting
work SHALL remain the explicit state transition available to the assigned person or an
`hs_coordinator`, and SHALL NOT freeze assignment editing.

#### Scenario: Creation leaves the action assigned
- **WHEN** an authorized account creates a corrective action
- **THEN** its derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: Starting work keeps the assignment correctable
- **GIVEN** an open action has its current assignment
- **WHEN** the assigned person or an `hs_coordinator` moves it to `in_progress`
- **THEN** the transition is accepted
- **AND** an authorized account can still replace the assignment

### Requirement: An overdue action escalates to the supervisor at three days and to management at seven

The system SHALL use the current `corrective_action.due_at` to find every non-closed action more than
3 or 7 days overdue and SHALL retain the existing supervisor and management escalation behavior.
Each level SHALL still be emitted at most once. Replacing `due_at` SHALL affect future decisions but
SHALL NOT delete, withdraw or repeat an escalation already emitted.

#### Scenario: A replacement deadline governs future escalation
- **GIVEN** a non-closed action has not escalated
- **WHEN** its `due_at` is replaced with a later future value
- **THEN** subsequent escalation runs use the replacement value

#### Scenario: A past escalation survives a replacement
- **GIVEN** an action already has a `corrective_action_escalation` row
- **WHEN** its assignment is replaced with a later `due_at`
- **THEN** the escalation row and its notifications remain unchanged

### Requirement: The effective assignee has one current assignment notification

The system SHALL create an in-application `corrective_action_assigned` notification when the current
assignee has an active account. When an assignment replacement changes `assignee_person_id`, the
system SHALL withdraw the previous action-assignment notification from its recipient's inbox and
SHALL notify the new assignee. It SHALL NOT delete the withdrawn notification. A person without an
account SHALL receive no notification and SHALL NOT prevent the replacement.

#### Scenario: Correcting the assignee moves the inbox item
- **GIVEN** an action assignment notified person A
- **WHEN** an authorized account replaces `assignee_person_id` with person B
- **THEN** person A no longer sees that assignment notification
- **AND** person B sees the current assignment notification when they have an active account

#### Scenario: An assignee without an account gets no notification
- **WHEN** an assignment names a person with no `app_user` row
- **THEN** the assignment is accepted
- **AND** no active assignment notification exists for that person

## ADDED Requirements

### Requirement: A corrective action assignment is replaceable until closure

The system SHALL allow an authenticated `hs_coordinator`, or the account named by the parent
finding's `reported_by`, to submit a complete replacement `assignee_person_id`, `description` and
`due_at` while the corrective action's derived state is `open`, `in_progress` or
`awaiting_verification`. Each accepted request SHALL update those three columns on the same
`corrective_action` row and SHALL NOT append an assignment version. The system SHALL require an
active assignee from the action's site and a future `due_at`. It SHALL refuse replacement when the
state is `closed` with `invalid_action_state`.

#### Scenario: Work in progress can be corrected
- **GIVEN** an action is `in_progress`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the same `corrective_action` row exposes the replacement values
- **AND** no new corrective action or assignment-history row is created

#### Scenario: Verification can be corrected before closure
- **GIVEN** an action is `awaiting_verification`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the replacement is accepted without changing the action state

#### Scenario: Closure freezes the assignment
- **GIVEN** an action is `closed`
- **WHEN** an otherwise authorized account submits replacement assignment fields
- **THEN** the request is rejected with `invalid_action_state`
- **AND** the final assignment remains unchanged

## REMOVED Requirements

### Requirement: An open action commitment can be amended without rewriting its past

**Reason**: Pre-closure values are correctable operational data, not separate final decisions.

**Migration**: Copy each development action's latest amendment into `corrective_action`, then remove
the amendment endpoint, response history and table.
