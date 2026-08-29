## MODIFIED Requirements

### Requirement: An item carries two separate identifiers

The system SHALL give every `template_version_item` row two distinct identifiers that serve two
distinct purposes:

- `id` — the identity of that concrete row inside that published version. It is what a finding
  or a response points at for legal fidelity: which question was asked, with that exact
  wording, in that section, with that response type, on the day it was answered.
- `item_key` — the identity of the concept, assigned once when the item is first created. It is
  what makes the same question recognisable across every version that edits it.

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

### Requirement: Items are deactivated, never deleted

The system SHALL retire an item by setting `template_item.deactivated_at` rather than by
deleting it. A deactivated item SHALL be absent from newly published versions but SHALL still
resolve as a reference from historical records, so the history of that concept ends instead of
breaking.

#### Scenario: A deactivated item still resolves from history

- **WHEN** `deactivated_at` is set on the `template_item` row for `guards.packaging-lines`
- **THEN** the `template_version_item` rows of already published versions still resolve that
  `item_key`
- **AND** a query grouping historical findings by `item_key` still returns them under
  `guards.packaging-lines`

#### Scenario: A deactivated item is rejected in a new version

- **WHEN** a new `template_version` document declares an item whose `template_item` has a
  non-null `deactivated_at`
- **THEN** the insert is rejected and the error names the deactivated `item_key`

## REMOVED Requirements

### Requirement: Recurrence across three versions returns one series

**Reason**: The requirement was stated in terms of a recurrence report that no longer exists. The property it protected — a question's history staying contiguous across the versions that edit it — is the reason the dual identity exists and is restated below as its own requirement.

**Migration**: None at the schema level. The spike 3 acceptance test keeps running in CI with the grouping written inside the test rather than borrowed from a product query.

## ADDED Requirements

### Requirement: A question's identity survives three versions of edits

The system SHALL keep a question's identity contiguous across successive versions that edit it.
Grouping findings by `item_key` over a template whose item was rewritten, moved, reordered and had
its response type changed SHALL return one group covering every finding, not one group per
version, while each finding SHALL still resolve the exact question that was asked.

This is the acceptance test of risk A in `docs/Requisitos_V1.2.md` §5 and runs in CI. It asserts a
property of the schema, not the behaviour of a product surface: the grouping is written by the
test itself.

#### Scenario: v1 to v3 yields a single group of four

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
