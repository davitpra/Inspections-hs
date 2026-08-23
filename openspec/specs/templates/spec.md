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

New sections and items authored in the editor SHALL receive an opaque 12-character lower-case
alphanumeric `section_key` or `item_key` at creation time. The editor SHALL NOT expose either key
as an editable field or derive it from user-entered text. A newly authored section SHALL also carry
the `organization_location_code` selected from the organization catalog; its `section_title` SHALL
be copied from that catalog entry. Historical documents created before the organization catalog
may omit that field and remain readable.

#### Scenario: Rewording does not change an opaque item identity

- **WHEN** an author changes the prompt of an existing item
- **THEN** its `item_key` remains unchanged
- **AND** no key field is shown in the editor

#### Scenario: A section uses a catalog location

- **WHEN** an author selects an organization location for a section
- **THEN** the draft stores its code and the catalog name as `section_title`
- **AND** the author is not offered a free-text section title

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

### Requirement: A draft is a working document, not a version

The system SHALL keep an in-progress template as a `template_draft` record, separate from
`template_version` in every respect: it is mutable, it may be incomplete, it carries no version
number, and it is not reachable from any inspection, finding or record.

A draft SHALL carry its own `name`, a `key` derived from it, and a `document` holding the
sections and items being authored. Creating or saving a draft SHALL NOT write to `template`, `template_item`,
`template_version` or `template_version_item`: a draft that has never been published SHALL be
invisible to every reader of published templates, including the list offered for scheduling.

The two SHALL NOT be conflated. A published version is the record an inspection is bound to and a
regulator reads; a draft is scratch work. Storing a draft as a version — even a version marked
"unpublished" — would make the immutable table mutable, which is the one thing the model exists to
prevent.

#### Scenario: A draft is not offered for scheduling

- **GIVEN** a saved draft whose `document` is complete
- **WHEN** the templates available for scheduling are listed
- **THEN** the draft is not in the list
- **AND** no `template` row exists carrying the draft's `key`

#### Scenario: Saving a draft leaves the published model untouched

- **WHEN** a draft is created and then saved three times
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A draft is edited in place, not versioned

- **GIVEN** a draft whose `document` has one section
- **WHEN** a second section is added and the draft is saved
- **THEN** reading the draft returns both sections
- **AND** only one `template_draft` row exists for that draft

Publishing a draft SHALL be the only act that writes those rows, and SHALL end the draft's life
as a working document rather than turning the draft into the version. The `template_draft` row
that was published SHALL name the `template_version` it produced, so that the version's origin is
recorded, and SHALL remain a separate record from it.

#### Scenario: A published draft and its version are two records

- **WHEN** a live draft is published
- **THEN** the `template_draft` row and the `template_version` row both exist
- **AND** the draft row names the version through `template_version_id`

### Requirement: A publishable draft becomes version 1 of a new template

The system SHALL publish a live draft on the HS coordinator's request, writing in one
transaction the `template` row carrying the draft's `key` and `name`, one `template_item` row
per `item_key` the document declares, and one `template_version` row carrying `version` 1 and
the draft document with its positions derived from list order.

The `template_version_item` rows SHALL NOT be written by the publishing request: they are
derived from the document by the engine, so that a template published from a draft and a
template loaded by a seed are projected by the same rule and cannot disagree.

The system SHALL record on the version the account that published it, and SHALL report to the
publisher the identity of the template, the identity of the version, and its version number,
so that the interface can name what was created rather than only that something was.

#### Scenario: Publishing writes the template, its items and its version

- **GIVEN** a live draft whose document is publishable, with two sections of two questions each
- **WHEN** the HS coordinator publishes it
- **THEN** a `template` row exists carrying the draft's `key` and `name`
- **AND** a `template_version` row exists for that template with `version` 1
- **AND** its `document` holds the four questions
- **AND** a `template_item` row is registered for each of the four `item_key` values
- **AND** the response names the `template_id`, the `template_version_id` and `version` 1

#### Scenario: The item rows are derived, not sent

- **GIVEN** a live draft whose document is publishable
- **WHEN** the HS coordinator publishes it
- **THEN** one `template_version_item` row exists for every question of the document
- **AND** each row carries the `item_key`, `section_key`, `prompt`, `response_type` and
  `required` the document declared

#### Scenario: The version records who published it

- **WHEN** a coordinator publishes a draft
- **THEN** the `template_version` row's `published_by` names that account
- **AND** its `published_at` is set

### Requirement: Order at publication is the order of the draft's elements

The system SHALL assign, when a draft is published, section positions in list order starting
at one and, within each section, item positions in list order starting at one. The draft
carries no position of its own, so the order the author sees is the order that is frozen.

#### Scenario: List order becomes position

- **GIVEN** a live draft whose second section holds three questions
- **WHEN** it is published
- **THEN** that section's `template_version_item` rows carry positions 1, 2 and 3 in the order
  the author arranged them
- **AND** the published document declares the same positions

### Requirement: An unpublishable draft is refused and writes nothing

The system SHALL refuse to publish a draft whose document is not publishable, SHALL report the
refusal as `template_draft_not_publishable` carrying the same issues that reading the draft
reports, and SHALL leave the draft live and unchanged.

The publishability of a draft SHALL be decided by the same shared rules that decide it when the
draft is read, so that a draft the interface reports as ready is never refused at publication
and a draft it reports as incomplete is never accepted.

#### Scenario: A draft with an empty section is refused

- **GIVEN** a live draft with a section that has no questions
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused as `template_draft_not_publishable`
- **AND** the refusal carries the issue naming that section
- **AND** no `template`, `template_item` or `template_version` row is written
- **AND** the draft is still live

#### Scenario: An empty draft is refused

- **GIVEN** a live draft whose document has no sections
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused as `template_draft_not_publishable`
- **AND** the draft is still live

### Requirement: Publishing consumes the draft

The system SHALL, on a successful publication, record `published_at` and the
`template_version_id` of the version it produced on the `template_draft` row, and SHALL from
then on treat that draft as no longer live: it is absent from the list of drafts, and saving,
discarding or publishing it again SHALL be refused.

The row SHALL be kept. A draft that produced a version is the record of where that version came
from, and deleting it would erase that trace; but continuing to edit it would be editing scratch
work that no longer describes anything, because the document it describes is frozen.

A draft SHALL NOT be both discarded and published. The two are distinct ends: one says the
author threw the work away, the other says it became a record.

#### Scenario: A published draft leaves the list

- **WHEN** a live draft is published
- **THEN** it is absent from the list of drafts
- **AND** its `template_draft` row still exists with `published_at` and `template_version_id` set

#### Scenario: A published draft cannot be saved

- **GIVEN** a draft that has been published
- **WHEN** a save is submitted for it
- **THEN** the request is refused as `template_draft_not_found`
- **AND** the stored draft is unchanged

#### Scenario: A published draft cannot be published twice

- **GIVEN** a draft that has been published
- **WHEN** the HS coordinator publishes it again
- **THEN** the request is refused as `template_draft_not_found`
- **AND** the number of `template` and `template_version` rows is unchanged

#### Scenario: A published draft cannot be discarded

- **GIVEN** a draft that has been published
- **WHEN** it is discarded
- **THEN** the request is refused as `template_draft_not_found`
- **AND** its `discarded_at` is still absent

### Requirement: Publishing releases the name and key the draft held

The system SHALL stop counting a published draft among the live drafts for the purpose of name
and key uniqueness, because from the moment it is published the authoritative holder of that key
is the `template` row it created, whose `key` is unique across every published template.

A new draft SHALL therefore be refused the name of a published template on the same grounds it
is refused the name of a live draft, and not because the consumed draft still holds it.

#### Scenario: A published draft no longer holds its name against a new draft

- **GIVEN** a draft named `Monthly general inspection` that has been published
- **WHEN** a coordinator creates a draft named `Monthly general inspection`
- **THEN** the request is refused
- **AND** the refusal names the published template rather than a live draft

### Requirement: A key already held by a published template is refused at publication

The system SHALL refuse a publication whose derived key already belongs to a published template,
report it as `template_key_taken`, and leave the draft live and unchanged with no partial record
written.

The check when a draft is named is a courtesy so that the author learns early; it cannot be a
guarantee, because a template may be published under that key between the naming and the
publication. The refusal at publication is the authoritative one.

#### Scenario: Publishing under a key a seeded template already holds is refused

- **GIVEN** a seeded template whose `key` is `monthly-general-inspection`
- **AND** a live publishable draft whose derived key is `monthly-general-inspection`
- **WHEN** the HS coordinator publishes the draft
- **THEN** the request is refused as `template_key_taken`
- **AND** the draft is still live
- **AND** no new `template` row exists

### Requirement: Publication is all or nothing

The system SHALL write the template, its registered items and its version in a single
transaction, so that a refusal at any point leaves no trace: no template without a version, no
registered `item_key` belonging to a template that does not exist, and no draft marked as
published.

A template row without a version would be invisible to every reader of published templates and
would hold its key forever, which is the worst of both outcomes: the coordinator could neither
schedule it nor publish it again under the same name.

#### Scenario: A refused publication leaves no template row

- **GIVEN** a live publishable draft whose derived key already belongs to a published template
- **WHEN** the HS coordinator publishes it
- **THEN** the number of `template`, `template_item` and `template_version` rows is unchanged
- **AND** the draft's `published_at` is absent

#### Scenario: An item_key already registered stops the whole publication

- **GIVEN** a live publishable draft one of whose `item_key` values is already registered in
  `template_item`
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused
- **AND** no `template` row exists carrying the draft's `key`
- **AND** the draft is still live

### Requirement: Publishing a template is the HS coordinator's

The system SHALL restrict publishing a template draft to the HS coordinator, and SHALL refuse
every other role as `template_draft_forbidden`, the same code the other acts on a draft use: for
every role but one, a draft is a document that does not exist.

#### Scenario: A non-coordinator cannot publish

- **WHEN** an account whose role is `supervisor` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template` or `template_version` row is written

### Requirement: A published template is offered for scheduling immediately

The system SHALL offer a template published from a draft in the list of templates available for
scheduling, on the same terms as a seeded one, with the version number and version identity of the
version just published.

#### Scenario: The template appears in the scheduling list

- **GIVEN** a live publishable draft
- **WHEN** it is published and the templates available for scheduling are listed
- **THEN** the list includes it with `latest_version` 1
- **AND** its `latest_version_id` is the version the publication produced

### Requirement: The plants a draft named do not travel to the published template

The system SHALL NOT record a draft's `site_ids` on the template it publishes. A template
carries no `site_id` and no row-level policy, and the scope stated while authoring is a
statement about where the template was being written for, not a property of the record it
becomes.

The scope SHALL have already had its whole effect on the document: it decided which shared
locations each section could name, and those codes are written into the document that is frozen.
A published template SHALL therefore be offered for scheduling at every plant, exactly as a
seeded template is.

#### Scenario: A single-plant draft publishes to an unscoped template

- **GIVEN** a live publishable draft whose `site_ids` names only St. Thomas
- **WHEN** it is published
- **THEN** the `template` row carries no plant
- **AND** the templates available for scheduling include it for an account scoped to Glencoe

### Requirement: A question can prescribe what to do when it fails

The system SHALL let a draft question carry an optional `finding` block that records what the
organization has already decided about that question's failure: a `corrective_action` describing
the work to be done.

The block SHALL NOT record where that work sits in the hierarchy of controls. The hierarchy
describes a control chosen against a hazard that exists, and the system already asks for it at the
only moment it can be answered honestly — when a real finding is classified, with its probability
and its severity in front of the coordinator. A level authored months earlier, against a question
and no hazard, is a value nobody chose, and a value nobody chose is worse than an absent one
because it reads as evidence.

The system SHALL refuse a `finding` block that names a `control_level`, in a draft document and in
a published one alike, rather than accepting and ignoring it: a field that is stored and never read
would leave two answers to the same question in the record.

The block SHALL be optional on every response type. A question without it SHALL remain publishable,
because most questions carry no standing answer to their own failure and inventing one would make
the prescription worthless where it matters.

The block SHALL travel inside the draft document, alongside the prompt and the answer settings of
the question it belongs to, so that duplicating a question or moving it between positions carries
the prescription with it and never leaves it behind.

The system SHALL NOT judge the prescription. A corrective action of "issue gloves" against a
question about a missing machine guard SHALL be stored exactly as authored: that this was the
proposed response is precisely the fact that has to remain visible afterwards.

#### Scenario: A question is saved with its prescription

- **WHEN** a draft is saved with a `yes_no` item whose `finding` block carries a
  `corrective_action`
- **THEN** the save succeeds
- **AND** reading the draft returns that item with the same `corrective_action`

#### Scenario: A prescription naming a control level is refused outright

- **WHEN** a draft is saved with a `finding` block that carries a `control_level`, whatever its
  value
- **THEN** the save is rejected
- **AND** the draft's stored document is unchanged

#### Scenario: A draft authored before the field was retired can still be saved

- **GIVEN** a draft stored before this change whose document carries a `finding` block with a
  `control_level`
- **WHEN** the draft is read and saved again without editing the prescription
- **THEN** the save succeeds
- **AND** the stored document no longer carries a `control_level`

#### Scenario: A question without a prescription is still publishable

- **GIVEN** a draft whose document has one section with one `yes_no` item carrying a non-empty
  `prompt`, a valid `item_key` and no `finding` block
- **WHEN** the draft is read
- **THEN** it is reported as publishable
- **AND** no issues are reported

#### Scenario: A blank corrective action is reported, not rejected

- **WHEN** a draft is saved with an item whose `finding` block carries an empty
  `corrective_action`
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that item

#### Scenario: A duplicated question carries its prescription

- **GIVEN** a draft item with a `finding` block
- **WHEN** that item is duplicated
- **THEN** the copy carries the same `corrective_action`
- **AND** the copy carries its own `item_key`

### Requirement: A measured question declares the answer that counts as a failure

The system SHALL let the `finding` block of a `scale` or a `number` question carry an optional
`fails_when` — an `operator` of `lt`, `lte`, `gt` or `gte` and a numeric `value` — declaring which
answers the author considers a failure. A boolean question SHALL NOT carry one: for `yes_no` and
`yes_no_na` the failing answer is already fixed and writing it again would create a second place
for it to be wrong.

The system SHALL reject as non-publishable a `fails_when` on any other response type, and a
`fails_when` whose `value` falls outside the question's own `min`/`max` bounds — a threshold no
possible answer can cross is a threshold that does not say anything.

The declared threshold SHALL be authored data only. It SHALL NOT change which answers produce a
finding: until a later change teaches the engine to read it, a `scale` or `number` answer produces
no finding whether or not the question declares a threshold.

#### Scenario: A number question declares its threshold

- **WHEN** a draft is saved with a `number` item whose `min` is `0`, whose `max` is `100`, and
  whose `finding` block carries a `fails_when` of operator `gt` and value `80`
- **THEN** the save succeeds
- **AND** reading the draft reports it as publishable

#### Scenario: A threshold outside the item's own bounds is reported

- **WHEN** a draft is saved with a `scale` item whose `min` is `1` and whose `max` is `5`, and
  whose `fails_when` value is `9`
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that item

#### Scenario: A threshold on a boolean question is reported

- **WHEN** a draft is saved with a `yes_no` item whose `finding` block carries a `fails_when`
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that item

#### Scenario: Changing the response type discards a threshold that no longer applies

- **GIVEN** a draft item of type `number` whose `finding` block carries a `fails_when`
- **WHEN** its response type is changed to `yes_no`
- **THEN** the item keeps its `corrective_action`
- **AND** the item no longer carries a `fails_when`

### Requirement: An incomplete draft is saved and reports what it lacks

The system SHALL accept and store a draft whose document could not be published — a section with no
items, an item with an empty prompt, an item whose configuration contradicts itself, an item whose
prescribed corrective action is blank, an item whose declared failure threshold does not apply to
its response type or falls outside its bounds — because a document being authored is incomplete for
most of its life, and a save that refused it would force the author to finish a section before
leaving it.

The system SHALL, on every read of a draft, report whether the draft is publishable and, when it is
not, what stands in the way. Each reported issue SHALL name the section or item it concerns.

The publishability of a draft SHALL be decided by the same shared rules that validate a published
document, evaluated on the device and on the server from the same code, so that the interface never
shows a draft as ready that the server would then refuse.

#### Scenario: A section with no items is saved and reported

- **WHEN** a draft containing one section with an empty item list is saved
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that section

#### Scenario: A contradictory item configuration is reported, not rejected

- **WHEN** a draft is saved with a `scale` item whose `min` is not less than its `max`
- **THEN** the save succeeds
- **AND** reading the draft reports it as not publishable
- **AND** an issue names that item

#### Scenario: A complete draft reports itself as publishable

- **GIVEN** a draft whose document has one section with one `yes_no` item carrying a non-empty
  `prompt` and a valid `item_key`
- **WHEN** the draft is read
- **THEN** it is reported as publishable
- **AND** no issues are reported

#### Scenario: A complete draft carrying a prescription reports itself as publishable

- **GIVEN** a draft whose document has one section with one `yes_no` item carrying a non-empty
  `prompt`, a valid `item_key` and a `finding` block with a non-empty `corrective_action`
- **WHEN** the draft is read
- **THEN** it is reported as publishable
- **AND** no issues are reported

#### Scenario: An unknown response type is refused outright

- **WHEN** a draft is saved with an item whose `response_type` is not one of the nine declared types
- **THEN** the save is rejected
- **AND** the draft's stored document is unchanged

### Requirement: The order of a draft is the order of its elements

The system SHALL derive `position` from the order of the sections and items in the draft document
rather than storing it, so that two sections or two items of the same section can never share a
position. Reordering SHALL be expressed as moving an element within its list.

When a draft is prepared for publication, sections SHALL receive positions in list order starting at
one, and the items of each section SHALL receive positions in list order starting at one.

#### Scenario: Moving a section changes the derived order

- **GIVEN** a draft whose sections are listed as `intake` then `storage`
- **WHEN** `storage` is moved one place earlier and the draft is saved
- **THEN** reading the draft lists `storage` before `intake`
- **AND** preparing that draft for publication assigns `storage` position `1` and `intake` position
  `2`

#### Scenario: Moving an item within its section changes the derived order

- **GIVEN** a section whose items are listed as `guard.fitted` then `guard.intact`
- **WHEN** `guard.intact` is moved one place earlier and the draft is saved
- **THEN** reading the draft lists `guard.intact` first
- **AND** preparing that draft for publication assigns it position `1`

#### Scenario: Removing an element closes the gap

- **GIVEN** a section with three items
- **WHEN** the second item is removed and the draft is saved
- **THEN** preparing the draft for publication assigns the remaining items positions `1` and `2`

### Requirement: Changing an item's response type replaces its configuration

The system SHALL, when an item's `response_type` changes, discard the configuration belonging to the
previous type and supply the configuration the new type requires. An item SHALL NOT retain a
configuration field belonging to a response type it no longer has.

#### Scenario: Switching from text to single choice

- **GIVEN** an item of `response_type` `text` carrying `max_length`
- **WHEN** its response type is changed to `single_choice` and the draft is saved
- **THEN** the stored item carries `options` and no `max_length`

#### Scenario: Switching to a type that needs no configuration

- **GIVEN** an item of `response_type` `number` carrying `min`, `max` and `decimals`
- **WHEN** its response type is changed to `yes_no` and the draft is saved
- **THEN** the stored item carries none of `min`, `max` or `decimals`

### Requirement: Authoring a template is the HS coordinator's

The system SHALL restrict reading, creating, saving, discarding and publishing a template draft
to the HS
coordinator, and SHALL refuse every other role with a code the interface can act on rather than a
message it must parse.

The restriction SHALL be by role and not by site scope, because a template carries no `site_id` by
design and a draft's `site_ids` describes where it is intended to be used rather than whose data
it is. A draft remains organisation reference content, and restricting visibility by plant would
reintroduce the per-plant duplication the model exists to avoid.

#### Scenario: A non-coordinator cannot read drafts

- **WHEN** an account whose role is `jhsc_member` lists the template drafts
- **THEN** the request is refused as `template_draft_forbidden`

#### Scenario: A non-coordinator cannot save a draft

- **WHEN** an account whose role is `supervisor` saves an existing draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** the stored draft is unchanged

#### Scenario: A non-coordinator cannot publish a draft

- **WHEN** an account whose role is `jhsc_member` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_version` row is written

#### Scenario: Drafts do not depend on the requester's site scope

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries

### Requirement: A draft is identified by its name, and its key is derived

The system SHALL derive a draft's `key` from its `name` when the draft is created, and SHALL
NOT accept a `key` from the client. The author names the template; the identifier that the
published template will carry is a consequence of that name, not a second decision.

Two live drafts SHALL NOT share a name, compared ignoring case and surrounding whitespace,
and a draft SHALL NOT take the name of an existing template. The name is what the interface
shows, so two rows sharing one cannot be told apart by anything the author can see.

The derivation SHALL NOT disambiguate by appending a suffix. Where two different names would
produce the same key, the second SHALL be refused, so that a draft's key is always exactly
what its name derives to.

A name from which no key can be derived SHALL be refused, naming the name rather than the
key: the key is not a field the author has.

A draft's `key` SHALL NOT change after creation, renaming included. The key is what
identifies the published template and what seed files reference, and an identifier that
moved with every wording change would identify nothing. A renamed draft may therefore carry
a key that no longer resembles its name, and the key SHALL remain readable in the interface
so that divergence is legible rather than hidden.

#### Scenario: The key comes from the name

- **WHEN** a draft is created with the name `Monthly electrical inspection`
- **THEN** its `key` is `monthly-electrical-inspection`

#### Scenario: A name already used by a live draft is refused

- **GIVEN** a live draft named `Fire extinguisher round`
- **WHEN** another draft is created with the name `  fire EXTINGUISHER round `
- **THEN** the request is refused as `template_draft_name_taken`

#### Scenario: A name already used by a published template is refused

- **GIVEN** a `template` row named `Already published`
- **WHEN** a draft is created with that name
- **THEN** the request is refused as `template_draft_name_taken`

#### Scenario: Two different names that derive one key are refused, not suffixed

- **GIVEN** a live draft named `Yard sweep`
- **WHEN** a draft is created with the name `Yard  sweep!`
- **THEN** the request is refused as `template_draft_name_taken`
- **AND** no draft carries a key with an appended discriminator

#### Scenario: A name with nothing to derive from is refused

- **WHEN** a draft is created with the name `???`
- **THEN** the request is refused as `template_draft_name_unusable`

#### Scenario: Renaming changes the name and not the key

- **GIVEN** a draft named `Quarterly boiler check` with key `quarterly-boiler-check`
- **WHEN** it is renamed to `Annual boiler check`
- **THEN** the save succeeds
- **AND** its `key` is still `quarterly-boiler-check`

#### Scenario: Renaming onto another draft's name is refused

- **GIVEN** two live drafts
- **WHEN** one is saved with the other's name
- **THEN** the request is refused as `template_draft_name_taken`
- **AND** the stored draft is unchanged

#### Scenario: A discarded draft releases its name

- **GIVEN** a draft named `Compressor check` that has been discarded
- **WHEN** another draft is created with that name
- **THEN** the request succeeds
- **AND** its `key` is `compressor-check`

### Requirement: The last save of a live draft wins

The system SHALL apply every save submitted against a draft that has not been discarded,
without comparing the submitted document to what the draft held when it was read. Where two
saves reach a draft one after the other, the later one SHALL be the stored document, and the
earlier one SHALL be gone.

The system SHALL NOT report concurrent authorship. A save is refused only when the draft
does not exist or has been discarded, when the account is not a coordinator, when the name
collides with another live draft, or when `site_ids` is empty or names a plant outside the
account's scope. None of those refusals describes a draft that moved.

This is the same bargain ADR-001 makes everywhere else in the product: one owner, one
device, and losing a draft is accepted. A draft under authorship carries no guarantee that
a second window is not overwriting it, and the system does not pretend otherwise.

#### Scenario: A save against a draft that moved is applied anyway

- **GIVEN** a draft read by two windows
- **AND** the first window has saved a document naming the section `Loading dock`
- **WHEN** the second window saves a document naming the section `Compressor room`, having
  never seen the first window's save
- **THEN** the save succeeds
- **AND** reading the draft reports the section named `Compressor room`
- **AND** nothing written by the first window survives

#### Scenario: A save against a discarded draft is still refused

- **GIVEN** a draft that has been discarded
- **WHEN** a save is submitted against it
- **THEN** the request is refused as `template_draft_not_found`

### Requirement: A draft is discarded, never deleted

The system SHALL retire a draft by setting `discarded_at` rather than by deleting it. A discarded
draft SHALL be absent from the list of drafts, and deleting a `template_draft` row SHALL be refused
by the engine for every role.

Discarding and publishing SHALL be mutually exclusive ends for a draft, and the engine SHALL
refuse a row that records both. They are different facts about the same work — one says the author
threw it away, the other says it became a frozen record — and a row that claimed both would leave
no way to tell which happened.

#### Scenario: Discarding hides the draft and keeps the row

- **WHEN** a draft is discarded
- **THEN** it is absent from the list of drafts
- **AND** its `template_draft` row still exists with `discarded_at` set

#### Scenario: Deletion is refused by the engine

- **WHEN** a `template_draft` row is deleted as the application role
- **THEN** the statement fails
- **AND** deleting it as the migration role fails on the guard trigger

#### Scenario: The key of a draft cannot be rewritten

- **WHEN** `template_draft.key` is updated as the application role
- **THEN** the statement fails on insufficient privilege

#### Scenario: A row cannot record both ends

- **WHEN** a `template_draft` row is written with both `discarded_at` and `published_at` set
- **THEN** the statement fails on a check constraint

### Requirement: Templates are loaded from versioned seed files

The system SHALL load the initial templates from SQL seed files kept under version control,
runnable independently of the migration sequence and safe to run more than once. Seeding SHALL
remain sufficient on its own to put a usable template into the system, so that a freshly migrated
database is usable without anyone opening an authoring interface, and so that continuous
integration never depends on one.

The existence of an authoring interface SHALL NOT make the seed path optional or secondary: a
template loaded by seed and a template authored through the interface SHALL be indistinguishable
once published, because both are `template` and `template_version` rows written the same way.

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

#### Scenario: A freshly migrated and seeded database needs no authoring

- **WHEN** the migration sequence and the seed command run against an empty database
- **THEN** the templates available for scheduling include the seeded template
- **AND** no `template_draft` row exists

### Requirement: A draft declares the plants it is written for

The system SHALL carry on every `template_draft` a non-empty `site_ids` list naming the
plants the template is being written for, and SHALL expose it on every read of a draft, both
in the list of drafts and in a single draft.

A draft created without a stated scope SHALL receive the site scope of the account that
created it, restricted to the plants that are still active. A plant that has been removed
cannot be inspected, so seeding a new draft with it would produce a document that is born
naming a place where it can never be used.

The scope SHALL be editable for as long as the draft is a draft, and SHALL travel inside the
same save that carries the `document` and the `name`, because changing where a template is
meant to be used is an edit like any other and is not worth a second write that could
interleave with the first.

The system SHALL refuse a save whose `site_ids` is empty, SHALL refuse a save naming a plant
outside the site scope of the requesting account, and SHALL refuse a save naming a plant that
has been removed, leaving the stored draft untouched in all three cases. The last two are
separate refusals because they are separate facts: one says the plant is not this account's,
the other says the plant no longer exists, and an author who sees them confused cannot tell
whether to ask for scope or to choose another plant.

This is selection, not isolation: a template still carries no `site_id`, still has no
row-level policy, and is still organisation reference content. `site_ids` states **where the
template is meant to be used**, not whose data it is.

Removing a plant SHALL NOT rewrite the stored `site_ids` of any draft that already names it.
The scope belongs to the document and to the author who edits it; silently narrowing a saved
draft would change a document nobody asked to change, and would do it outside the save that
the authoring interface makes explicit.

#### Scenario: A new draft is scoped to the whole account

- **WHEN** a coordinator whose scope covers both plants creates a draft
- **THEN** reading the draft reports `site_ids` naming both plants

#### Scenario: A new draft skips a removed plant in the account's scope

- **GIVEN** a coordinator account whose site scope covers St. Thomas and Glencoe
- **AND** Glencoe has been removed
- **WHEN** that account creates a draft
- **THEN** reading the draft reports `site_ids` naming only St. Thomas

#### Scenario: The scope narrows and survives the save

- **GIVEN** a draft scoped to both plants
- **WHEN** a save declaring a `site_ids` naming only St. Thomas is submitted
- **THEN** the save succeeds
- **AND** reading the draft reports `site_ids` naming only St. Thomas

#### Scenario: An empty scope is refused

- **WHEN** a save is submitted with an empty `site_ids`
- **THEN** the request is refused
- **AND** the stored draft is unchanged

#### Scenario: A plant outside the account's scope is refused

- **GIVEN** a coordinator account whose site scope covers only Glencoe
- **WHEN** that account saves a draft whose `site_ids` names St. Thomas
- **THEN** the request is refused as `template_draft_site_out_of_scope`
- **AND** the stored draft is unchanged

#### Scenario: A removed plant is refused

- **GIVEN** a coordinator account whose site scope covers St. Thomas and Glencoe
- **AND** Glencoe has been removed
- **WHEN** that account saves a draft whose `site_ids` names Glencoe
- **THEN** the request is refused as `template_draft_site_deactivated`
- **AND** the stored draft is unchanged

#### Scenario: A draft already scoped to a removed plant keeps its stored scope

- **GIVEN** a draft scoped to St. Thomas and Glencoe
- **WHEN** Glencoe is removed
- **THEN** reading the draft still reports `site_ids` naming both plants

#### Scenario: The scope is not a site isolation boundary

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries, whatever each draft's `site_ids` says

### Requirement: The scope choices offered by the builder are the active plants

The authoring interface SHALL offer, as scope choices for a draft, only the plants of the
account's scope that are still active. A removed plant SHALL NOT appear among them, whether
or not the draft being edited already names it.

The interface SHALL keep naming a removed plant wherever it is describing a scope that
already names it — the scope summary, the scope notice, and the per-plant location resolution
of a section — so that a stored `site_ids` always reads as a plant name and never as a bare
identifier. Offering and naming are separate jobs: a removed plant is still a name the
interface has to be able to pronounce, and is no longer an answer the author can pick.

When removing a plant leaves the account with a single active plant, the interface SHALL stop
drawing the scope control altogether, on the same grounds it already does for an organisation
configured with one plant: there is nothing left to choose.

This is an interface affordance, not a guarantee. The authoritative refusal is the save, which
rejects a `site_ids` naming a removed plant.

#### Scenario: A removed plant is not among the scope choices

- **GIVEN** an account whose scope covers St. Thomas and Glencoe, with a third plant removed
- **WHEN** the author opens a draft
- **THEN** the scope choices name St. Thomas and Glencoe and no removed plant

#### Scenario: The scope control disappears when one active plant is left

- **GIVEN** an account whose scope covers St. Thomas and Glencoe
- **WHEN** Glencoe is removed and the author opens a draft
- **THEN** no scope control is shown

#### Scenario: A stored scope naming a removed plant still reads as a name

- **GIVEN** a draft whose stored `site_ids` names Glencoe, which has been removed
- **WHEN** the author opens the draft
- **THEN** the scope summary names Glencoe rather than its identifier

### Requirement: A section may only name a location every plant in scope has

The authoring interface SHALL offer, for a section's `organization_location_code`, only those
organization locations that are mapped to an active location at **every** plant in the draft's
`site_ids`. An organization location mapped at one plant of a two-plant scope SHALL NOT be
offered, because a section naming it cannot resolve at the other plant, and a finding raised
there would be stored with no location at all.

The interface SHALL show, for each plant in scope, the location that the section's chosen
organization location resolves to at that plant. That resolution SHALL be read-only: a section
names one organization location, and the per-plant pairing is the mapping's business, not the
author's.

Narrowing or widening the scope SHALL NOT silently rewrite a section. When a section already
names an organization location that is not mapped at every plant in the new scope, the interface
SHALL report that section as needing attention and SHALL keep the stored code, so that the author
decides whether to remap the location or choose another.

This narrowing is an interface affordance, not a guarantee: the authoritative refusal is the
document schema at publication time, and the fallback for an unmapped section at ingestion time
is unchanged.

#### Scenario: A location mapped at only one plant is not offered to a both-plant draft

- **GIVEN** a draft scoped to both plants
- **AND** an organization location mapped to a location at St. Thomas and at no other plant
- **WHEN** the author opens the location choices for a section
- **THEN** that organization location is not among them

#### Scenario: The same location is offered once the scope narrows

- **GIVEN** the draft and organization location of the previous scenario
- **WHEN** the scope is narrowed to St. Thomas only
- **THEN** that organization location is among the choices

#### Scenario: The per-plant resolution is shown for the chosen location

- **GIVEN** a draft scoped to both plants
- **AND** a section naming an organization location mapped to `Shipping dock` at St. Thomas
  and to `Receiving dock` at Glencoe
- **WHEN** the section is read in the editor
- **THEN** it shows `Shipping dock` for St. Thomas and `Receiving dock` for Glencoe
- **AND** neither is offered as an editable choice

#### Scenario: Narrowing the scope reports a section it leaves stranded, and changes nothing

- **GIVEN** a draft scoped to St. Thomas only with a section naming an organization location
  mapped only at St. Thomas
- **WHEN** the scope is widened to both plants
- **THEN** that section is reported as needing attention
- **AND** its stored `organization_location_code` is unchanged

### Requirement: A section or a question can be duplicated

The authoring interface SHALL let the author duplicate a section or a question. A duplicate
SHALL copy everything that describes the content — the prompt or the location, the response
type and its configuration, and whether an answer is required — and SHALL receive a fresh
`section_key` or `item_key` that collides with nothing in the document.

A duplicate SHALL be placed immediately after its original, because the author duplicates to
write a variation of what they are looking at, and appending it to the end would move the work
away from the place they are working in.

An item's `visible_when` SHALL NOT be carried onto a duplicate. Copying it would produce a
second item answering to the same condition, which is almost never what was meant and which can
silently break the strictly-backwards reference rule when the duplicate is later moved.

#### Scenario: Duplicating a question keeps its content and takes a new identity

- **GIVEN** a section whose second item is a required `scale` question with `min` 1 and `max` 5
- **WHEN** that item is duplicated
- **THEN** the section has a third item carrying the same `prompt`, `response_type`, `min`,
  `max` and `required`
- **AND** its `item_key` differs from every other `item_key` in the document
- **AND** it sits immediately after the item it was duplicated from

#### Scenario: Duplicating a section copies its questions

- **GIVEN** a section with three items
- **WHEN** the section is duplicated
- **THEN** the new section has three items whose prompts match, in the same order
- **AND** no `section_key` or `item_key` appears twice in the document

#### Scenario: A duplicate does not inherit a visibility condition

- **GIVEN** an item carrying a `visible_when` condition
- **WHEN** it is duplicated
- **THEN** the duplicate carries no `visible_when`

### Requirement: The authoring console lists the published templates

The system SHALL show, in the console where templates are authored, the templates that have a
published version, separately from the drafts and clearly distinguished from them: a draft is
work in progress and a published template is a frozen record, and a list that mixed them would
invite the coordinator to treat one as the other.

Each entry SHALL name the template, its `key`, the number of its current version and when that
version was published, so that the coordinator can answer both "did that publish" and "what
version is this on" without leaving the console.

The entries SHALL be ordered by name. Order by recency would rearrange the list under the
coordinator every time anything is published, and the list is read to find a known template far
more often than to see what changed last.

The console SHALL show the published templates to the HS coordinator only, on the same grounds
the drafts are: it is the authoring console, and the restriction is by role, not by site scope.

#### Scenario: A published template appears in the console

- **GIVEN** a template published from a draft
- **WHEN** the HS coordinator opens the template console
- **THEN** the published templates include it with its `key` and version `1`
- **AND** it is not listed among the drafts

#### Scenario: A seeded template appears the same way

- **GIVEN** a template loaded by a seed file
- **WHEN** the HS coordinator opens the template console
- **THEN** it appears among the published templates
- **AND** nothing distinguishes it from one published through the interface

#### Scenario: A draft is not listed as published

- **GIVEN** a live draft whose document is publishable
- **WHEN** the HS coordinator opens the template console
- **THEN** it appears among the drafts
- **AND** it does not appear among the published templates

#### Scenario: An organisation with nothing published is told what fills the list

- **GIVEN** no template has a published version
- **WHEN** the HS coordinator opens the template console
- **THEN** the published templates section states that publishing a draft is what fills it

### Requirement: Publishing moves a template from the drafts to the published list

The system SHALL, when a draft is published, remove it from the drafts and show the template it
produced among the published templates without requiring the console to be reopened, so that the
act and its result are visible in one place.

#### Scenario: The console reflects a publication

- **GIVEN** the HS coordinator is looking at the template console with one live draft
- **WHEN** that draft is published
- **THEN** the drafts no longer include it
- **AND** the published templates include the template it produced

### Requirement: The templates offered for scheduling are those with a published version

The system SHALL expose the templates available to be scheduled, each carrying its `id`, its
`key`, its `name`, and the `version` number, `template_version_id` and publication timestamp of
its highest published version.

A template with no `template_version` row SHALL NOT be offered, because a schedule rule on such a
template is refused as `template_not_publishable`: a list that offered it would be offering a
rejection.

The version reported SHALL be resolved by **the same expression** the scheduler uses to freeze a
newly opened inspection, so that the version the list names and the version an inspection is bound
to cannot disagree. Reporting a version the scheduler would not choose would be silent: the
coordinator would read `2` on the screen and the inspection would open against `3`. The publication
timestamp reported SHALL be that of the same version, for the same reason.

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

#### Scenario: The key and the publication date name the same version

- **GIVEN** a template whose highest published version is `2`
- **WHEN** the templates are listed
- **THEN** the entry carries the template's `key`
- **AND** the reported publication timestamp is that of version `2`

#### Scenario: The list does not depend on the requester's site scope

- **WHEN** two accounts whose scopes cover different plants list the templates
- **THEN** both receive the same entries

### Requirement: A published version can be read back by its own identity

The system SHALL let an authenticated account read a published template version by the
identifier of that version, without a scheduled inspection standing against it. The response
SHALL carry the frozen `document` together with the identity needed to name it: `template_id`,
`template_version_id`, the template's `key` and `name`, the `version` number and the
`published_at` timestamp of that version.

The read SHALL resolve the version whose identifier was asked for, never the highest published
version of its template. A published version's content SHALL NOT change under a stored link:
reading the same identifier twice SHALL return the same document.

The read SHALL be available on the same terms as the list of templates offered for scheduling.
A template carries no `site_id` and no row-level policy, so the response SHALL NOT depend on
which plants the reading account is scoped to, and SHALL NOT be restricted to the role that
authors templates.

#### Scenario: A published version is read by identity

- **GIVEN** a template published with `latest_version` 1 and `latest_version_id` `V`
- **WHEN** an authenticated account reads the published version `V`
- **THEN** the response carries `template_version_id` `V`, `version` 1, the template's `key`
  and `name`, and the `published_at` of that version
- **AND** the `document` is the one that was frozen at publication, section for section and
  item for item

#### Scenario: The read is not the latest version

- **GIVEN** a template whose versions `1` and `2` are both published
- **WHEN** the identifier of version `1` is read
- **THEN** the response carries `version` 1 and the document of version `1`

#### Scenario: A role that cannot author templates can still read one

- **GIVEN** a published template version
- **WHEN** an account whose role is `supervisor` reads it
- **THEN** the response is the same document the coordinator reads

#### Scenario: The account's plants do not change the answer

- **GIVEN** a template published from a draft written for St. Thomas only
- **WHEN** an account scoped to Glencoe reads that version
- **THEN** the response is returned in full

#### Scenario: An unknown version is refused as not found

- **WHEN** an identifier that names no `template_version` row is read
- **THEN** the request is refused as not found
- **AND** the response carries no partial document

### Requirement: The published version is offered as reading, never as editing

The system SHALL present a published version as a read-only record. The interface that shows it
SHALL NOT offer any way to change its questions, its order, its response types or its prescribed
corrective actions, and SHALL state that what is shown is frozen and that correcting a template
means publishing a new version.

The settings that determine how a question is completed SHALL be legible: its `prompt`, its
`item_key`, whether it is `required`, its `response_type` and that response type's configuration.
That configuration SHALL include bounds, lengths, decimal places, selection limits, photo limits
or choice labels and values whenever the discriminated response type declares them. The interface
SHALL also show the condition under which a question is visible when it declares `visible_when`,
and the complete `finding` prescription when it carries one: its `corrective_action` and
`fails_when` threshold when present.

A section SHALL be shown with its `section_title`, in its published `position`, together with the
shared location it names when it declares one. Positions SHALL be expressed by display order
rather than by exposing their numeric values.

#### Scenario: A prescribed corrective action is shown with its question

- **GIVEN** a published version whose question carries a `finding` block with a
  `corrective_action`
- **WHEN** the version is read on screen
- **THEN** that corrective action is shown against that question

#### Scenario: Response configuration and requirement are shown

- **GIVEN** a published version whose required `multi_choice` question declares three `options`,
  `min_selected` 1 and `max_selected` 2
- **WHEN** the version is read on screen
- **THEN** the question is identified as required
- **AND** the three option labels and values and the two selection limits are shown against it

#### Scenario: A failure threshold is shown with its question

- **GIVEN** a published version whose number question carries a `finding.fails_when` with
  `operator` `gt` and `value` 80
- **WHEN** the version is read on screen
- **THEN** the threshold is shown against that question as a failure above 80

#### Scenario: A conditional question says what shows it

- **GIVEN** a published version whose question declares `visible_when`
- **WHEN** the version is read on screen
- **THEN** the question is shown together with the condition that reveals it, and not hidden

#### Scenario: No editing is offered

- **WHEN** a published version is read on screen
- **THEN** no control is offered that would rename, reorder, add, remove or retype anything in
  it
- **AND** the screen states that a published version is frozen

### Requirement: A published template is reachable from the authoring console

The system SHALL let the coordinator open a published template from the console where templates
are written, using the row that already names it. The published version each row opens SHALL be
the version that row names.

#### Scenario: The published row opens the version it names

- **GIVEN** the authoring console listing a published template at `latest_version` 1
- **WHEN** the coordinator opens that row
- **THEN** the version shown is the one the row named as `latest_version_id`
