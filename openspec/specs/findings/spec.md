## Purpose

Records what was found wrong — derived from a negative inspection answer or entered by hand —
with the description, location and photo that make it actionable, and with the risk
classification and control hierarchy level the HS coordinator assigns to it afterwards.

## Requirements

### Requirement: Every negative answer of an accepted submission produces one finding

The system SHALL create one `finding` row for every negative answer of an accepted inspection
submission, inside the same transaction that writes the `inspection` and its
`inspection_answer` rows. A submission that is rejected for any reason SHALL leave no `finding`
row, and an accepted submission SHALL NOT be committed with a negative answer that produced no
finding.

#### Scenario: Three negative answers produce three findings

- **WHEN** a submission with 40 answers, 3 of them negative, is accepted
- **THEN** 3 `finding` rows reference the created `inspection`
- **AND** each one carries the `item_key` of the answer it was derived from

#### Scenario: A submission with no negative answer produces no finding

- **WHEN** a submission whose answers are all compliant is accepted
- **THEN** no `finding` row references the created `inspection`

#### Scenario: A rejected submission leaves no finding

- **GIVEN** a submission with two negative answers and one required item missing
- **WHEN** it is posted
- **THEN** the response carries the code `validation_failed`
- **AND** no `finding` row exists for that `client_submission_id`'s inspection

#### Scenario: A replayed submission does not duplicate findings

- **GIVEN** a submission with 3 negative answers already accepted
- **WHEN** the identical payload is posted four more times
- **THEN** the response carries `created` `false` each time
- **AND** exactly 3 `finding` rows exist for that inspection

### Requirement: What counts as a negative answer is fixed by response type

The system SHALL treat as negative exactly two answers: a `yes_no` answer whose value is
`false`, and a `yes_no_na` answer whose value is `no`. A `yes_no_na` answer of `na` SHALL NOT
produce a finding — "not applicable" is a third answer, not a failure. No `scale`, `number`,
`text`, `single_choice`, `multi_choice`, `photo` or `signature` answer SHALL produce a finding.
A failure threshold authored on a `scale` or `number` template question SHALL NOT change this:
the threshold is data the author wrote down, the engine does not read it, and an answer that
crosses it produces no finding.
An answer for an item the submission's own answers hide SHALL NOT produce a finding, because it
is not part of the answer set at all. The rule SHALL be evaluated by the same shared form engine
code on the device and on the server, so that what the inspector was asked to describe is exactly
what the server derives.

#### Scenario: `na` is not a failure

- **WHEN** a submission answers `dock.guards` — a `yes_no_na` item — with `na`
- **THEN** no `finding` row is created for `dock.guards`
- **AND** the submission is accepted without any finding details for it

#### Scenario: A low value on a scale is not a finding

- **WHEN** a submission answers a `scale` item with the lowest value of its range
- **THEN** no `finding` row is created for that item

#### Scenario: An authored threshold does not derive a finding

- **GIVEN** a template version whose `number` item declares a failure threshold of operator `gt`
  and value `80`
- **WHEN** a submission answers that item with `95`
- **THEN** no `finding` row is created for that item
- **AND** the submission is accepted without any finding details for it

#### Scenario: A hidden item produces nothing

- **GIVEN** a template version where `spill.cleanup` is visible only when `spill.present` is `yes`
- **WHEN** a submission answers `spill.present` with `no` and carries no answer for
  `spill.cleanup`
- **THEN** a finding is created for `spill.present` and none for `spill.cleanup`

#### Scenario: The device and the server agree on the same answer set

- **WHEN** the same template document and the same answer set are evaluated on the device and on
  the server
- **THEN** both report the same list of negative `item_key` values

### Requirement: A derived finding carries the dual identity of the item it came from

The system SHALL store, on every finding derived from an inspection answer, both
`template_version_item_id` — the published row that was answered, for legal fidelity — and
`item_key` — the stable concept the recurrence report groups by. The engine SHALL guarantee that
`item_key` is the key of the referenced `template_version_item`, and `item_key` SHALL be indexed
together with `site_id` so that grouping a site's findings by concept does not require reading
every finding of every inspection.

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

### Requirement: A finding carries a description, an optional resolved location and at least one photo

The system SHALL require, on every finding regardless of its origin, a `description` of at least
10 characters and at least one photo recorded as an object key. `location_id` MAY be null when
the section's organization location cannot be resolved for the finding's site. When non-null, it
SHALL name a location of the finding's own site from the closed catalogue. The engine SHALL reject
a finding whose `location_id` belongs to another site, and SHALL reject at commit a finding with no
photo. Photos SHALL be stored as object keys of files uploaded beforehand; a finding SHALL NEVER
carry image bytes.

#### Scenario: A finding is stored with all three

- **WHEN** a submission with one negative answer carrying a description, a `location_id` and two
  object keys is accepted
- **THEN** the created `finding` row carries that `description` and that `location_id`
- **AND** two `finding_photo` rows reference it, each with one object key

#### Scenario: A finding with no photo cannot be committed

- **WHEN** a `finding` row is inserted and the transaction commits without inserting any
  `finding_photo` row for it
- **THEN** the commit fails with the dedicated SQLSTATE of the deferred photo constraint

#### Scenario: A location of the other site is refused

- **GIVEN** a finding of a St. Thomas inspection
- **WHEN** its `location_id` names a location of Glencoe
- **THEN** the insert fails on the `(site_id, location_id)` foreign key
- **AND** no finding is created

#### Scenario: A description of two characters is refused

- **WHEN** a finding is submitted with the `description` `ok`
- **THEN** the request is rejected and no `finding` row is created

### Requirement: A location deactivated after the field package was prepared is still accepted for a derived finding

The system SHALL resolve a section's `organization_location_code` against the location catalogue
of the inspection's site. If no active mapping exists, the derived finding SHALL be stored with a
null `location_id` rather than inventing a location or losing the submission. A supplied non-null
`location_id` SHALL be accepted only when it resolves to the section's declared organization
location in that site. A manually entered finding MAY also omit its location; when it supplies one,
the server SHALL refuse a deactivated location.

#### Scenario: A stale catalogue does not lose an inspection

- **GIVEN** an inspection prepared while `pack-line-3` was active, and `pack-line-3` deactivated
  before the submission arrives
- **WHEN** the submission carries a finding located at `pack-line-3`
- **THEN** the submission is accepted and the finding records `pack-line-3` when its mapping still
  resolves

#### Scenario: An unmapped section leaves the finding location unresolved

- **GIVEN** a section whose organization location has no active mapping in the inspection's site
- **WHEN** a negative answer produces a finding
- **THEN** the submission is accepted and the `finding.location_id` is null

#### Scenario: A manual finding cannot use a deactivated location

- **WHEN** a manually entered finding names a `location_id` whose `deactivated_at` is not null
- **THEN** the request is rejected with the code `invalid_finding`
- **AND** no `finding` row is created

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

#### Scenario: A manual finding is outside recurrence

- **GIVEN** a site with two derived findings for `dock.guards` and one manual finding describing
  the same hazard
- **WHEN** the site's findings are grouped by `item_key`
- **THEN** the group for `dock.guards` counts 2
- **AND** the manual finding appears in no group

#### Scenario: A manual finding cannot borrow another inspection's photo

- **WHEN** a manual finding references an object key outside the prefix derived from its own
  `site_id` and its draft identifier
- **THEN** the request is rejected with the code `invalid_finding`

### Requirement: Findings are read within the reader's site scope

The system SHALL return findings only for the sites in the session's scope, enforced by the row
level security policy on `finding` and `finding_photo` and not by a `WHERE site_id` clause in the
endpoint. A listing SHALL carry, for each finding, its origin, its description, its location and
its photos. A request for a finding outside the session's scope SHALL be answered exactly as one
for a finding that does not exist.

#### Scenario: A JHSC member of one site does not see the other's findings

- **GIVEN** findings in St. Thomas and in Glencoe
- **WHEN** a JHSC member scoped to St. Thomas lists findings
- **THEN** only the St. Thomas findings are returned

#### Scenario: The coordinator sees both sites

- **WHEN** the HS coordinator, scoped to both sites, lists findings
- **THEN** findings of both sites are returned

#### Scenario: A finding of the other site is indistinguishable from a missing one

- **WHEN** a JHSC member scoped to St. Thomas requests a Glencoe finding by id
- **THEN** the response is `finding_not_found`
- **AND** the body reveals nothing about its site, location or description

#### Scenario: A listing carries no classification

- **GIVEN** a finding of the reader's site
- **WHEN** it is listed
- **THEN** the finding carries no `assessment`, `risk_level`, `probability` or `control_level`

### Requirement: A derived finding is marked with its recurrence at the moment it is created

The system SHALL write, for every finding derived from an inspection answer, exactly one
`finding_recurrence` row inside the same transaction that inserts the `finding`. The row SHALL
record `prior_count` — how many earlier findings within the window share the finding's `item_key`
and non-null `location_id` — `prior_count_site_wide` — how many share its `item_key` alone across the site
— the `window_months` used, and `first_prior_occurred_at`, the `occurred_at` of the oldest of
those earlier findings or null when there are none. `is_recurrent` SHALL be derived by the engine
as `prior_count > 0` and SHALL NOT be writable by any caller. An accepted submission SHALL NOT be
committed with a derived finding that has no `finding_recurrence` row.

#### Scenario: The fourth failure of the same item at the same place knows it is the fourth

- **GIVEN** a site with three earlier findings for `dock.guards` at `pack-line-3` inside the
  window
- **WHEN** a submission producing a fourth finding for `dock.guards` at `pack-line-3` is accepted
- **THEN** one `finding_recurrence` row references the created finding
- **AND** its `prior_count` is `3`
- **AND** its `is_recurrent` is true
- **AND** its `first_prior_occurred_at` is the `occurred_at` of the oldest of the three

#### Scenario: The first failure is marked as not recurrent, not left unmarked

- **WHEN** a submission produces the first finding ever for `exit.signage` at `shipping-bay`
- **THEN** one `finding_recurrence` row references it
- **AND** its `prior_count` is `0` and its `is_recurrent` is false

#### Scenario: The same item at a new location is recurrent site-wide only

- **GIVEN** three earlier findings for `dock.guards` at `pack-line-3` inside the window
- **WHEN** a submission produces a finding for `dock.guards` at `shipping-bay`
- **THEN** its `prior_count` is `0`
- **AND** its `prior_count_site_wide` is `3`

#### Scenario: An unresolved location still has a site-wide recurrence mark

- **GIVEN** two findings for the same `item_key` whose section has no active location mapping
- **WHEN** the second finding is accepted
- **THEN** its `finding_recurrence.location_id` is null
- **AND** its `prior_count_site_wide` counts the first finding

#### Scenario: A submission with no mark does not commit

- **WHEN** a `finding` row with a non-null `item_key` is inserted and the transaction commits
  without inserting its `finding_recurrence` row
- **THEN** the commit fails
- **AND** neither the finding nor the inspection exists

#### Scenario: The mark counts only the site's own findings

- **GIVEN** three findings for `dock.guards` at a Glencoe location inside the window
- **WHEN** a St. Thomas submission produces a finding for `dock.guards`
- **THEN** its `prior_count` and `prior_count_site_wide` are both `0`

### Requirement: The recurrence mark is a fact of the moment and is never recomputed

The system SHALL treat `finding_recurrence` as immutable: the mark records what was true when the
finding was created and SHALL NOT be updated when later findings extend the series, when a
template version is published, or when the window used by a report differs from the one stored.
Reading a finding SHALL return its stored mark. A recurrence report SHALL compute its series from
the findings themselves for the window requested, and SHALL NOT read `prior_count` to build them,
so that a report over a window of 24 months is not limited by a mark computed over 12.

#### Scenario: A later finding does not change an earlier mark

- **GIVEN** a finding whose `prior_count` is `1`
- **WHEN** two further findings of the same `item_key` and `location_id` are created afterwards
- **THEN** the first finding's `prior_count` is still `1`

#### Scenario: A mark cannot be corrected in place

- **WHEN** the application role updates any column of a `finding_recurrence` row
- **THEN** the update is rejected

#### Scenario: A report over a wider window is not capped by the stored marks

- **GIVEN** findings for `dock.guards` at `pack-line-3` occurring 3, 8 and 20 months ago, each
  marked with `window_months` `12`
- **WHEN** recurrence series are requested with `window_months` `24`
- **THEN** the series for `dock.guards` at `pack-line-3` has `occurrence_count` `3`

#### Scenario: Reading a finding returns its mark

- **WHEN** a derived finding is read by id
- **THEN** the response carries its `prior_count`, `prior_count_site_wide`, `window_months`,
  `first_prior_occurred_at` and `is_recurrent`

### Requirement: A manually entered finding carries no recurrence mark

The system SHALL NOT create a `finding_recurrence` row for a finding whose `item_key` is null, and
SHALL report such a finding's recurrence as absent rather than as false. Without a stable item
concept there is no series to belong to, and reporting `is_recurrent` false would assert that the
hazard was checked against the history when it was not.

#### Scenario: A manual finding has no mark

- **WHEN** a supervisor reports a manual finding
- **THEN** no `finding_recurrence` row references it
- **AND** reading it returns its recurrence as null, not as `is_recurrent` false

#### Scenario: A mark cannot be attached to a finding without an item key

- **WHEN** a `finding_recurrence` row is inserted for a finding whose `item_key` is null
- **THEN** the insert fails on the engine's constraint

#### Scenario: A finding cannot carry two marks

- **WHEN** a second `finding_recurrence` row is inserted for a finding that already has one
- **THEN** the insert fails with a unique violation on `finding_id`
