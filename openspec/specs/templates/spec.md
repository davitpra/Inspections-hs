## Purpose

Defines how inspection templates are modelled, versioned and frozen on publication, and
guarantees that a question keeps one stable identity across successive template versions so
that recurring findings for the same question form a single historical series instead of one
series per edit. It also defines what a published version *means* when it is interpreted: the
response types an item can use, how conditional visibility is resolved, and what makes a set of
answers valid against that version — with the same verdict on the offline device and on the
server.

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
and `response_type`. `response_type` SHALL be one of `yes_no`, `yes_no_na`, `scale`, `text`,
`number`, `single_choice`, `multi_choice`, `photo` or `signature`. The schema SHALL be a
discriminated union on `response_type`: each response type declares exactly the configuration
fields it needs, and a configuration field belonging to another response type SHALL be rejected.
Any document that does not conform SHALL be rejected at load time rather than at inspection time.

#### Scenario: A malformed seed document fails the build

- **WHEN** the validation suite parses every template document shipped as a seed
- **AND** one document declares an item with no `item_key`
- **THEN** validation fails and reports the offending template and item

#### Scenario: An unknown response type is rejected

- **WHEN** a document declares an item with `response_type` `"rating_stars"`
- **THEN** validation fails and names `response_type` as the offending field

#### Scenario: A configuration field from another response type is rejected

- **WHEN** a document declares an item with `response_type` `"text"` that also carries `options`
- **THEN** validation fails and names `options` as a field the `text` response type does not accept

#### Scenario: Duplicate positions within a section are rejected

- **WHEN** a document declares two items in the same `section_key` with the same `position`
- **THEN** validation fails and names the section and the duplicated `position`

### Requirement: Each response type declares the configuration it needs

The system SHALL require, per `response_type`, the configuration that makes an answer to that
item decidable without any further lookup:

- `yes_no` and `signature` carry no additional configuration.
- `scale` SHALL carry `min` and `max` integers with `min` < `max`.
- `text` SHALL carry `max_length`, a positive integer.
- `number` SHALL carry `min`, `max` and `decimals`, with `min` <= `max` and `decimals` >= 0.
- `single_choice` and `multi_choice` SHALL carry `options`, a non-empty array of
  `{ value, label }` whose `value` entries are unique within the item.
- `multi_choice` SHALL additionally carry `min_selected` and `max_selected`, with
  `min_selected` <= `max_selected` <= the number of `options`.
- `photo` SHALL carry `min_count` and `max_count`, with `0` <= `min_count` <= `max_count`.
- `yes_no_na` carries no additional configuration and admits `na` as a distinct third answer that
  SHALL NOT be treated as a compliance failure.

#### Scenario: A scale item with an inverted range is rejected

- **WHEN** a document declares an item with `response_type` `"scale"`, `min` `5` and `max` `1`
- **THEN** validation fails and names `min` and `max` as the offending fields

#### Scenario: A choice item with duplicate option values is rejected

- **WHEN** a document declares an item with `response_type` `"single_choice"` whose `options`
  contain the `value` `"ok"` twice
- **THEN** validation fails and names the duplicated `value`

#### Scenario: A multi_choice item cannot require more selections than it offers

- **WHEN** a document declares an item with `response_type` `"multi_choice"`, three `options` and
  `min_selected` `4`
- **THEN** validation fails and names `min_selected`

### Requirement: Conditional visibility is a pure function of earlier answers

The system SHALL let a section or an item declare `visible_when`, and SHALL treat an element with
no `visible_when` as always visible. A `visible_when` SHALL be either a single condition or an
`all_of` or `any_of` array of conditions. A condition SHALL name a source `item_key`, an
`operator` — one of `equals`, `not_equals`, `in`, `gte`, `lte`, `answered`, `unanswered` — and,
for every operator except `answered` and `unanswered`, a `value`.

The referenced `item_key` SHALL exist in the same document and SHALL appear strictly earlier in
document order than the element that references it, so that visibility can be resolved in one
forward pass and never depends on evaluation order. Evaluating visibility SHALL NOT require
network or database access: the document and the current answers are the only inputs.

#### Scenario: An item becomes visible when its condition holds

- **WHEN** the engine evaluates a document where item `hazard.followup` declares `visible_when`
  `{ item_key: "hazard.present", operator: "equals", value: true }`
- **AND** the answer for `hazard.present` is `true`
- **THEN** `hazard.followup` is reported as visible

#### Scenario: An item is hidden when its source item is unanswered

- **WHEN** the same document is evaluated with no answer for `hazard.present`
- **THEN** `hazard.followup` is reported as hidden

#### Scenario: A hidden section hides every item it contains

- **WHEN** a section declares a `visible_when` that does not hold
- **THEN** every item of that section is reported as hidden, regardless of its own `visible_when`

#### Scenario: A forward reference is rejected at load time

- **WHEN** a document declares an item whose `visible_when` names an `item_key` that appears later
  in document order
- **THEN** validation fails and names both the referencing item and the referenced `item_key`

#### Scenario: A reference to an unknown item is rejected at load time

- **WHEN** a document declares a `visible_when` naming an `item_key` that the document does not
  contain
- **THEN** validation fails and names the unknown `item_key`

### Requirement: An answer set is validated against one template version

The system SHALL validate a set of answers against a single template document and SHALL report
every violation found, not only the first. A violation SHALL name the `item_key` it belongs to
and a stable machine-readable code. Validation SHALL be a pure function: no network access, no
database access, no clock and no randomness.

Validation SHALL reject an answer set when:

- a visible item whose `required` is `true` has no answer;
- an answer does not match the shape its `response_type` declares;
- a `scale` or `number` answer falls outside the configured range, or a `number` answer carries
  more decimal places than `decimals` allows;
- a `text` answer is longer than `max_length`;
- a `single_choice` answer is not one of the item's `options`, or a `multi_choice` answer contains
  a value that is not one of the `options`, repeats a value, or selects fewer than `min_selected`
  or more than `max_selected`;
- a `photo` answer holds fewer than `min_count` or more than `max_count` object keys;
- an answer is present for an `item_key` the document does not contain;
- an answer is present for an item the same answer set renders hidden.

An answer that is absent for a visible, non-required item SHALL be accepted.

#### Scenario: A missing required answer is reported

- **WHEN** an answer set omits a visible item whose `required` is `true`
- **THEN** validation fails with a violation naming that `item_key`

#### Scenario: Every violation is reported at once

- **WHEN** an answer set violates three separate items
- **THEN** validation returns three violations, one per offending `item_key`

#### Scenario: An answer to a hidden item is rejected

- **WHEN** an answer set renders item `hazard.followup` hidden
- **AND** the same answer set carries an answer for `hazard.followup`
- **THEN** validation fails with a violation naming `hazard.followup`

#### Scenario: A required answer inside a hidden section is not demanded

- **WHEN** an answer set renders a section hidden
- **AND** that section contains an item whose `required` is `true` with no answer
- **THEN** validation succeeds

#### Scenario: An out-of-range scale answer is rejected

- **WHEN** an item declares `response_type` `"scale"` with `min` `1` and `max` `5`
- **AND** the answer for that item is `7`
- **THEN** validation fails with a violation naming that `item_key`

#### Scenario: An answer for an unknown item is rejected

- **WHEN** an answer set carries an answer whose `item_key` is not in the document
- **THEN** validation fails with a violation naming that `item_key`

#### Scenario: An optional unanswered item is accepted

- **WHEN** an answer set omits a visible item whose `required` is `false`
- **AND** every other answer is valid
- **THEN** validation succeeds with no violations

### Requirement: Client and server reach the same verdict

The system SHALL produce identical validation verdicts on the offline device and on the server
receiving the submission, for the same document and the same answer set. A single shared table of
cases — each case pairing a document, an answer set and the expected verdict — SHALL be executed
in both environments, and a disagreement SHALL fail the build.

#### Scenario: The shared case table runs in both environments

- **WHEN** the test suite runs
- **THEN** every case in the shared table is executed by the engine's own unit tests
- **AND** every case in the shared table is executed by the API integration suite against the same
  imported engine

#### Scenario: A divergence fails the build

- **WHEN** one environment returns a verdict that differs from the expected verdict for any case
- **THEN** the build fails and names the offending case

### Requirement: The engine runs where there is no Node runtime

The system SHALL keep the shared forms engine free of Node built-in modules and of Node globals,
because it is bundled inside the service worker and executes on the device without a Node runtime.
This SHALL be enforced by a lint rule that fails the build, not by convention, and the rule SHALL
itself be covered by a test.

#### Scenario: A Node built-in import fails lint

- **WHEN** a file in the engine package imports `node:crypto`
- **THEN** lint fails with the rule's ADR-007 message

#### Scenario: A Node global fails lint

- **WHEN** a file in the engine package references `process`
- **THEN** lint fails with the rule's ADR-007 message

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

### Requirement: A published version's item rows record the response type it was published with

The system SHALL accept, in `template_version_item.response_type`, every response type the shared
schema admits, so that a published document and its derived rows can never disagree about what an
item asks. Widening the accepted set SHALL be a schema migration; it SHALL NOT modify any existing
`template_version` or `template_version_item` row.

#### Scenario: A document using a new response type projects to rows

- **WHEN** a `template_version` row is inserted whose `document` declares an item with
  `response_type` `"signature"`
- **THEN** the insert succeeds
- **AND** the corresponding `template_version_item` row carries `response_type` `"signature"`

#### Scenario: An unknown response type is still rejected at the row level

- **WHEN** a `template_version_item` row is inserted with `response_type` `"rating_stars"`
- **THEN** the insert fails with a check constraint violation

#### Scenario: Existing published versions are untouched by the widening

- **WHEN** the migration that widens the accepted set has been applied
- **THEN** every pre-existing `template_version` row has the same `document` it had before
- **AND** every pre-existing `template_version_item` row has the same `response_type` it had before

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

### Requirement: The templates offered for scheduling are those with a published version

The system SHALL expose the templates available to be scheduled, each carrying its `id`, its
`name`, and the `version` number and `template_version_id` of its highest published version.

A template with no `template_version` row SHALL NOT be offered, because a schedule rule on such a
template is refused as `template_not_publishable`: a list that offered it would be offering a
rejection.

The version reported SHALL be resolved by **the same expression** the scheduler uses to freeze a
newly opened inspection, so that the version the list names and the version an inspection is bound
to cannot disagree. Reporting a version the scheduler would not choose would be silent: the
coordinator would read `2` on the screen and the inspection would open against `3`.

The list SHALL NOT be restricted by site scope, because a template carries no `site_id` by design —
one monthly inspection for the organisation, not one per plant, which is what makes "the same guard
is missing at both plants" a question that can be asked at all. The response is therefore identical
for every requester.

#### Scenario: A template with no published version is not offered

- **GIVEN** a template with no `template_version` row
- **WHEN** the templates available for scheduling are listed
- **THEN** that template is not in the list
- **AND** creating a schedule rule for it is rejected as `template_not_publishable`

#### Scenario: The version reported is the version the scheduler freezes

- **GIVEN** a template whose highest published version is `3`
- **WHEN** the templates are listed and a period is then opened for a rule on that template
- **THEN** the listed `version` is `3`
- **AND** the created scheduled inspection's `template_version_id` is the listed
  `template_version_id`

#### Scenario: Publishing a new version moves the offer, not the frozen inspection

- **GIVEN** a scheduled inspection already open against version `2`
- **WHEN** version `3` is published and the templates are listed again
- **THEN** the listed version is `3`
- **AND** the existing scheduled inspection still reports `template_version_id` for version `2`

#### Scenario: The list does not depend on the requester's site scope

- **WHEN** two accounts whose scopes cover different plants list the templates
- **THEN** both receive the same entries
