## ADDED Requirements

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
