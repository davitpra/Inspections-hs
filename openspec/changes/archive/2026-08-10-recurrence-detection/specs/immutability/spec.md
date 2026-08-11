## ADDED Requirements

### Requirement: The recurrence mark is fully immutable

The system SHALL make `finding_recurrence` fully immutable: no column SHALL be updatable by any
role, and no row SHALL be deletable or truncatable. Both barriers of the mechanism SHALL apply —
the revoked privilege for the application role and the guard trigger for every role including the
table owner and `hs_migrator`. The application role SHALL keep `SELECT` and `INSERT` and nothing
else. Recording that a hazard had repeated three times before is a statement made at a moment in
time; a mark that can be edited afterwards is a mark that proves nothing.

#### Scenario: The application role cannot update a mark

- **WHEN** the application role updates `prior_count` on a `finding_recurrence` row
- **THEN** the update is rejected because the privilege was never granted

#### Scenario: The table owner cannot update a mark either

- **WHEN** the table owner updates any column of a `finding_recurrence` row
- **THEN** the guard trigger raises and the update is rejected

#### Scenario: A mark cannot be deleted or truncated

- **WHEN** any role deletes a `finding_recurrence` row or truncates the table
- **THEN** the operation is rejected

#### Scenario: The derived column cannot be written

- **WHEN** an insert into `finding_recurrence` supplies a value for `is_recurrent`
- **THEN** the insert is rejected, because the column is computed by the engine from
  `prior_count`

### Requirement: The recurrence mark is isolated by site

The system SHALL apply the site isolation policy to `finding_recurrence`, so that a transaction
sees only the marks of the sites it declared and SHALL reject an insert whose `site_id` is outside
the declared scope. The engine SHALL guarantee that a mark's `site_id` is the `site_id` of its
finding, so that the denormalised column the policy reads cannot disagree with the row it
describes.

#### Scenario: A transaction sees only its own site's marks

- **GIVEN** marks for findings in St. Thomas and in Glencoe
- **WHEN** a transaction declaring only St. Thomas reads `finding_recurrence`
- **THEN** only the St. Thomas marks are returned

#### Scenario: A mark cannot claim the other site

- **WHEN** a `finding_recurrence` row is inserted whose `site_id` differs from its finding's
  `site_id`
- **THEN** the insert fails on the composite foreign key against `finding (id, site_id)`

#### Scenario: A mark outside the declared scope is refused

- **WHEN** a transaction declaring only Glencoe inserts a mark whose `site_id` is St. Thomas
- **THEN** the insert is rejected by the policy
