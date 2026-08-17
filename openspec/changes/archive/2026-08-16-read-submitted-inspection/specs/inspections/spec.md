## ADDED Requirements

### Requirement: A submitted inspection can be read back against the version it was written under

The system SHALL return, for a scheduled inspection that has been submitted, the record of
that submission: the template document the inspection was answered against, the answer
recorded for each `item_key`, `submitted_by`, `signed_at`, `received_at` and `answer_count`.

The document returned SHALL be the one identified by the inspection's own
`template_version_id`, never the currently published version of its template. A later
publication SHALL NOT change how an older submission reads: the questions, their order and
their wording are the ones the inspector actually answered.

An answer SHALL be returned under the same `item_key` it was submitted with, so that a
reader can pair every answer with its question without interpreting the value.

An item of the frozen document that has no answer SHALL be identifiable as unanswered
rather than reported as an empty answer. A question hidden by a condition at capture time
has no answer, and reporting it as blank would assert that the inspector left it out.

#### Scenario: The submission is returned with its answers

- **GIVEN** a scheduled inspection submitted with answers for `housekeeping.floors_clear`
  and `housekeeping.aisles_marked`
- **WHEN** the submitted inspection is read
- **THEN** the response carries the answer recorded for each of those two `item_key` values
- **AND** it carries `submitted_by`, `signed_at`, `received_at` and `answer_count`

#### Scenario: A later publication does not change an older submission

- **GIVEN** an inspection submitted against `template_version_id` of version 2
- **AND** version 5 of the same template published afterwards
- **WHEN** the submitted inspection is read
- **THEN** the document returned is the one of version 2
- **AND** the questions of version 5 that did not exist in version 2 are absent

#### Scenario: An item that was never answered is distinguishable from a blank one

- **GIVEN** an inspection whose document contains an item hidden by a condition, never
  answered
- **WHEN** the submitted inspection is read
- **THEN** that item is identifiable as having no answer
- **AND** it is not reported as an answer with an empty value

### Requirement: The read-back carries the findings the inspection opened

The system SHALL return, with a submitted inspection, the findings whose `origin` is the
inspection itself, each carrying its `item_key`, `location_id`, `description` and the count
of its `photo_object_keys`, so that a reader can see which answer opened which finding.

A finding recorded outside an inspection SHALL NOT be returned here: its `origin` is manual
and it belongs to no submission.

#### Scenario: A negative answer's finding travels with the submission

- **GIVEN** an inspection whose answer to `housekeeping.floors_clear` was negative and
  opened a finding
- **WHEN** the submitted inspection is read
- **THEN** that finding is returned with `item_key` `housekeeping.floors_clear`, its
  `location_id` and its `description`

#### Scenario: A manual finding of the same site is not part of the submission

- **GIVEN** a manual finding recorded at the same site in the same month
- **WHEN** the submitted inspection is read
- **THEN** that finding is not returned

### Requirement: The read-back states the evidence it does not return

The system SHALL NOT return image bytes or retrieval URLs for the photos of an answer or of
a finding, nor for a signature answer. It SHALL instead report how many object keys each
one carries.

This is required because the absence has to be visible: a reader who sees a finding with no
mention of its photos concludes none were taken, and a record that understates its own
evidence is worse than one that names what it is withholding.

#### Scenario: A photo answer reports its count and no image

- **GIVEN** an inspection with a `photo` answer carrying three object keys
- **WHEN** the submitted inspection is read
- **THEN** the response reports that the answer carries three photos
- **AND** no image bytes and no retrieval URL are returned

#### Scenario: A signature answer is reported without its image

- **GIVEN** an inspection with a `signature` answer
- **WHEN** the submitted inspection is read
- **THEN** the response reports that the item was signed
- **AND** no retrieval URL for the signature image is returned

### Requirement: Only a submitted inspection within the reader's scope is readable

The system SHALL refuse to return a submission for a scheduled inspection that has none, and
SHALL refuse in the same way for one the requesting session has no site scope over, so that
the refusal cannot be used to learn whether an inspection exists at a site the reader cannot
see.

Reading a submission SHALL NOT create, alter or remove any row of the submission, its
answers or its findings. The record is immutable and reading it is a read.

#### Scenario: A period that was never submitted has nothing to read

- **GIVEN** a scheduled inspection with no submission
- **WHEN** its submitted inspection is requested
- **THEN** the request is refused as not found

#### Scenario: A submission of another site is not readable

- **GIVEN** a submitted inspection at a site the session has no scope over
- **WHEN** its submitted inspection is requested
- **THEN** the request is refused as not found
- **AND** the refusal is indistinguishable from that of an inspection that does not exist

#### Scenario: Reading writes nothing

- **WHEN** a submitted inspection is read
- **THEN** no row of `inspection`, `inspection_answer` or `finding` is created, changed or
  removed
