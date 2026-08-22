## MODIFIED Requirements

### Requirement: What counts as a negative answer is fixed by response type

The system SHALL treat as negative exactly two answers: a `yes_no` answer whose value is
`false`, and a `yes_no_na` answer whose value is `no`. A `yes_no_na` answer of `na` SHALL NOT
produce a finding — "not applicable" is a third answer, not a failure. No `scale`, `number`,
`text`, `single_choice`, `multi_choice`, `photo` or `signature` answer SHALL produce a finding.
A failure threshold authored on a `scale` or `number` template question SHALL NOT change this:
the threshold is data the author wrote down, the engine does not read it, and an answer that
crosses it produces no finding. An answer for an item the submission's own answers hide SHALL NOT
produce a finding, because it is not part of the answer set at all. The rule SHALL be evaluated by
the same shared form engine code on the device and on the server, so that what the inspector was
asked to describe is exactly what the server derives.

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
