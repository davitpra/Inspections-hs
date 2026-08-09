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
