## ADDED Requirements

### Requirement: A submitted inspection freezes what was inspected, by whom, and against which version

The system SHALL store every accepted submission as one row of `inspection` carrying `site_id`,
`scheduled_inspection_id`, `template_version_id`, `client_submission_id`, `submitted_by`,
`signed_at`, `received_at` and `answer_count`. `signed_at` SHALL be the device clock reported in
the payload and `received_at` SHALL be assigned by the engine. `template_version_id` SHALL equal
the `template_version_id` the scheduled inspection is bound to, and the engine SHALL reject any
row where it does not, so that a submission can never be recorded against a version the inspector
was not given.

#### Scenario: An accepted submission records both clocks

- **WHEN** a submission with `signed_at` `2026-08-03T14:20:00-04:00` is accepted on 2026-08-09
- **THEN** the created `inspection` row reports `signed_at` `2026-08-03T14:20:00-04:00`
- **AND** `received_at` is the server time of the accepting transaction, not the device time

#### Scenario: A submission naming another version of the same template is refused

- **GIVEN** a scheduled inspection bound to version `2` of a template, and version `3` published
- **WHEN** a submission for that scheduled inspection is posted with `template_version_id` of
  version `3`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row exists for that `client_submission_id`

#### Scenario: The engine refuses a mismatched version even outside the endpoint

- **WHEN** a row is inserted directly into `inspection` whose `template_version_id` differs from
  the `template_version_id` of its `scheduled_inspection_id`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE
- **AND** no row is present when read back

### Requirement: A submission is idempotent by client submission id

The system SHALL treat `client_submission_id` as the idempotency key of the whole system.
Re-posting a payload whose `client_submission_id` already exists SHALL return the existing record
with the same HTTP status and the same response shape as the first acceptance, distinguished only
by `created` being `false`, and SHALL NOT create a second `inspection`, write a second set of
answers, or append a second audit entry. Uniqueness SHALL be enforced by a unique index on
`inspection.client_submission_id` rather than by a check performed before the insert, so that two
concurrent posts of the same identifier converge on one row.

#### Scenario: Re-posting the same submission returns the existing record

- **GIVEN** a submission already accepted with `client_submission_id` `C`
- **WHEN** the identical payload is posted again
- **THEN** the response carries the same `id`, `scheduled_inspection_id`, `template_version_id`,
  `submitted_at` and `submitted_by` as the first response
- **AND** `created` is `false`
- **AND** the response status is the one the first acceptance returned, not `409`

#### Scenario: A replay adds no rows and no audit entry

- **GIVEN** a submission already accepted with `client_submission_id` `C` and 40 answers
- **WHEN** the identical payload is posted three more times
- **THEN** exactly one `inspection` row exists with `client_submission_id` `C`
- **AND** exactly 40 rows of `inspection_answer` reference it
- **AND** exactly one `audit_log` entry of type `inspection.submitted` names it

#### Scenario: Two concurrent posts of the same identifier create one record

- **WHEN** two requests carrying the same `client_submission_id` are posted concurrently
- **THEN** both receive a successful response naming the same `inspection.id`
- **AND** exactly one `inspection` row exists for that `client_submission_id`

### Requirement: A scheduled inspection accepts exactly one submission

The system SHALL allow at most one `inspection` per `scheduled_inspection_id`, enforced by a
unique index. A submission carrying a `client_submission_id` that does not exist yet, for a
scheduled inspection that already has one, SHALL be rejected with the code `already_submitted`
rather than accepted as a second record: one owner, one device, one signer. Correcting an accepted
inspection SHALL NOT be done by submitting again.

#### Scenario: A second submission from a different draft is refused

- **GIVEN** a scheduled inspection with an accepted submission for `client_submission_id` `C1`
- **WHEN** a submission for the same `scheduled_inspection_id` is posted with
  `client_submission_id` `C2`
- **THEN** the request is rejected with the code `already_submitted`
- **AND** exactly one `inspection` row exists for that `scheduled_inspection_id`
- **AND** the row is the one created for `C1`

#### Scenario: A cancelled scheduled inspection accepts nothing

- **GIVEN** a scheduled inspection whose `cancelled_at` is set
- **WHEN** a submission for it is posted
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** the message states that the inspection was cancelled

### Requirement: Answers are validated against the frozen template version and a rejection leaves nothing behind

The system SHALL validate the submitted answers against the document of the
`template_version` the scheduled inspection is bound to, using the same shared form engine the
device used, and SHALL reject a submission that produces any violation with the code
`validation_failed` and the full list of violations, each naming its `item_key` and its violation
code. A rejected submission SHALL leave no `inspection` row, no `inspection_answer` row and no
audit entry: the whole ingestion is one transaction that either commits entirely or not at all.

#### Scenario: A missing required answer rejects the whole submission

- **GIVEN** a template version with a required item `dock.guards` and 39 other answered items
- **WHEN** a submission omits `dock.guards`
- **THEN** the response carries the code `validation_failed` and a violation with `item_key`
  `dock.guards` and code `required_missing`
- **AND** no `inspection` row exists for that `client_submission_id`
- **AND** no `inspection_answer` row was written for any of the 39 valid answers

#### Scenario: All violations are reported at once

- **WHEN** a submission has three items with answers of the wrong shape and one required item
  missing
- **THEN** the response lists four violations, not one

#### Scenario: An answer for an item the document does not contain is refused

- **WHEN** a submission carries an answer whose `item_key` is not an item of the bound
  `template_version`
- **THEN** the response carries the code `validation_failed` with a violation of code
  `unknown_item` for that `item_key`

#### Scenario: An answer for an item its own answers hide is refused

- **GIVEN** a template version where `spill.cleanup` is visible only when `spill.present` is `yes`
- **WHEN** a submission answers `spill.present` with `no` and also carries an answer for
  `spill.cleanup`
- **THEN** the response carries a violation of code `answer_for_hidden_item` for `spill.cleanup`

### Requirement: Answers are stored as rows keyed by the stable item key

The system SHALL store one row of `inspection_answer` per answered item, with `inspection_id`,
`site_id`, `template_version_item_id`, `item_key` and `value`. It SHALL NOT store the answer set
as a single document column. `template_version_item_id` SHALL record which published row was
answered — the legal fidelity of §4 — and `item_key` SHALL record the stable concept the
recurrence report groups by. The engine SHALL guarantee that `item_key` is the key of the
referenced `template_version_item` and that the item belongs to the inspection's
`template_version_id`. `item_key` SHALL be indexed so that grouping every answer of a site by
concept does not require reading the answers of every inspection.

#### Scenario: One row per answered item

- **WHEN** a submission with 40 answers is accepted
- **THEN** 40 rows of `inspection_answer` reference the created `inspection`
- **AND** each row carries the `item_key` of the item it answers and the
  `template_version_item_id` of that item within the bound version

#### Scenario: The same item answered in two versions groups under one key

- **GIVEN** two accepted inspections of the same site, one against version `2` and one against
  version `3` of a template, both answering the item whose `item_key` is `dock.guards`
- **WHEN** the answers of that site are grouped by `item_key`
- **THEN** both rows fall in the same group
- **AND** their `template_version_item_id` values differ

#### Scenario: An answer cannot name an item of another version

- **WHEN** a row is inserted into `inspection_answer` whose `template_version_item_id` belongs to
  a `template_version` other than the one of its `inspection`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE

#### Scenario: An answer cannot claim an item key that is not the referenced item's

- **WHEN** a row is inserted into `inspection_answer` whose `item_key` is not the `item_key` of
  its `template_version_item_id`
- **THEN** the insert fails with a foreign key violation on the
  `(template_version_item_id, item_key)` pair

#### Scenario: The same item cannot be answered twice in one inspection

- **WHEN** a second `inspection_answer` row is inserted with an `item_key` already present for
  that `inspection_id`
- **THEN** the insert fails with a unique violation

### Requirement: A submission carries object keys, never bytes, and only its own

The system SHALL accept photo and signature answers as object keys of files already uploaded
before the submission, merge the keys reported in `photos` into the answer set under their
`item_key` before validating, and reject any submission whose payload references an object key
outside the prefix derived from its own `site_id` and `scheduled_inspection_id`.

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

#### Scenario: A payload carrying image bytes is refused

- **WHEN** a submission carries a base64 blob in place of an object key for a photo item
- **THEN** the request is rejected before any row is written

### Requirement: Only the assigned inspector submits, and only within their site scope

The system SHALL accept a submission only from the account named as `inspector_id` of the
scheduled inspection, and SHALL record that account as `submitted_by`. A submission for a
scheduled inspection outside the session's site scope SHALL be answered exactly as one for a
scheduled inspection that does not exist, so that the endpoint cannot be used to learn what the
other site is inspecting.

#### Scenario: An account that is not the assigned inspector is refused

- **GIVEN** a scheduled inspection assigned to inspector A
- **WHEN** inspector B of the same site posts a submission for it
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `inspection` row is created

#### Scenario: A scheduled inspection with no inspector accepts nothing

- **GIVEN** a scheduled inspection whose `inspector_id` is `NULL`
- **WHEN** any account posts a submission for it
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Another site's inspection is indistinguishable from a missing one

- **GIVEN** a scheduled inspection of Glencoe
- **WHEN** an inspector whose scope is only St. Thomas posts a submission for it
- **THEN** the response carries the code `inspection_not_found`
- **AND** the response body reveals nothing about the site, period or template of that inspection

#### Scenario: The submitter is taken from the session, not from the payload

- **WHEN** a submission is accepted
- **THEN** `inspection.submitted_by` is the account of the authenticated session
- **AND** no field of the request payload can set it
