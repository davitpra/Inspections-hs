## Purpose

Records what was found wrong — derived from a negative inspection answer or entered by hand —
with the description, location and photo that make it actionable, and with the risk
classification and control hierarchy level the HS coordinator assigns to it afterwards.

## ADDED Requirements

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

### Requirement: A finding carries a description, a location and at least one photo

The system SHALL require, on every finding regardless of its origin, a `description` of at least
10 characters, a `location_id` naming a location of the finding's own site from the closed
catalogue, and at least one photo recorded as an object key. The engine SHALL reject a finding
whose `location_id` belongs to another site, and SHALL reject at commit a finding with no photo.
Photos SHALL be stored as object keys of files uploaded beforehand; a finding SHALL NEVER carry
image bytes.

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

The system SHALL accept a derived finding whose `location_id` names a location deactivated after
the inspection's field package was prepared, because the catalogue on the device was current when
the inspector stood in front of the hazard, and refusing it would turn an administrative edit into
a lost inspection. The system SHALL refuse a deactivated `location_id` on a manually entered
finding, which is reported online against a current list.

#### Scenario: A stale catalogue does not lose an inspection

- **GIVEN** an inspection prepared while `pack-line-3` was active, and `pack-line-3` deactivated
  before the submission arrives
- **WHEN** the submission carries a finding located at `pack-line-3`
- **THEN** the submission is accepted and the finding records `pack-line-3`

#### Scenario: A manual finding cannot use a deactivated location

- **WHEN** a manually entered finding names a `location_id` whose `deactivated_at` is not null
- **THEN** the request is rejected with the code `invalid_finding`
- **AND** no `finding` row is created

### Requirement: A finding can be entered by hand and then has no item key

The system SHALL accept a manually entered finding — a hazard seen outside an inspection — from a
supervisor, manager or the HS coordinator, carrying its site, description, location, photos and an
initial classification. A manually entered finding SHALL have `inspection_id`,
`template_version_item_id` and `item_key` all null, and a derived finding SHALL have all three
set; the engine SHALL enforce that exactly one of the two origins holds. A manually entered
finding SHALL therefore be absent from any grouping by `item_key`, which is the accepted
consequence recorded in §4 and risk F.

#### Scenario: A supervisor reports a hazard seen outside an inspection

- **WHEN** a supervisor posts a finding with a site, a description, a `location_id`, one object
  key and an initial classification
- **THEN** a `finding` row is created with `origin` `manual`
- **AND** its `inspection_id`, `template_version_item_id` and `item_key` are null
- **AND** one `finding_risk_assessment` row references it

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

### Requirement: Classification is an append-only chain, never an edit

The system SHALL record every risk classification as a new `finding_risk_assessment` row and
SHALL NEVER update one. The current classification of a finding SHALL be the row that no other
row supersedes, and every other row SHALL be reachable from it through `supersedes_id`. A finding
with no assessment row SHALL be reported as unclassified — a state derived from the absence of a
row, not a default value stored anywhere. A row that supersedes another SHALL carry a `reason`,
and the first classification of a finding SHALL NOT carry one.

#### Scenario: A derived finding starts unclassified

- **WHEN** a submission with a negative answer is accepted
- **THEN** the created finding has no `finding_risk_assessment` row
- **AND** it is reported as unclassified

#### Scenario: Reclassifying leaves both rows

- **GIVEN** a finding classified as `possible` × `moderate`
- **WHEN** the coordinator reclassifies it as `likely` × `major` with the reason `second visit
  showed the guard is removed daily`
- **THEN** two `finding_risk_assessment` rows exist for that finding
- **AND** the current one is the second, carrying that reason
- **AND** the first row is unchanged and reachable through the second's `supersedes_id`

#### Scenario: Reclassifying without a reason is refused

- **WHEN** an assessment carrying a `supersedes_id` is inserted with a null `reason`
- **THEN** the insert fails on the reason check constraint

#### Scenario: A first classification cannot carry a reason

- **WHEN** an assessment with a null `supersedes_id` is inserted with a `reason`
- **THEN** the insert fails on the same check constraint

#### Scenario: Two concurrent reclassifications do not fork the history

- **GIVEN** a finding whose current assessment is `A`
- **WHEN** two requests reclassify it at the same time, both superseding `A`
- **THEN** one commits and the other fails with a unique violation on `supersedes_id`
- **AND** the finding still has exactly one current assessment

#### Scenario: A classification cannot be corrected in place

- **WHEN** the application role updates any column of a `finding_risk_assessment` row
- **THEN** the update is rejected

### Requirement: The risk level is computed by the engine from probability and severity

The system SHALL derive `risk_level` from `probability` and `severity` through a fixed
5 × 5 matrix and SHALL ignore any value a caller supplies for it. `probability` SHALL be one of
`rare`, `unlikely`, `possible`, `likely`, `almost_certain`; `severity` one of `negligible`,
`minor`, `moderate`, `major`, `catastrophic`; and `risk_level` one of `low`, `medium`, `high`,
`critical`. The matrix SHALL be the same whether the classification is written through the
endpoint or inserted directly, and all 25 cells SHALL be covered by a case table.

#### Scenario: The stored level is the matrix's, not the caller's

- **WHEN** a classification of `likely` × `major` is posted claiming `risk_level` `low`
- **THEN** the stored `risk_level` is `critical`

#### Scenario: A direct insert gets the same level

- **WHEN** a `finding_risk_assessment` row of `possible` × `moderate` is inserted directly,
  bypassing the endpoint
- **THEN** its `risk_level` is `medium`

#### Scenario: The two implementations of the matrix agree

- **WHEN** all 25 combinations of `probability` and `severity` are evaluated by the shared pure
  function and by the database
- **THEN** the 25 results are identical

#### Scenario: A scale value outside the closed list is refused

- **WHEN** a classification is posted with `severity` `fatal`
- **THEN** the request is rejected and no assessment row is created

### Requirement: A classification records the level of the control hierarchy proposed

The system SHALL require every `finding_risk_assessment` to carry a `control_level`, one of
`elimination`, `substitution`, `engineering`, `administrative`, `ppe`, naming where in the
hierarchy of controls the proposed solution sits. The system SHALL NOT rank, score or reject a
classification because of the level chosen: recording that the answer was personal protective
equipment rather than elimination is the point, and judging it is a person's job.

#### Scenario: The level is stored as given

- **WHEN** a classification is posted with `control_level` `ppe`
- **THEN** the stored assessment carries `ppe`
- **AND** the request is accepted

#### Scenario: A classification without a control level is refused

- **WHEN** a classification is posted with no `control_level`
- **THEN** the request is rejected and no assessment row is created

#### Scenario: An unknown level is refused by the engine

- **WHEN** a `finding_risk_assessment` row is inserted with `control_level` `training`
- **THEN** the insert fails on the check constraint

### Requirement: Only the HS coordinator classifies

The system SHALL accept a classification or a reclassification only from an account whose role is
`hs_coordinator`, and SHALL record that account as `assessed_by` from the session and never from
the payload. A JHSC member, supervisor, manager or external auditor SHALL be refused with
`forbidden`. Reporting a manual finding SHALL be available to supervisors, managers and the HS
coordinator; a JHSC member reports findings by submitting an inspection.

#### Scenario: A JHSC member cannot classify

- **WHEN** a JHSC member posts a classification for a finding of their own site
- **THEN** the request is rejected with the code `forbidden`
- **AND** no assessment row is created

#### Scenario: The assessor is taken from the session

- **WHEN** the coordinator posts a classification
- **THEN** `finding_risk_assessment.assessed_by` is the account of the authenticated session
- **AND** no field of the payload can set it

#### Scenario: An external auditor cannot report a finding

- **WHEN** an external auditor posts a manual finding
- **THEN** the request is rejected with the code `forbidden`

### Requirement: Findings are read within the reader's site scope

The system SHALL return findings only for the sites in the session's scope, enforced by the row
level security policy on `finding`, `finding_photo` and `finding_risk_assessment` and not by a
`WHERE site_id` clause in the endpoint. A listing SHALL carry, for each finding, its origin, its
description, its location, its photos and its current classification or the fact that it has none.
A request for a finding outside the session's scope SHALL be answered exactly as one for a
finding that does not exist.

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

#### Scenario: A listing reports the current classification

- **GIVEN** a finding classified twice
- **WHEN** it is listed
- **THEN** the classification returned is the current one, with its `risk_level` and
  `control_level`
- **AND** a finding never classified is returned as unclassified
