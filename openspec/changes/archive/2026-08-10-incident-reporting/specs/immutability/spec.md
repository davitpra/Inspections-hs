## ADDED Requirements

### Requirement: An incident, its events, its witnesses, its investigation and its causes cannot be modified or removed

The system SHALL make `incident`, `incident_event`, `incident_witness`, `investigation` and
`investigation_cause` fully immutable: no column of any of the five tables SHALL be updatable by
any role, and no row SHALL be deletable or truncatable. Both barriers of the mechanism SHALL apply
— the revoked privilege for the application role and the guard trigger for every role including
the table owner. Advancing an incident SHALL be done by inserting an event, never by touching a
row; correcting a narrative field, a classification or a cause SHALL NOT be possible at all.

#### Scenario: The application role cannot rewrite a narrative

- **WHEN** a session connected as the application role runs
  `UPDATE incident SET what_happened = 'something else' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `what_happened` is unchanged when read back

#### Scenario: The application role cannot change a classification

- **WHEN** a session connected as the application role runs
  `UPDATE incident SET classification = 'first_aid' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: The migration role is blocked by the trigger

- **WHEN** a session connected as the migration role — which owns the tables — runs an `UPDATE` on
  any of the five tables
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error
- **AND** the message names the table and states that it is append-only

#### Scenario: None of the five tables can be deleted from or truncated

- **WHEN** any role runs `DELETE` or `TRUNCATE` against `incident`, `incident_event`,
  `incident_witness`, `investigation` or `investigation_cause`
- **THEN** every statement fails and every row is still present

#### Scenario: An event cannot be removed to undo a closing

- **WHEN** any role runs `DELETE FROM incident_event WHERE id = <the closing event's id>`
- **THEN** the statement fails and the incident's derived state is still `closed`

#### Scenario: A witness cannot be erased

- **WHEN** any role runs `DELETE FROM incident_witness WHERE id = <existing id>`
- **THEN** the statement fails and the witness is still recorded

#### Scenario: A root cause cannot be rewritten

- **WHEN** any role runs `UPDATE investigation_cause SET statement = 'another cause'`
- **THEN** the statement fails and the cause is unchanged
- **AND** correcting it is done by inserting another cause

#### Scenario: Inserting stays available to the application role

- **WHEN** a session connected as the application role inserts an `incident`, its first
  `incident_event` and its `incident_witness` rows within its declared site scope
- **THEN** the inserts succeed

### Requirement: Incidents and their related rows are isolated by site

The system SHALL apply the site isolation policy to `incident`, `incident_event`,
`incident_witness`, `investigation` and `investigation_cause`, so that a transaction sees only the
rows of the sites it declared, and SHALL reject an insert whose `site_id` is outside the declared
scope. The engine SHALL guarantee that the `site_id` of an event, a witness, an investigation and
a cause equals the `site_id` of its `incident`, so that no two of these tables can disagree about
which workplace a record belongs to.

#### Scenario: Another site's incidents are invisible

- **GIVEN** incidents in both St. Thomas and Glencoe
- **WHEN** a transaction declares only St. Thomas as its scope
- **THEN** selecting from `incident` returns only the St. Thomas rows
- **AND** selecting from the event, witness, investigation and cause tables returns only the rows
  of those incidents

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from the five tables
- **THEN** all five return no rows, even though rows exist

#### Scenario: Inserting an incident that names another site is rejected

- **GIVEN** a transaction whose declared scope is St. Thomas only
- **WHEN** it inserts an `incident` whose `site_id` is Glencoe
- **THEN** the insert is rejected by the row level security policy

#### Scenario: An event cannot name a site other than its incident's

- **WHEN** an `incident_event` row is inserted whose `site_id` differs from the `site_id` of its
  `incident_id`
- **THEN** the insert fails on the `(incident_id, site_id)` foreign key

### Requirement: The incident adds a visibility restriction on top of site isolation, never in place of it

The system SHALL apply to `incident` and its related tables a row level security policy that
restricts reading to the transaction's own account when it is the row's `reported_by`, and to
transactions whose declared role is `hs_coordinator` or `management`. That policy SHALL be
composed with the site isolation policy so that both must hold — a coordinator still sees only the
sites in scope, and a supervisor still sees only their own incidents within those sites. The
restriction SHALL depend on session variables set on the connection and SHALL NOT be a `WHERE`
clause written in an endpoint, so that a query issued directly inside the transaction is subject
to it too.

#### Scenario: Both policies must hold

- **GIVEN** a supervisor of St. Thomas who filed one incident there
- **WHEN** their transaction selects from `incident`
- **THEN** only that incident is returned, neither another supervisor's St. Thomas incident nor
  any Glencoe row

#### Scenario: A coordinator is still bound by site

- **GIVEN** a transaction whose declared role is `hs_coordinator` and whose scope is St. Thomas
- **WHEN** it selects from `incident`
- **THEN** every St. Thomas incident is returned and no Glencoe incident is

#### Scenario: A transaction that declares no role sees no incident

- **WHEN** a transaction sets a site scope but no role and no acting account, and selects from
  `incident`
- **THEN** no row is returned, even though rows of that site exist

#### Scenario: The restriction survives a direct query

- **WHEN** a raw `SELECT * FROM incident` is issued inside a supervisor's transaction
- **THEN** the rows they may not see are absent from the result of that statement

#### Scenario: A write outside the visibility rule is rejected

- **WHEN** a transaction inserts an `incident` whose `reported_by` is an account other than the
  one it declared
- **THEN** the insert is rejected by the policy's check
