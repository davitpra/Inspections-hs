## MODIFIED Requirements

### Requirement: A finding can be entered by hand and then has no item key

The system SHALL accept a manually entered finding — a hazard seen outside an inspection — from an
`hs_coordinator` or a `management` account, carrying its site, description, location and photos, and
SHALL refuse it from a `jhsc_member`, whose findings reach the system through the inspection they
carried out. A manually entered finding SHALL have `inspection_id`,
`template_version_item_id` and `item_key` all null, and a derived finding SHALL have all three
set; the engine SHALL enforce that exactly one of the two origins holds. A manually entered
finding SHALL therefore be absent from any grouping by `item_key`, which is the accepted
consequence recorded in §4 and risk F.

#### Scenario: A manager reports a hazard seen outside an inspection

- **WHEN** a `management` account posts a finding with a site, a description, a `location_id` and
  one object key
- **THEN** a `finding` row is created with `origin` `manual`
- **AND** its `inspection_id`, `template_version_item_id` and `item_key` are null
- **AND** no classification is stored for it

#### Scenario: A JHSC member cannot enter a finding by hand

- **WHEN** an account whose `role` is `jhsc_member` posts a manual finding
- **THEN** the request is refused
- **AND** no `finding` row is created

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
