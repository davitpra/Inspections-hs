## MODIFIED Requirements

### Requirement: The state of an action is derived from its events and is never stored as a column

The system SHALL record every step of an action as a `corrective_action_event` row and SHALL NOT
store a status column on `corrective_action`. The current state of an action SHALL be the
`to_state` of its highest event, obtained as `SELECT DISTINCT ON (action_id) to_state FROM
corrective_action_event ORDER BY action_id, position DESC`. The states SHALL be exactly `open`,
`in_progress`, `awaiting_verification` and `closed`. Creating an action SHALL write its first
event, with `position` `0`, a null `from_state` and `to_state` `open`, in the same transaction as
the action row, so that no action can exist without a state.

Creating an action SHALL append, in that same transaction and with the same actor and instant, the
`open` → `in_progress` event, so that naming a responsible person and putting the work under way
are one act: what the creation already states — the person, the work and the deadline — is
everything starting the work requires, and no separate control SHALL be needed to begin. The
authorization to create SHALL cover that second event, which is not a second decision. `open` SHALL
remain a state of the machine, because it is the state an action is born in and the state of every
action opened before this behaviour, and the system SHALL keep accepting `open` → `in_progress` for
those.

#### Scenario: Creating an action writes its first event

- **WHEN** an action is created
- **THEN** one `corrective_action_event` row exists for it with `position` `0`, `from_state` null
  and `to_state` `open`
- **AND** a second row exists with `position` `1`, `from_state` `open` and `to_state` `in_progress`
- **AND** both rows name the creating account and share one `occurred_at`

#### Scenario: A created action is already under way

- **WHEN** an action is created and its state is read
- **THEN** the derived state is `in_progress`
- **AND** no transition request was needed to reach it

#### Scenario: The creator starts work they will not execute

- **GIVEN** an account authorized to create an action on a finding it raised, which is neither an
  `hs_coordinator` nor the assigned person
- **WHEN** it creates the action
- **THEN** both creation events are recorded with that account as actor
- **AND** the `open` → `in_progress` event is not refused with `forbidden`

#### Scenario: An action opened earlier still starts by hand

- **GIVEN** an action whose only event is `to_state` `open`
- **WHEN** the assigned person or an `hs_coordinator` requests `open` → `in_progress`
- **THEN** the transition is accepted

#### Scenario: The current state is the last event's

- **GIVEN** an action with events `open`, `in_progress` and `awaiting_verification`
- **WHEN** its state is read
- **THEN** the state returned is `awaiting_verification`
- **AND** all three events are still present and unchanged

#### Scenario: There is no status column to read or write

- **WHEN** the columns of `corrective_action` are listed
- **THEN** no column named `status`, `state` or `current_state` exists

#### Scenario: An action cannot be committed without its first event

- **WHEN** a `corrective_action` row is inserted and the transaction commits with no
  `corrective_action_event` row for it
- **THEN** the commit fails with the dedicated SQLSTATE of the deferred first-event constraint
