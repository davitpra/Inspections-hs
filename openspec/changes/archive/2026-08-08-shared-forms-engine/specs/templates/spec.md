## MODIFIED Requirements

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

## ADDED Requirements

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
