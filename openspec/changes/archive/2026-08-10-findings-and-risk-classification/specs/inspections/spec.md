## ADDED Requirements

### Requirement: A submission carries the finding details of every negative answer

The system SHALL accept, alongside `answers` and `photos`, a `findings` block of the submission
payload keyed by `item_key`, each entry carrying `description`, `location_id` and
`photo_object_keys`. The system SHALL reject with `validation_failed` a submission whose set of
`findings` keys is not exactly the set of its negative answers: a negative answer with no entry
SHALL produce a violation of code `finding_missing` for its `item_key`, and an entry for an answer
that is not negative SHALL produce a violation of code `unexpected_finding`. These violations
SHALL be reported together with every other violation of the submission, in one response, and
SHALL leave no `inspection`, `inspection_answer`, `finding` row or audit entry behind.

#### Scenario: A negative answer with no finding details is refused

- **GIVEN** a submission whose answer for `dock.guards` is `false`
- **WHEN** it carries no `findings` entry for `dock.guards`
- **THEN** the response carries the code `validation_failed` and a violation with `item_key`
  `dock.guards` and code `finding_missing`
- **AND** no `inspection` row exists for that `client_submission_id`

#### Scenario: Finding details for a compliant answer are refused

- **WHEN** a submission carries a `findings` entry for an item answered `true`
- **THEN** the response carries a violation of code `unexpected_finding` for that `item_key`

#### Scenario: Finding details for an item that is not in the document are refused

- **WHEN** a submission carries a `findings` entry whose `item_key` is not an item of the bound
  `template_version`
- **THEN** the response carries a violation of code `unknown_item` for that `item_key`

#### Scenario: Missing details are reported with every other violation

- **GIVEN** a submission with two negative answers lacking their details and one required item
  missing
- **WHEN** it is posted
- **THEN** the response lists three violations, not one

#### Scenario: A complete submission is accepted and its findings are written

- **WHEN** a submission carries a `findings` entry for each of its 3 negative answers, each with
  a description, a `location_id` of the inspection's site and at least one object key
- **THEN** the submission is accepted
- **AND** 3 `finding` rows reference the created `inspection`

### Requirement: Findings are derived inside the ingestion transaction

The system SHALL derive the findings of a submission in the same transaction that inserts the
`inspection` and the `inspection_answer` rows, before it commits, and SHALL NOT defer the
derivation to a background job, a queue or an event handler. A failure at any point of the
ingestion SHALL leave neither an inspection without its findings nor findings without their
inspection.

#### Scenario: An inspection and its findings commit together

- **WHEN** a submission with negative answers is accepted
- **THEN** the `inspection`, its `inspection_answer` rows and its `finding` rows are all visible
  as of the same transaction
- **AND** no queued job is required for the findings to exist

#### Scenario: A failure while writing findings loses the whole submission

- **GIVEN** a submission whose second finding violates a database constraint
- **WHEN** it is posted
- **THEN** no `inspection` row is created
- **AND** the device can retry with the same `client_submission_id`

#### Scenario: An inspection is never left without the findings its answers imply

- **WHEN** the accepted inspections of a site are compared with their negative answers
- **THEN** every negative answer of every accepted inspection has exactly one finding

## MODIFIED Requirements

### Requirement: A submission carries object keys, never bytes, and only its own

The system SHALL accept photo and signature answers as object keys of files already uploaded
before the submission, merge the keys reported in `photos` into the answer set under their
`item_key` before validating, and reject any submission whose payload references an object key
outside the prefix derived from its own `site_id` and `scheduled_inspection_id`. The
`photo_object_keys` of the `findings` block SHALL be held to the same prefix rule, and SHALL NOT
be merged into the answer set: they are the photos of the finding, not the answer to a photo item,
and merging them would collide with the answer of the very item they belong to.

#### Scenario: Uploaded photo keys satisfy a photo item

- **GIVEN** a template version with a photo item `dock.guards.photo` requiring at least one photo
- **WHEN** a submission carries no answer for `dock.guards.photo` but reports one object key for
  it under `photos`
- **THEN** the submission is accepted
- **AND** the stored `inspection_answer` for `dock.guards.photo` carries that object key

#### Scenario: A key belonging to another inspection is refused

- **WHEN** a submission references an object key whose prefix names another
  `scheduled_inspection_id`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row is created

#### Scenario: A finding photo of another inspection is refused

- **WHEN** a `findings` entry reports a `photo_object_keys` value outside the prefix of its own
  `site_id` and `scheduled_inspection_id`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` and no `finding` row is created

#### Scenario: A finding photo does not become the answer to its item

- **GIVEN** a `yes_no` item `dock.guards` answered `false` with two finding photos
- **WHEN** the submission is accepted
- **THEN** the `inspection_answer` for `dock.guards` holds the boolean `false`
- **AND** the two object keys are held by `finding_photo` rows of its finding

#### Scenario: A payload carrying image bytes is refused

- **WHEN** a submission carries a base64 blob in place of an object key for a photo item
- **THEN** the request is rejected before any row is written
