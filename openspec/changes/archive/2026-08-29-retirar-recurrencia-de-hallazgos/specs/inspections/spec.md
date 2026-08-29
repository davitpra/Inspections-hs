## MODIFIED Requirements

### Requirement: Answers are stored as rows keyed by the stable item key

The system SHALL store one row of `inspection_answer` per answered item, with `inspection_id`,
`site_id`, `template_version_item_id`, `item_key` and `value`. It SHALL NOT store the answer set
as a single document column. `template_version_item_id` SHALL record which published row was
answered — the legal fidelity of §4 — and `item_key` SHALL record the stable identity of the
concept the question asks about, so that the same question stays recognisable across the versions
that edited it. The engine SHALL guarantee that `item_key` is the key of the referenced
`template_version_item` and that the item belongs to the inspection's `template_version_id`.
`item_key` SHALL be indexed so that resolving every answer of a site by concept does not require
reading the answers of every inspection.

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
