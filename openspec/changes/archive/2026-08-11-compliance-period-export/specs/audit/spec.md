## ADDED Requirements

### Requirement: The generation of a compliance report is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `compliance_report.generated` for
every `compliance_report` row created, written by a database trigger rather than by application
code, in the same transaction as the insert. Its `payload` SHALL name `report_id`, `site_id`,
`range_start`, `range_end`, `payload_hash` and the coverage counts `required_count`,
`completed_count`, `missed_count` and `cancelled_count`. Carrying the digest inside the chain is
the point of the entry: the chain then proves by itself that a document with that exact content
existed on that date, without depending on the report row it describes.

#### Scenario: Generating a report appends one entry carrying the digest

- **WHEN** the HS coordinator generates a compliance report for `st-thomas`
- **THEN** one `audit_log` entry of type `compliance_report.generated` exists in the chain of
  `st-thomas`
- **AND** its `payload` carries the `report_id` and a `payload_hash` equal to the report's
  `payload_hash`
- **AND** its `actor_user_id` is the account that generated the report

#### Scenario: The entry is written even when the insert bypasses the endpoint

- **WHEN** a `compliance_report` row is inserted directly, without going through the endpoint
- **THEN** the `compliance_report.generated` entry is still appended

#### Scenario: The recorded coverage matches the report

- **WHEN** a report whose payload reports `required_count` `12` and `completed_count` `11` is
  generated
- **THEN** its entry's `payload` carries the same two counts

#### Scenario: Two reports of the same range append two entries

- **WHEN** the coordinator generates a report for a range and then generates another for the same
  range
- **THEN** two `compliance_report.generated` entries exist, each naming its own `report_id`
- **AND** the site's chain verifies as intact

### Requirement: Every successful render of a compliance report is recorded in the chain

The system SHALL append one `audit_log` entry of type `compliance_report.rendered` for every
`compliance_report_render` row whose `outcome` is `succeeded`, written by a database trigger in
the same transaction as the insert, with a `payload` naming `report_id`, `site_id`, `object_key`
and the `payload_hash` printed in the rendered document. A render whose `outcome` is `failed`
SHALL NOT append an entry, because a document that was never produced left the system in no way;
the failed attempt remains readable as its own row.

#### Scenario: A successful render appends its entry naming the stored file

- **WHEN** a render of a report succeeds
- **THEN** one `audit_log` entry of type `compliance_report.rendered` exists in the chain of the
  report's site
- **AND** its `payload` carries the `object_key` of the stored file and the report's
  `payload_hash`

#### Scenario: A failed render appends nothing

- **WHEN** a render attempt fails and its row is inserted with `outcome` `failed`
- **THEN** no `compliance_report.rendered` entry is appended
- **AND** the site's chain verifies as intact

#### Scenario: A regenerated PDF appends a second entry with the same digest

- **GIVEN** a report already rendered once
- **WHEN** the PDF is rendered again and succeeds
- **THEN** a second `compliance_report.rendered` entry exists
- **AND** both entries carry the same `payload_hash` and different `object_key` values
