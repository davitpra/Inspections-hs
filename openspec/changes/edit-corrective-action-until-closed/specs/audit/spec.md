## MODIFIED Requirements

### Requirement: The creation of a corrective action records only its stable identity

The system SHALL append exactly one database-triggered `action.created` entry for every
`corrective_action` insert. Its payload SHALL name `action_id`, parent identifier and `site_id`, and
its `actor_user_id` SHALL identify the creator. The payload SHALL NOT include provisional
`assignee_person_id`, `description` or `due_at`, and replacing those fields before closure SHALL NOT
append audit entries.

#### Scenario: Creating an action does not freeze provisional fields
- **WHEN** a corrective action is created
- **THEN** one `action.created` entry identifies the action and parent
- **AND** its payload omits `assignee_person_id`, `description` and `due_at`

### Requirement: Every transition of a corrective action is recorded and closure captures the final assignment

The system SHALL append one database-triggered `action.transitioned` entry for every
`corrective_action_event`. Every payload SHALL identify the transition and actor as before. When
`to_state` is `closed`, the same entry SHALL additionally include the final `assignee_person_id`,
`description` and `due_at` read from the action in that transaction. No earlier transition SHALL
include an assignment snapshot.

#### Scenario: Closure records the final assignment once
- **GIVEN** an action assignment changed while the action was active
- **WHEN** a verifier closes the action
- **THEN** the `action.transitioned` entry for `closed` contains the current `assignee_person_id`,
  `description` and `due_at`
- **AND** no audit entry contains an intermediate assignment version

#### Scenario: The closing entry names the verifier
- **WHEN** an action is closed by an account other than the one that completed it
- **THEN** the closing entry carries that verifier as `actor_user_id`
