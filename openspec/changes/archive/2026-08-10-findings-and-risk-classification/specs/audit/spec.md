## ADDED Requirements

### Requirement: A derived finding is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `finding.derived` for every
`finding` row created with origin `inspection`, written by a database trigger rather than by
application code, in the same transaction as the insert. Its `payload` SHALL name `finding_id`,
`inspection_id`, `site_id`, `template_version_item_id`, `item_key`, `location_id` and the number
of photos. Its `occurred_at` SHALL be the `signed_at` reported by the device and its `recorded_at`
SHALL be the server clock, so that a finding captured offline days earlier is not recorded as
having happened when the network returned.

#### Scenario: Each derived finding appends one entry

- **WHEN** a submission with 3 negative answers is accepted
- **THEN** 3 new `audit_log` entries of type `finding.derived` exist for that site, one per
  finding
- **AND** each `payload` names its `finding_id` and its `item_key`

#### Scenario: The entry keeps the device clock apart from the server clock

- **GIVEN** a submission signed on the device at `2026-08-03T14:20:00-04:00` and received on
  2026-08-09
- **WHEN** it is accepted
- **THEN** each `finding.derived` entry carries `occurred_at` `2026-08-03T14:20:00-04:00`
- **AND** its `recorded_at` is the server time of the accepting transaction

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** a `finding` row with origin `inspection` is inserted directly, without going through
  the endpoint
- **THEN** the `finding.derived` entry is still appended

#### Scenario: A replayed submission adds no finding entry

- **GIVEN** a submission with negative answers already accepted
- **WHEN** the identical payload is posted again and returns `created` `false`
- **THEN** no new `finding.derived` entry is appended
- **AND** the site's chain verifies as intact

### Requirement: A manually reported finding is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `finding.reported` for every
`finding` row created with origin `manual`, written by the same trigger mechanism. Its `payload`
SHALL name `finding_id`, `site_id`, `location_id` and the number of photos, and SHALL state that
the finding has no `item_key`. Its `actor_user_id` SHALL be the account that reported it.

#### Scenario: Reporting a hazard appends one entry

- **WHEN** a supervisor reports a manual finding
- **THEN** one `audit_log` entry of type `finding.reported` exists for that site
- **AND** its `actor_user_id` is the supervisor's account
- **AND** its `payload` reports a null `item_key`

#### Scenario: Photos of a finding add no entries of their own

- **WHEN** a finding with four photos is created
- **THEN** the site's chain gains one link for the finding, not five

### Requirement: Every classification and reclassification is recorded in the chain

The system SHALL append one `audit_log` entry of type `finding.classified` per
`finding_risk_assessment` row inserted. Its `payload` SHALL name `finding_id`,
`assessment_id`, `probability`, `severity`, the engine-computed `risk_level`, `control_level`,
`supersedes_id` and `reason`, so that the chain records what the risk was said to be, by whom and
why it changed.

#### Scenario: Classifying appends one entry

- **WHEN** the coordinator classifies a finding as `possible` × `moderate` with `control_level`
  `engineering`
- **THEN** one `finding.classified` entry is appended for that site
- **AND** its `payload` carries `risk_level` `medium` and `control_level` `engineering`
- **AND** its `supersedes_id` and `reason` are null

#### Scenario: Reclassifying appends a second entry that names the reason

- **GIVEN** a finding already classified
- **WHEN** the coordinator reclassifies it with a reason
- **THEN** a second `finding.classified` entry is appended
- **AND** its `payload` names the superseded assessment and the reason given
- **AND** the first entry is unchanged

#### Scenario: A rejected classification leaves no entry

- **WHEN** a classification is rejected because the account is not the HS coordinator
- **THEN** the site's chain is unchanged
