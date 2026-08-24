## MODIFIED Requirements

### Requirement: Coverage counts the periods the site owed, at the frequency its rules declare

The system SHALL derive the periods a site owed from `inspection_schedule` rather than from
the scheduled inspections that exist, so that a period the opening job never opened still
appears in the report. A rule SHALL contribute one owed period per period of its own
series — one every `frequency_months` months, counted from `anchor_month` — and not one per
month. Every `scheduled_inspection` in the range SHALL be added to that set, so that a
period opened outside the calendar, or left behind by a rule that has since been
deactivated, is still reported. `required_count` SHALL be the number of owed periods.

The range of a report SHALL select periods by the month in which they begin.

#### Scenario: A year covered by a quarterly rule reports four required periods

- **GIVEN** a site whose only active rule has `frequency_months` `3` and `anchor_month` `1`
- **AND** all four quarters of 2026 were inspected
- **WHEN** the compliance report for 2026 is generated
- **THEN** `required_count` is `4` and `completed_count` is `4`
- **AND** the document reads "4 of 4 required periods completed"

#### Scenario: A quarter the opening job never opened is still counted as owed

- **GIVEN** a site whose only active rule is quarterly and anchored in January
- **AND** no scheduled inspection exists for the quarter starting `2026-07-01`
- **WHEN** the compliance report for 2026 is generated
- **THEN** the quarter starting `2026-07-01` appears with status `missed`
- **AND** `required_count` is `4`

#### Scenario: An owed quarterly period reports the end of its third month

- **GIVEN** a site whose only active rule is quarterly and anchored in January
- **WHEN** the compliance report for 2026 is generated
- **THEN** the first period reports `period_start` `2026-01-01` and `period_end`
  `2026-03-31`

#### Scenario: Rules of different frequencies are both counted

- **GIVEN** a site with an active monthly rule and an active annual rule
- **WHEN** the compliance report for 2026 is generated
- **THEN** `required_count` is `13`

### Requirement: A frozen report stays readable after the payload shape changes

The system SHALL keep every compliance report payload exactly as it was hashed, and SHALL
be able to read a payload produced by any shape version it has ever written. The length of
a period SHALL be optional in the payload, and its absence SHALL mean the report was frozen
when every period was monthly.

#### Scenario: A report frozen before frequencies existed still validates

- **GIVEN** a stored report whose payload has `schema_version` `1` and whose periods carry
  no `period_months`
- **WHEN** the report is read back
- **THEN** it validates against the current contract
- **AND** its stored digest still verifies against its stored payload

#### Scenario: An unknown shape version is refused

- **WHEN** a payload with a `schema_version` the contract has never written is validated
- **THEN** validation fails

### Requirement: The exported document names each period unambiguously

The system SHALL write, for every period of the exported document, both a human-readable
name of the period and its exact first and last day. The name SHALL use a calendar
shorthand only when the period coincides with that calendar unit, so that a period which
does not align with the civil quarter, half or year is written as its two endpoints instead.

#### Scenario: An aligned quarter is named by its shorthand

- **WHEN** a period starting `2026-01-01` with length `3` is written to the document
- **THEN** it is named `Q1 2026`
- **AND** the exact range `2026-01-01` – `2026-03-31` is shown alongside it

#### Scenario: A quarter that does not align with the civil quarter is named by its endpoints

- **WHEN** a period starting `2026-02-01` with length `3` is written to the document
- **THEN** it is named `Feb–Apr 2026` rather than `Q1 2026`

#### Scenario: A period that crosses the year names both years

- **WHEN** a period starting `2026-09-01` with length `12` is written to the document
- **THEN** it is named `Sep 2026–Aug 2027` rather than `2026`
