## Purpose

Defines how inspection templates are modelled, versioned and frozen on publication, and
guarantees that a question keeps one stable identity across successive template versions so
that recurring findings for the same question form a single historical series instead of one
series per edit.

## Requirements

### Requirement: A template version is a frozen document

The system SHALL store every published template version as an immutable JSONB document in
`template_version.document`, together with `template_id`, a monotonic `version` integer and a
`published_at` timestamp. A published version SHALL NOT be modifiable or removable by any role:
correcting a template means publishing a new version.

#### Scenario: Published document cannot be updated by the application role

- **WHEN** a session connected as the application role runs
  `UPDATE template_version SET document = '{}'::jsonb WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `document` is unchanged when read back

#### Scenario: Published document cannot be updated by the owner role

- **WHEN** a session connected as the migration role — which owns the table — runs
  `UPDATE template_version SET document = '{}'::jsonb WHERE id = <existing id>`
- **THEN** the statement fails with the immutability trigger's dedicated SQLSTATE, not with a
  privilege error

#### Scenario: Version numbers are unique per template and monotonic

- **WHEN** a second row is inserted with the same `template_id` and the same `version` as an
  existing row
- **THEN** the insert fails with a unique violation on `(template_id, version)`

#### Scenario: A version cannot skip or reuse a number

- **WHEN** a row is inserted for a `template_id` whose highest existing `version` is `2` and the
  new row declares `version` `4`
- **THEN** the insert is rejected because the next version of a template must be exactly one
  greater than its current highest version

### Requirement: The document conforms to a shared schema

The system SHALL validate every template document against a single shared schema definition
that lists, for each item, its `item_key`, `prompt`, `section_key`, `section_title`, `position`
and `response_type`. `response_type` SHALL be one of `yes_no`, `scale`, `text` or `number`. Any
document that does not conform SHALL be rejected at load time rather than at inspection time.

#### Scenario: A malformed seed document fails the build

- **WHEN** the validation suite parses every template document shipped as a seed
- **AND** one document declares an item with no `item_key`
- **THEN** validation fails and reports the offending template and item

#### Scenario: An unknown response type is rejected

- **WHEN** a document declares an item with `response_type` `"signature"`
- **THEN** validation fails and names `response_type` as the offending field

#### Scenario: Duplicate positions within a section are rejected

- **WHEN** a document declares two items in the same `section_key` with the same `position`
- **THEN** validation fails and names the section and the duplicated `position`

### Requirement: Every item in a published version exists as a queryable row

The system SHALL, on publication of a template version, derive one `template_version_item` row
per item in the document. Deriving these rows SHALL NOT depend on application code: a document
that has been stored and an item set that has not been derived MUST be an impossible state.

#### Scenario: Rows appear for every item of the document

- **WHEN** a `template_version` row is inserted whose `document` declares 7 items
- **THEN** 7 `template_version_item` rows exist for that `template_version_id`
- **AND** each row carries the `item_key`, `prompt`, `section_key`, `section_title`, `position`
  and `response_type` of the corresponding item in the document

#### Scenario: Derived item rows are immutable

- **WHEN** a session connected as the application role runs
  `UPDATE template_version_item SET prompt = 'edited' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: Derived item rows cannot be deleted

- **WHEN** a session connected as the application role runs
  `DELETE FROM template_version_item WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

### Requirement: An item carries two separate identifiers

The system SHALL give every `template_version_item` row two distinct identifiers that serve two
distinct purposes:

- `id` — the identity of that concrete row inside that published version. It is what a finding
  or a response points at for legal fidelity: which question was asked, with that exact
  wording, in that section, with that response type, on the day it was answered.
- `item_key` — the identity of the concept, assigned once when the item is first created. It is
  the grouping key for recurrence analytics.

The two SHALL NOT be conflated: `id` changes with every version that contains the item,
`item_key` does not.

#### Scenario: The same concept in two versions has different row ids

- **WHEN** an item with `item_key` `guards.packaging-lines` appears in version 1 and in version
  2 of the same template
- **THEN** the two `template_version_item` rows have different `id` values
- **AND** both rows have `item_key` `guards.packaging-lines`

#### Scenario: An item row always resolves to a registered concept

- **WHEN** a `template_version` document declares an item whose `item_key` is not registered in
  `template_item`
- **THEN** the insert is rejected with a foreign key violation on `item_key`

### Requirement: item_key survives every kind of edit

The system SHALL preserve an item's `item_key` when a new version changes that item's wording,
moves it to a different section, changes its position, or changes its response type. Only a
conceptually new question SHALL receive a new `item_key`.

#### Scenario: Rewording preserves the key

- **WHEN** version 2 declares the item with `prompt` `"Are machine guards in place and secured
  on all packaging lines?"` where version 1 declared `"Machine guards present?"`, under the same
  `item_key`
- **THEN** the version 2 `template_version_item` row has the new `prompt`
- **AND** its `item_key` equals the version 1 row's `item_key`

#### Scenario: Moving the item to another section preserves the key

- **WHEN** version 2 declares the item with `section_key` `machine-safety` where version 1
  declared `section_key` `general`
- **THEN** the version 2 row has `section_key` `machine-safety`
- **AND** its `item_key` equals the version 1 row's `item_key`

#### Scenario: Reordering preserves the key

- **WHEN** version 2 declares the item with `position` `1` where version 1 declared `position` `4`
- **THEN** the version 2 row has `position` `1`
- **AND** its `item_key` equals the version 1 row's `item_key`

#### Scenario: Changing the response type preserves the key

- **WHEN** version 3 declares the item with `response_type` `scale` where version 2 declared
  `response_type` `yes_no`
- **THEN** the version 3 row has `response_type` `scale`
- **AND** its `item_key` equals the version 2 row's `item_key`

### Requirement: item_key is immutable and never recycled

The system SHALL treat `item_key` as write-once. An existing `item_key` SHALL NOT be updated,
and a retired `item_key` SHALL NOT be reassigned to a different question.

#### Scenario: Updating a registered key is rejected

- **WHEN** any role runs
  `UPDATE template_item SET item_key = 'guards.line-3' WHERE item_key = 'guards.packaging-lines'`
- **THEN** the statement fails and the stored `item_key` is unchanged when read back

#### Scenario: Reusing a key for a second concept is rejected

- **WHEN** a second `template_item` row is inserted with an `item_key` that already exists
- **THEN** the insert fails with a unique violation on `item_key`

### Requirement: Items are deactivated, never deleted

The system SHALL retire an item by setting `template_item.deactivated_at` rather than by
deleting it. A deactivated item SHALL be absent from newly published versions but SHALL still
resolve as a reference from historical records, so its recurrence series ends instead of
breaking.

#### Scenario: A deactivated item still resolves from history

- **WHEN** `deactivated_at` is set on the `template_item` row for `guards.packaging-lines`
- **THEN** the `template_version_item` rows of already published versions still resolve that
  `item_key`
- **AND** a query grouping historical findings by `item_key` still returns the series for
  `guards.packaging-lines`

#### Scenario: A deactivated item is rejected in a new version

- **WHEN** a new `template_version` document declares an item whose `template_item` has a
  non-null `deactivated_at`
- **THEN** the insert is rejected and the error names the deactivated `item_key`

### Requirement: Splits and merges record their lineage

The system SHALL provide `template_item.replaces_item_key` so that an item created by splitting
or merging earlier items records which key it descends from. When set, it SHALL reference a
registered `item_key`. The system SHALL NOT silently join the series of a replacing item to the
series of the key it replaces: the lineage is a recorded trace, not an aliasing rule.

#### Scenario: A split records its origin

- **WHEN** `guards.line-3` is registered with `replaces_item_key` `guards.packaging-lines`
- **THEN** the stored row carries that `replaces_item_key`
- **AND** grouping findings by `item_key` reports `guards.line-3` and `guards.packaging-lines`
  as two separate series

#### Scenario: Lineage cannot point at an unregistered key

- **WHEN** a `template_item` row is inserted with `replaces_item_key` `guards.nonexistent`
- **THEN** the insert fails with a foreign key violation

### Requirement: Recurrence across three versions returns one series

The system SHALL keep a question's history contiguous across successive versions that edit it.
Grouping findings by `item_key` over a template whose item was rewritten, moved, reordered and
had its response type changed SHALL return one series covering every finding, not one series
per version.

This is the acceptance test of risk A in `docs/Requisitos_V1.2.md` §5 and runs in CI.

#### Scenario: v1 to v3 yields a single series of four

- **WHEN** version 1 of a template declares item `guards.packaging-lines` in section `general`
  at `position` 4 with `response_type` `yes_no`, and 1 finding is recorded against it
- **AND** version 2 rewords that item, moves it to section `machine-safety`, sets `position` 1,
  keeps the same `item_key`, and 2 findings are recorded against it
- **AND** version 3 changes its `response_type` to `scale`, keeps the same `item_key`, and 1
  finding is recorded against it
- **THEN** a query grouping findings by `item_key` returns exactly one row for
  `guards.packaging-lines` with a count of 4
- **AND** it does not return three rows with counts 1, 2 and 1

#### Scenario: Each finding still resolves the exact question that was asked

- **WHEN** the four findings of the previous scenario are read back through their
  `template_version_item_id`
- **THEN** the finding from version 1 resolves `prompt`, `section_key`, `position` and
  `response_type` as they were declared in version 1
- **AND** the finding from version 3 resolves `response_type` `scale`

### Requirement: Templates are loaded from versioned seed files

The system SHALL load the initial templates from SQL seed files kept under version control,
runnable independently of the migration sequence and safe to run more than once. No editing
interface is required to put a usable template into the system.

#### Scenario: Seeding twice leaves one copy

- **WHEN** the seed command runs against a database that already contains the seeded templates
- **THEN** it completes without error
- **AND** the number of `template`, `template_version` and `template_version_item` rows is
  unchanged

#### Scenario: A seeded template is complete and queryable

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** at least one `template` row exists with a published `template_version`
- **AND** every item of that version's document has a matching `template_version_item` row whose
  `item_key` is registered in `template_item`
