## MODIFIED Requirements

### Requirement: A scheduled inspection reports the compliance status of its period

The system SHALL expose, for every non-cancelled `scheduled_inspection`, a period status derived
from the engine rather than stored as a column: `completed` when an `inspection` exists for it,
`open` when its `period_end` has not yet passed in the `America/Toronto` calendar and no
`inspection` exists, and `missed` when its `period_end` has passed and no `inspection` exists. A
cancelled scheduled inspection SHALL report `cancelled` together with its `cancellation_reason`.
The status SHALL NOT depend on `recorded_at`: an inspection walked before `period_end` and
synchronised after it SHALL report `completed` for that period because `signed_at` records when
the inspection occurred.

The status SHALL accompany a scheduled inspection wherever it is listed. The system SHALL derive
it from one shared expression so that every scheduled-inspection reader applies the same
`America/Toronto` boundary.

#### Scenario: A late synchronisation still completes its period

- **GIVEN** a scheduled inspection whose `period_end` is `2026-08-31`
- **AND** a submission whose `signed_at` is `2026-08-28` and whose `received_at` is `2026-09-04`
- **WHEN** the period status is read
- **THEN** it is `completed`

#### Scenario: Every listing agrees on the same scheduled inspection

- **GIVEN** a scheduled inspection visible in more than one operational listing
- **WHEN** those listings are read at the same effective instant
- **THEN** they report the same status for its `scheduled_inspection_id`

#### Scenario: The status is available without naming a site or a range

- **WHEN** the scheduled inspections within the session's site scope are listed with no site
  parameter and no period range
- **THEN** every entry carries its period status

#### Scenario: A period still running is open, not missed

- **GIVEN** a scheduled inspection of the current period with no submission
- **WHEN** its period status is read
- **THEN** it is `open`

#### Scenario: A closed period without a submission is missed

- **GIVEN** a scheduled inspection whose `period_end` has passed, not cancelled, with no
  submission
- **WHEN** its period status is read
- **THEN** it is `missed`

#### Scenario: A cancelled period reports its reason

- **GIVEN** a scheduled inspection cancelled with the reason `plant shutdown`
- **WHEN** its period status is read
- **THEN** it is `cancelled` and carries the reason `plant shutdown`

## ADDED Requirements

### Requirement: Inspection periods have one unambiguous human-readable label

The system SHALL derive an inspection period's English display label from `period_start` and
`period_months` through one shared deterministic rule. A monthly period SHALL name its full month
and year. A quarterly, semiannual or annual period SHALL use a calendar shorthand only when its
start aligns with that civil calendar unit; otherwise it SHALL name its start and end months. A
label for a period that crosses a year boundary SHALL name both years. The label SHALL NOT depend
on the locale or time zone of the reading device.

#### Scenario: An aligned quarter uses calendar shorthand

- **WHEN** a period with `period_start` `2026-01-01` and `period_months` `3` is displayed
- **THEN** its label is `Q1 2026`

#### Scenario: An unaligned quarter names its endpoints

- **WHEN** a period with `period_start` `2026-02-01` and `period_months` `3` is displayed
- **THEN** its label is `Feb–Apr 2026`
- **AND** it is not labelled `Q1 2026`

#### Scenario: A period crossing a year names both years

- **WHEN** a period with `period_start` `2026-09-01` and `period_months` `12` is displayed
- **THEN** its label is `Sep 2026–Aug 2027`

#### Scenario: A monthly period names its month and year

- **WHEN** a period with `period_start` `2026-08-01` and `period_months` `1` is displayed
- **THEN** its label is `August 2026`

## REMOVED Requirements

### Requirement: A period the site owed but never opened is reported as missed, not as absent

**Reason**: This synthetic row exists only for the removed aggregate compliance coverage. An unopened owed period is not a `scheduled_inspection` and therefore has no operational status row.

**Migration**: Continue projecting owed but unopened periods in the annual scheduling surface as `not opened`; remove the compliance-only `missed` projection and its `required_count` aggregation.
