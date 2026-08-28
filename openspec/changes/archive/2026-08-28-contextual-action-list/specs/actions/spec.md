## MODIFIED Requirements

### Requirement: Actions are read within the reader's site scope

The system SHALL return corrective actions only for the sites in the session's scope, enforced by
the row level security policy on `corrective_action`, `corrective_action_event`,
`corrective_action_evidence` and `corrective_action_escalation`, and not by a `WHERE site_id`
clause in the endpoint. A listing SHALL carry, for each action, its parent identifier, assignee,
assignee name when visible, site name, `due_at`, derived current state, whether it is past `due_at`,
the escalation levels it has reached, and a source discriminated as an inspection finding, manual
finding or incident investigation. An inspection-finding source SHALL carry the stable template
identity and historical template name needed to filter actions across template versions. The
listing SHALL omit event and evidence history; an individual action read SHALL retain that complete
history. A request for an action outside the session's scope SHALL be answered exactly as one for
an action that does not exist.

#### Scenario: A supervisor of one site does not see the other's actions

- **GIVEN** actions in St. Thomas and in Glencoe
- **WHEN** a supervisor scoped to St. Thomas lists actions
- **THEN** only the St. Thomas actions are returned

#### Scenario: An action of the other site is indistinguishable from a missing one

- **WHEN** a supervisor scoped to St. Thomas requests a Glencoe action by id
- **THEN** the response is `action_not_found`
- **AND** the body reveals nothing about its site, assignee or description

#### Scenario: The listing reports the derived state and whether it is late

- **GIVEN** an action in `in_progress` whose `due_at` was two days ago
- **WHEN** it is listed
- **THEN** its `state` is reported as `in_progress`
- **AND** its `overdue` is reported as true, computed from `due_at` and the current time

#### Scenario: An inspection action names its source template

- **GIVEN** an action whose `finding_id` belongs to an inspection made with a historical template version
- **WHEN** actions are listed
- **THEN** its `source.kind` is `inspection`
- **AND** its `source.template_id` and `source.template_name` identify the stable template regardless of version

#### Scenario: Non-inspection actions remain visible

- **GIVEN** one action from a manual finding and one from an incident investigation
- **WHEN** actions are listed
- **THEN** their `source.kind` values are `manual_finding` and `investigation`, respectively

#### Scenario: The listing omits detail history

- **GIVEN** an action with events and evidence
- **WHEN** actions are listed
- **THEN** the summary contains neither `events` nor evidence
- **AND** reading that action by id returns its complete `events` and evidence

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from the four tables
- **THEN** all four return no rows, even though rows exist
