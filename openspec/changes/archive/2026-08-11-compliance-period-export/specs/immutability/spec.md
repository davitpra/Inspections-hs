## ADDED Requirements

### Requirement: A compliance report and its renders cannot be modified or removed

The system SHALL make `compliance_report` and `compliance_report_render` fully immutable: no
column SHALL be updatable by any role, and no row SHALL be deletable or truncatable. Both barriers
of the mechanism SHALL apply — the revoked privilege for the application role and the guard
trigger for every role including the table owner and `hs_migrator`. The application role SHALL
keep `SELECT` and `INSERT` and nothing else. A compliance report is the document handed to the
regulator; a payload or a digest that can be edited afterwards is a document that proves nothing,
and a render that can be deleted is a file that can be made to have never existed.

#### Scenario: The application role cannot update a report

- **WHEN** the application role updates `payload` or `payload_hash` on a `compliance_report` row
- **THEN** the update is rejected because the privilege was never granted

#### Scenario: The table owner cannot update a report either

- **WHEN** the table owner updates any column of a `compliance_report` row
- **THEN** the guard trigger raises and the update is rejected

#### Scenario: A report cannot be deleted or truncated

- **WHEN** any role deletes a `compliance_report` row or truncates the table
- **THEN** the operation is rejected

#### Scenario: A render row cannot be corrected after the fact

- **WHEN** any role updates `outcome`, `object_key` or `error` on a `compliance_report_render` row
- **THEN** the operation is rejected, and a wrong render is superseded by a new attempt rather
  than edited

#### Scenario: A render cannot be deleted or truncated

- **WHEN** any role deletes a `compliance_report_render` row or truncates the table
- **THEN** the operation is rejected

### Requirement: Compliance reports and their renders are isolated by site

The system SHALL apply the site isolation policy to `compliance_report` and
`compliance_report_render`, so that a transaction sees only the reports of the sites it declared
and SHALL reject an insert whose `site_id` is outside the declared scope. The engine SHALL
guarantee that a render's `site_id` is the `site_id` of its report, so that the denormalised
column the policy reads cannot disagree with the report it describes.

#### Scenario: A transaction sees only its own site's reports

- **GIVEN** compliance reports for St. Thomas and for Glencoe
- **WHEN** a transaction declaring only St. Thomas reads `compliance_report`
- **THEN** only the St. Thomas reports are returned

#### Scenario: A render cannot claim the other site

- **WHEN** a `compliance_report_render` row is inserted whose `site_id` differs from its report's
  `site_id`
- **THEN** the insert fails on the composite foreign key against `compliance_report (id, site_id)`

#### Scenario: A report outside the declared scope is refused

- **WHEN** a transaction declaring only Glencoe inserts a `compliance_report` whose `site_id` is
  St. Thomas
- **THEN** the insert is rejected by the policy

#### Scenario: A render outside the declared scope is refused

- **WHEN** a transaction declaring only Glencoe inserts a render for a St. Thomas report
- **THEN** the insert is rejected by the policy
