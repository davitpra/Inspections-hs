## Purpose

Guarantees that regulatory records cannot be altered or erased once written, and that no site
can read another site's rows — both enforced by the database engine itself rather than by
application code, so an omission in an endpoint cannot defeat them.

## Requirements

### Requirement: Application role cannot update immutable rows

The system SHALL revoke `UPDATE` on every immutable table from the application role, so that an
attempt to modify an existing row fails at the engine level regardless of what the application
code does.

#### Scenario: UPDATE rejected for the application role

- **WHEN** a session connected as the application role runs `UPDATE audit_log SET payload = '{}'::jsonb WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row's `payload` and `hash` are unchanged when read back

### Requirement: Application role cannot delete immutable rows

The system SHALL revoke `DELETE` on every immutable table from the application role. Records are
never removed; entities that stop being current are marked with `deactivated_at` instead.

#### Scenario: DELETE rejected for the application role

- **WHEN** a session connected as the application role runs `DELETE FROM audit_log WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: TRUNCATE rejected for the application role

- **WHEN** a session connected as the application role runs `TRUNCATE audit_log`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

### Requirement: Triggers block mutation independently of privileges

The system SHALL install a `BEFORE UPDATE OR DELETE` trigger on every immutable table that raises
an exception. This barrier MUST hold for any role, including the table owner, so that a privilege
granted by mistake in a future migration does not silently re-open mutation.

#### Scenario: Owner role is blocked by the trigger

- **WHEN** a session connected as the migration role — which owns the table and therefore holds
  `UPDATE` and `DELETE` privileges implicitly — runs `UPDATE audit_log SET payload = '{}'::jsonb WHERE id = <existing id>`
- **THEN** the statement fails with the trigger's dedicated SQLSTATE, not with a privilege error
- **AND** the error message names the table and states that it is append-only

#### Scenario: Owner role is blocked from deleting

- **WHEN** a session connected as the migration role runs `DELETE FROM audit_log WHERE id = <existing id>`
- **THEN** the statement fails with the trigger's dedicated SQLSTATE
- **AND** the row is still present when read back

### Requirement: Inserts remain available to the application role

The system SHALL keep `SELECT` and `INSERT` available to the application role on immutable
tables. Immutability restricts mutation of the past, not the recording of new facts.

#### Scenario: INSERT succeeds for the application role

- **WHEN** a session connected as the application role inserts a row into `audit_log` with a
  valid `site_id`, `event_type` and `payload`
- **THEN** the insert succeeds and the row is readable within the session's site scope

### Requirement: Schema changes are restricted to the migration role

The system SHALL run all schema changes under a migration role that is distinct from the
application role, and the application role SHALL NOT be able to create, alter or drop objects.

#### Scenario: Application role cannot create a table

- **WHEN** a session connected as the application role runs `CREATE TABLE probe (id int)`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: Application role cannot drop the immutability trigger

- **WHEN** a session connected as the application role runs `DROP TRIGGER` against the
  immutability trigger on `audit_log`
- **THEN** the statement fails because the role does not own the table

### Requirement: Site isolation is enforced by row level security

The system SHALL enforce site isolation with row level security policies keyed on the session's
declared site scope, and SHALL NOT rely on a `WHERE site_id = ...` clause written in application
code. Rows outside the session's site scope MUST be invisible, not merely unrequested.

#### Scenario: Rows of another site are invisible

- **GIVEN** `audit_log` holds rows for site A and rows for site B
- **WHEN** a session connected as the application role sets its site scope to site A only and
  runs `SELECT count(*) FROM audit_log`
- **THEN** the count covers only the rows whose `site_id` is site A

#### Scenario: Multi-site scope sees both sites

- **GIVEN** `audit_log` holds rows for site A and rows for site B
- **WHEN** a session connected as the application role sets its site scope to both sites
- **THEN** `SELECT` returns rows from both sites

#### Scenario: Insert outside the session's site scope is rejected

- **WHEN** a session connected as the application role has its site scope set to site A and
  inserts an `audit_log` row whose `site_id` is site B
- **THEN** the insert fails with SQLSTATE `42501` (row level security policy violation)

#### Scenario: Missing site scope yields no rows

- **WHEN** a session connected as the application role queries `audit_log` without having
  declared any site scope
- **THEN** the query returns zero rows rather than every row

### Requirement: Row level security applies to the table owner

The system SHALL apply `FORCE ROW LEVEL SECURITY` to every table carrying site policies, because
a table owner bypasses row level security by default and the migration role owns every table.

#### Scenario: Migration role does not bypass site policies

- **GIVEN** `audit_log` holds rows for site A and rows for site B
- **WHEN** a session connected as the migration role sets its site scope to site A and runs
  `SELECT count(*) FROM audit_log`
- **THEN** the count covers only the rows whose `site_id` is site A

### Requirement: Site scope does not leak between requests

The system SHALL scope the declared site context to a single transaction, so that a pooled
connection reused by a later request carries no site scope from the earlier one.

#### Scenario: Site scope is gone after the transaction ends

- **WHEN** a transaction declares a site scope, completes, and the same pooled connection is
  used for a new transaction that declares no scope
- **THEN** the new transaction sees zero rows in `audit_log`

### Requirement: A submitted inspection and its answers cannot be modified or removed

The system SHALL make `inspection` and `inspection_answer` fully immutable: no column of either
table SHALL be updatable by any role, and no row SHALL be deletable or truncatable. Both barriers
of the mechanism SHALL apply — the revoked privilege for the application role and the guard
trigger for every role including the table owner. Correcting an inspection SHALL be done by a
later supplementary record that supersedes it, never by touching the row.

#### Scenario: The application role cannot correct an answer

- **WHEN** a session connected as the application role runs
  `UPDATE inspection_answer SET value = '"yes"'::jsonb WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `value` is unchanged when read back

#### Scenario: The application role cannot change who signed

- **WHEN** a session connected as the application role runs
  `UPDATE inspection SET submitted_by = <another account> WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: The migration role is blocked by the trigger

- **WHEN** a session connected as the migration role — which owns the tables — runs the same
  `UPDATE` on either table
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error
- **AND** the message names the table and states that it is append-only

#### Scenario: Neither table can be deleted from or truncated

- **WHEN** any role runs `DELETE FROM inspection WHERE id = <existing id>`,
  `DELETE FROM inspection_answer WHERE id = <existing id>`, `TRUNCATE inspection` or
  `TRUNCATE inspection_answer`
- **THEN** every statement fails and every row is still present

#### Scenario: Inserting stays available to the application role

- **WHEN** a session connected as the application role inserts an `inspection` and its
  `inspection_answer` rows within its declared site scope
- **THEN** the inserts succeed

### Requirement: A submitted inspection and its answers are isolated by site

The system SHALL apply the site isolation policy to `inspection` and `inspection_answer`, so that
a transaction sees only the rows of the sites it declared, and SHALL reject an insert whose
`site_id` is outside the declared scope. `inspection_answer.site_id` SHALL be guaranteed by the
engine to equal the `site_id` of its `inspection`, so the two tables can never disagree about
which site a record belongs to.

#### Scenario: Another site's inspections are invisible

- **GIVEN** accepted inspections in both St. Thomas and Glencoe
- **WHEN** a transaction declares only St. Thomas as its scope
- **THEN** selecting from `inspection` returns only the St. Thomas rows
- **AND** selecting from `inspection_answer` returns only the answers of those rows

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from `inspection` and from
  `inspection_answer`
- **THEN** both return no rows, even though rows exist

#### Scenario: Inserting an inspection that names another site is rejected

- **WHEN** a transaction scoped to St. Thomas inserts an `inspection` whose `site_id` is Glencoe
- **THEN** the insert is rejected by the engine and no row is created
- **AND** the rejection may come from the guard trigger rather than the policy, because the
  guard runs first and finds that the site does not match the scheduled inspection's

#### Scenario: An answer cannot belong to a different site than its inspection

- **WHEN** an `inspection_answer` row is inserted whose `site_id` differs from the `site_id` of
  its `inspection_id`
- **THEN** the insert fails with a foreign key violation on the `(inspection_id, site_id)` pair

### Requirement: A finding, its photos and its classifications cannot be modified or removed

The system SHALL make `finding`, `finding_photo` and `finding_risk_assessment` fully immutable: no
column of any of the three tables SHALL be updatable by any role, and no row SHALL be deletable or
truncatable. Both barriers of the mechanism SHALL apply — the revoked privilege for the
application role and the guard trigger for every role including the table owner. Reclassifying a
finding SHALL be done by inserting a new assessment that supersedes the current one, never by
touching a row.

#### Scenario: The application role cannot rewrite a description

- **WHEN** a session connected as the application role runs
  `UPDATE finding SET description = 'nothing to see' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `description` is unchanged when read back

#### Scenario: The application role cannot lower a risk level

- **WHEN** a session connected as the application role runs
  `UPDATE finding_risk_assessment SET severity = 'minor' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: The migration role is blocked by the trigger

- **WHEN** a session connected as the migration role — which owns the tables — runs the same
  `UPDATE` on any of the three tables
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error
- **AND** the message names the table and states that it is append-only

#### Scenario: None of the three tables can be deleted from or truncated

- **WHEN** any role runs `DELETE` or `TRUNCATE` against `finding`, `finding_photo` or
  `finding_risk_assessment`
- **THEN** every statement fails and every row is still present

#### Scenario: A photo cannot be detached from its finding

- **WHEN** any role runs `DELETE FROM finding_photo WHERE id = <existing id>`
- **THEN** the statement fails and the photo is still linked to its finding

#### Scenario: Inserting stays available to the application role

- **WHEN** a session connected as the application role inserts a `finding`, its `finding_photo`
  rows and a `finding_risk_assessment` within its declared site scope
- **THEN** the inserts succeed

### Requirement: Findings, their photos and their classifications are isolated by site

The system SHALL apply the site isolation policy to `finding`, `finding_photo` and
`finding_risk_assessment`, so that a transaction sees only the rows of the sites it declared, and
SHALL reject an insert whose `site_id` is outside the declared scope. The engine SHALL guarantee
that `finding_photo.site_id` and `finding_risk_assessment.site_id` equal the `site_id` of their
`finding`, and that a derived `finding.site_id` equals the `site_id` of its `inspection`, so that
no two of these tables can disagree about which workplace a record belongs to.

#### Scenario: Another site's findings are invisible

- **GIVEN** findings in both St. Thomas and Glencoe
- **WHEN** a transaction declares only St. Thomas as its scope
- **THEN** selecting from `finding` returns only the St. Thomas rows
- **AND** selecting from `finding_photo` and `finding_risk_assessment` returns only the rows of
  those findings

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from the three tables
- **THEN** all three return no rows, even though rows exist

#### Scenario: Inserting a finding that names another site is rejected

- **GIVEN** a transaction whose declared scope is St. Thomas only
- **WHEN** it inserts a `finding` whose `site_id` is Glencoe
- **THEN** the insert is rejected by the row level security policy

#### Scenario: A classification cannot name a site other than its finding's

- **WHEN** a `finding_risk_assessment` row is inserted whose `site_id` differs from the `site_id`
  of its `finding_id`
- **THEN** the insert fails on the `(finding_id, site_id)` foreign key

#### Scenario: A derived finding cannot name a site other than its inspection's

- **WHEN** a `finding` row is inserted whose `inspection_id` belongs to another site
- **THEN** the insert fails on the `(inspection_id, site_id)` foreign key

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
