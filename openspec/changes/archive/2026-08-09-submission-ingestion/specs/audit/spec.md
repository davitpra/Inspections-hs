## ADDED Requirements

### Requirement: An accepted submission is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `inspection.submitted` for every
`inspection` row that is created, written by a database trigger rather than by application code,
in the same transaction as the insert. Its `payload` SHALL name `inspection_id`,
`scheduled_inspection_id`, `site_id`, `template_version_id`, `client_submission_id`,
`submitted_by` and `answer_count`. Its `occurred_at` SHALL be the `signed_at` reported by the
device and its `recorded_at` SHALL be the server clock, so that an inspection captured offline
days earlier is not recorded as having happened when the network returned.

#### Scenario: Accepting a submission appends one entry

- **WHEN** a submission is accepted
- **THEN** one new `audit_log` entry exists for the inspection's site with `event_type`
  `inspection.submitted`
- **AND** its `payload` names the created `inspection_id` and its `client_submission_id`
- **AND** its `actor_user_id` is the account that submitted

#### Scenario: The entry keeps the device clock apart from the server clock

- **GIVEN** a submission signed on the device at `2026-08-03T14:20:00-04:00` and received on
  2026-08-09
- **WHEN** it is accepted
- **THEN** the entry's `occurred_at` is `2026-08-03T14:20:00-04:00`
- **AND** its `recorded_at` is the server time of the accepting transaction

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** an `inspection` row is inserted directly, without going through the endpoint
- **THEN** the `inspection.submitted` entry is still appended

### Requirement: Answers add no entries of their own

The system SHALL NOT write an audit entry per answer. One inspection of two hundred items SHALL
add one link to the chain of its site, not two hundred. The answers themselves are already
protected: they live in a table no role can modify.

#### Scenario: An inspection with many answers adds one link

- **GIVEN** a site whose chain has `seq` `120` as its last entry
- **WHEN** a submission with 200 answers is accepted
- **THEN** the last entry of that site's chain is `seq` `121`
- **AND** it is the `inspection.submitted` entry of that inspection

### Requirement: A replayed submission adds no link to the chain

The system SHALL NOT append an audit entry when a submission is recognised as a replay of an
already accepted `client_submission_id`. The chain records what happened, and nothing happened.

#### Scenario: Replaying leaves the chain unchanged

- **GIVEN** a submission already accepted, whose site's chain ends at `seq` `121`
- **WHEN** the identical payload is posted five more times, each returning `created` `false`
- **THEN** the site's chain still ends at `seq` `121`
- **AND** the chain verifies as intact

### Requirement: A rejected submission leaves no entry

The system SHALL leave the chain untouched when a submission is rejected for any reason —
validation, a version mismatch, an inspection already submitted, or an account that is not the
assigned inspector. The audit log records accepted records, and a rejected submission produced
none.

#### Scenario: A validation failure appends nothing

- **GIVEN** a site whose chain ends at `seq` `121`
- **WHEN** a submission missing a required answer is rejected
- **THEN** the site's chain still ends at `seq` `121`

#### Scenario: The chain still verifies after a run of rejections

- **WHEN** twenty invalid submissions are rejected in a row
- **THEN** verifying the site's chain reports no broken link
