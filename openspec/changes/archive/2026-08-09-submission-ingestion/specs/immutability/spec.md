## ADDED Requirements

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
