## ADDED Requirements

### Requirement: A question can prescribe what to do when it fails

The system SHALL let a draft question carry an optional `finding` block that records what the
organization has already decided about that question's failure: a `corrective_action` describing
the work to be done, and a `control_level` naming where that work sits in the hierarchy of
controls — `elimination`, `substitution`, `engineering`, `administrative` or `ppe`.

The block SHALL be optional on every response type. A question without it SHALL remain publishable,
because most questions carry no standing answer to their own failure and inventing one would make
the prescription worthless where it matters.

The block SHALL travel inside the draft document, alongside the prompt and the answer settings of
the question it belongs to, so that duplicating a question or moving it between positions carries
the prescription with it and never leaves it behind.

The system SHALL NOT judge the prescription. A `ppe` answer to a question about a missing machine
guard SHALL be stored exactly as authored: that the proposed control was a pair of gloves is
precisely the fact that has to remain visible afterwards.

#### Scenario: A question is saved with its prescription

- **WHEN** a draft is saved with a `yes_no` item whose `finding` block carries a
  `corrective_action` and a `control_level` of `engineering`
- **THEN** the save succeeds
- **AND** reading the draft returns that item with the same `corrective_action` and
  `control_level`

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
- **THEN** the copy carries the same `corrective_action` and `control_level`
- **AND** the copy carries its own `item_key`

#### Scenario: An unknown control level is refused outright

- **WHEN** a draft is saved with a `finding` block whose `control_level` is not one of the five
  levels of the hierarchy
- **THEN** the save is rejected
- **AND** the draft's stored document is unchanged

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
- **THEN** the item keeps its `corrective_action` and its `control_level`
- **AND** the item no longer carries a `fails_when`

## MODIFIED Requirements

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
  `prompt`, a valid `item_key` and a `finding` block with a non-empty `corrective_action` and a
  valid `control_level`
- **WHEN** the draft is read
- **THEN** it is reported as publishable
- **AND** no issues are reported

#### Scenario: An unknown response type is refused outright

- **WHEN** a draft is saved with an item whose `response_type` is not one of the nine declared types
- **THEN** the save is rejected
- **AND** the draft's stored document is unchanged
