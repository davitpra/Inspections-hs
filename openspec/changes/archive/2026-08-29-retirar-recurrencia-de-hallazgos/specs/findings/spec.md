## MODIFIED Requirements

### Requirement: A derived finding carries the dual identity of the item it came from

The system SHALL store, on every finding derived from an inspection answer, both
`template_version_item_id` — the published row that was answered, for legal fidelity — and
`item_key` — the stable identity of the concept the question asks about. The engine SHALL
guarantee that `item_key` is the key of the referenced `template_version_item`, and `item_key`
SHALL be indexed together with `site_id` so that resolving a site's findings by concept does not
require reading every finding of every inspection.

#### Scenario: The same question failing in two template versions groups under one key

- **GIVEN** two accepted inspections of the same site, one against version `2` and one against
  version `3` of a template, both answering `dock.guards` negatively
- **WHEN** that site's findings are grouped by `item_key`
- **THEN** both rows fall in the same group
- **AND** their `template_version_item_id` values differ

#### Scenario: A finding cannot claim an item key that is not the referenced item's

- **WHEN** a `finding` row is inserted whose `item_key` is not the `item_key` of its
  `template_version_item_id`
- **THEN** the insert fails with a foreign key violation on the
  `(template_version_item_id, item_key)` pair

#### Scenario: The exact question asked is still resolvable

- **WHEN** a finding derived from version `2` is read back through its
  `template_version_item_id`
- **THEN** the `prompt`, `section_key`, `position` and `response_type` of version `2` are
  returned, not those of the current version

### Requirement: A finding can be entered by hand and then has no item key

The system SHALL accept a manually entered finding — a hazard seen outside an inspection — from a
supervisor, manager or the HS coordinator, carrying its site, description, location and photos. A
manually entered finding SHALL have `inspection_id`,
`template_version_item_id` and `item_key` all null, and a derived finding SHALL have all three
set; the engine SHALL enforce that exactly one of the two origins holds. A manually entered
finding SHALL therefore be absent from any grouping by `item_key`, which is the accepted
consequence recorded in §4 and risk F.

#### Scenario: A supervisor reports a hazard seen outside an inspection

- **WHEN** a supervisor posts a finding with a site, a description, a `location_id` and one object
  key
- **THEN** a `finding` row is created with `origin` `manual`
- **AND** its `inspection_id`, `template_version_item_id` and `item_key` are null
- **AND** no classification is stored for it

#### Scenario: A half-derived finding cannot exist

- **WHEN** a `finding` row is inserted with an `inspection_id` but no `item_key`
- **THEN** the insert fails on the origin check constraint

#### Scenario: A manual finding is outside every grouping by concept

- **GIVEN** a site with two derived findings for `dock.guards` and one manual finding describing
  the same hazard
- **WHEN** the site's findings are grouped by `item_key`
- **THEN** the group for `dock.guards` counts 2
- **AND** the manual finding appears in no group

#### Scenario: A manual finding cannot borrow another inspection's photo

- **WHEN** a manual finding references an object key outside the prefix derived from its own
  `site_id` and its draft identifier
- **THEN** the request is rejected with the code `invalid_finding`

## REMOVED Requirements

### Requirement: A derived finding is marked with its recurrence at the moment it is created

**Reason**: The recurrence mark is retired with the report that gave it meaning; it was never displayed on any screen.

**Migration**: Remove the write from the ingestion transaction and drop `finding_recurrence` in a forward migration. Derived findings keep their dual identity, which is what made the mark computable in the first place.

### Requirement: The recurrence mark is a fact of the moment and is never recomputed

**Reason**: There is no mark to freeze or to contrast with a recomputed series.

**Migration**: Remove the `recurrence` field from the finding contract. Immutability of the surviving findings model is unchanged.

### Requirement: A manually entered finding carries no recurrence mark

**Reason**: With no mark, the distinction between an absent mark and a mark that says "first time" has nothing to express.

**Migration**: The fact it protected survives as a scenario of "A finding can be entered by hand and then has no item key": a manual finding is absent from any grouping by concept.
