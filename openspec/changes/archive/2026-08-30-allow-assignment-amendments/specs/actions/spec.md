## ADDED Requirements

### Requirement: An open action commitment can be amended without rewriting its past

The system SHALL allow an authenticated `hs_coordinator`, or the account named by the parent
finding's `reported_by`, to submit a complete replacement `assignee_person_id`, `description` and
`due_at` while the corrective action's derived state is `open`. The system SHALL require the new
assignee to be active and belong to the action's site, and SHALL require `due_at` to be later than
the amendment instant. The system SHALL refuse every amendment after the action leaves `open`.

The system SHALL append each accepted replacement with its actor and occurrence time and SHALL
preserve the original commitment and every earlier amendment. Action summaries, action details,
deadline processing and subsequent authorization SHALL use the latest accepted commitment.

#### Scenario: A finding reporter corrects an assigned action

- **GIVEN** a corrective action is `open` and belongs to a finding whose `reported_by` names the reader
- **WHEN** the reader submits a valid `assignee_person_id`, `description` and future `due_at`
- **THEN** an amendment is appended and the action remains `open`
- **AND** subsequent reads expose those values as the current commitment

#### Scenario: Work that has started cannot be reassigned

- **GIVEN** a corrective action's current state is `in_progress`
- **WHEN** an otherwise authorized account submits an amendment
- **THEN** the request is rejected with the code `invalid_action_state`
- **AND** no amendment is appended

#### Scenario: The original and corrected commitments remain readable

- **GIVEN** an open action has two accepted amendments
- **WHEN** its detail is read
- **THEN** the original commitment and both amendments are returned in recorded order
- **AND** the second amendment supplies the current `assignee_person_id`, `description` and `due_at`

#### Scenario: Concurrent amendments do not fork the history

- **GIVEN** an open action whose latest commitment position is known
- **WHEN** two amendments are submitted concurrently
- **THEN** at most one occupies the next `(action_id, position)`
- **AND** the action has one unambiguous current commitment

### Requirement: A newly created action waits for work to start

The system SHALL create a corrective action with exactly one initial `corrective_action_event` whose
`to_state` is `open`. The system SHALL NOT append `open` to `in_progress` during creation. Starting
work SHALL remain the existing explicit state transition available to the assigned person or an
`hs_coordinator`.

#### Scenario: Creation leaves the action assigned

- **WHEN** an authorized account creates a corrective action
- **THEN** its derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: Starting work closes the amendment window

- **GIVEN** an open action has its current commitment
- **WHEN** the assigned person or an `hs_coordinator` moves it to `in_progress`
- **THEN** the transition is accepted
- **AND** later commitment amendments are refused
