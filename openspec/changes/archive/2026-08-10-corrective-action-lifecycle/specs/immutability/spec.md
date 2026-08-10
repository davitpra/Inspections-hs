## ADDED Requirements

### Requirement: A corrective action, its events, its evidence and its escalations cannot be modified or removed

The system SHALL make `corrective_action`, `corrective_action_event`,
`corrective_action_evidence` and `corrective_action_escalation` fully immutable: no column of any
of the four tables SHALL be updatable by any role, and no row SHALL be deletable or truncatable.
Both barriers of the mechanism SHALL apply — the revoked privilege for the application role and
the guard trigger for every role including the table owner. Advancing an action SHALL be done by
inserting an event, never by touching a row; reassigning an action or moving its deadline SHALL
NOT be possible at all.

#### Scenario: The application role cannot move a deadline

- **WHEN** a session connected as the application role runs
  `UPDATE corrective_action SET due_at = now() + interval '90 days' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `due_at` is unchanged when read back

#### Scenario: The application role cannot rewrite an event

- **WHEN** a session connected as the application role runs
  `UPDATE corrective_action_event SET to_state = 'closed' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: The migration role is blocked by the trigger

- **WHEN** a session connected as the migration role — which owns the tables — runs the same
  `UPDATE` on any of the four tables
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error
- **AND** the message names the table and states that it is append-only

#### Scenario: None of the four tables can be deleted from or truncated

- **WHEN** any role runs `DELETE` or `TRUNCATE` against `corrective_action`,
  `corrective_action_event`, `corrective_action_evidence` or `corrective_action_escalation`
- **THEN** every statement fails and every row is still present

#### Scenario: An event cannot be removed to undo a transition

- **WHEN** any role runs
  `DELETE FROM corrective_action_event WHERE id = <the closing event's id>`
- **THEN** the statement fails and the action's derived state is still `closed`

#### Scenario: An escalation cannot be erased to silence it

- **WHEN** any role runs `DELETE FROM corrective_action_escalation WHERE id = <existing id>`
- **THEN** the statement fails and the escalation is still recorded

#### Scenario: Inserting stays available to the application role

- **WHEN** a session connected as the application role inserts a `corrective_action`, its first
  `corrective_action_event` and a `corrective_action_evidence` row within its declared site scope
- **THEN** the inserts succeed

### Requirement: Corrective actions, their events, their evidence and their escalations are isolated by site

The system SHALL apply the site isolation policy to `corrective_action`,
`corrective_action_event`, `corrective_action_evidence` and `corrective_action_escalation`, so
that a transaction sees only the rows of the sites it declared, and SHALL reject an insert whose
`site_id` is outside the declared scope. The engine SHALL guarantee that the `site_id` of an
event, of a piece of evidence and of an escalation equals the `site_id` of its
`corrective_action`, and that the `site_id` of an action equals the `site_id` of its `finding`, so
that no two of these tables can disagree about which workplace a record belongs to.

#### Scenario: Another site's actions are invisible

- **GIVEN** corrective actions in both St. Thomas and Glencoe
- **WHEN** a transaction declares only St. Thomas as its scope
- **THEN** selecting from `corrective_action` returns only the St. Thomas rows
- **AND** selecting from the event, evidence and escalation tables returns only the rows of those
  actions

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from the four tables
- **THEN** all four return no rows, even though rows exist

#### Scenario: Inserting an action that names another site is rejected

- **GIVEN** a transaction whose declared scope is St. Thomas only
- **WHEN** it inserts a `corrective_action` whose `site_id` is Glencoe
- **THEN** the insert is rejected by the row level security policy

#### Scenario: An event cannot name a site other than its action's

- **WHEN** a `corrective_action_event` row is inserted whose `site_id` differs from the `site_id`
  of its `action_id`
- **THEN** the insert fails on the `(action_id, site_id)` foreign key

#### Scenario: An action cannot name a site other than its finding's

- **WHEN** a `corrective_action` row is inserted whose `finding_id` belongs to another site
- **THEN** the insert fails on the `(finding_id, site_id)` foreign key
