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

### Requirement: An incomplete draft is saved and reports what it lacks

The system SHALL accept and store a draft whose document could not be published — a section with no
items, an item with an empty prompt, an item whose configuration contradicts itself — because a
document being authored is incomplete for most of its life, and a save that refused it would force
the author to finish a section before leaving it.

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

The system SHALL restrict reading, creating, saving and discarding a template draft to the HS
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
