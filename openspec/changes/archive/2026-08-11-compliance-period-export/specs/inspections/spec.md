## ADDED Requirements

### Requirement: A scheduled inspection reports the compliance status of its period

The system SHALL expose, for every non-cancelled `scheduled_inspection`, a compliance status
derived from the engine rather than stored as a column: `completed` when an `inspection` exists
for it, `open` when its `period_end` has not yet passed in the `America/Toronto` calendar and no
`inspection` exists, and `missed` when its `period_end` has passed and no `inspection` exists. A
cancelled scheduled inspection SHALL report `cancelled` together with its `cancellation_reason`.
The status SHALL NOT depend on `recorded_at`: an inspection walked before `period_end` and
synchronised after it SHALL report `completed` for that period, because §5 risk C fixed the device
clock at signing as the compliance clock.

#### Scenario: A late synchronisation still completes its period

- **GIVEN** a scheduled inspection whose `period_end` is `2026-08-31`
- **AND** a submission whose `occurred_at` is `2026-08-28` and whose `recorded_at` is
  `2026-09-04`
- **WHEN** the period's compliance status is read
- **THEN** it is `completed`

#### Scenario: A period still running is open, not missed

- **GIVEN** a scheduled inspection of the current period with no submission
- **WHEN** its compliance status is read
- **THEN** it is `open`

#### Scenario: A closed period without a submission is missed

- **GIVEN** a scheduled inspection whose `period_end` has passed, not cancelled, with no
  submission
- **WHEN** its compliance status is read
- **THEN** it is `missed`

#### Scenario: A cancelled period reports its reason

- **GIVEN** a scheduled inspection cancelled with the reason `plant shutdown`
- **WHEN** its compliance status is read
- **THEN** it is `cancelled` and carries the reason `plant shutdown`

### Requirement: A period the site owed but never opened is reported as missed, not as absent

The system SHALL determine the periods a site owed over a range from its schedule rules and their
active windows, and SHALL report a period in which a rule was active but no `scheduled_inspection`
was ever created as `missed`, with a null `scheduled_inspection_id` and a null
`template_version_id`. A period that was never opened SHALL NOT be silently omitted from the
count of required periods, because the opening job failing for a month is exactly the case a
coverage report exists to make visible. A period whose rule was deactivated before the period
began SHALL NOT be counted as owed.

#### Scenario: A month the opening job never ran is counted and reported as missed

- **GIVEN** a site with an active monthly schedule rule covering all of `2026`
- **AND** no `scheduled_inspection` for `2026-04-01` because the opening job did not run that
  month
- **WHEN** compliance is reported for the twelve months of `2026`
- **THEN** `required_count` is `12`
- **AND** the entry for `2026-04-01` has `status` `missed` and a null `scheduled_inspection_id`

#### Scenario: A period before the rule existed is not owed

- **GIVEN** a schedule rule activated in `2026-05`
- **WHEN** compliance is reported for the twelve months of `2026`
- **THEN** no period entry is returned for `2026-01-01`
- **AND** `required_count` counts only the periods from `2026-05` onward

#### Scenario: A deactivated rule stops the site owing later periods

- **GIVEN** a schedule rule deactivated during `2026-09`
- **WHEN** compliance is reported for the twelve months of `2026`
- **THEN** no period entry is returned for `2026-11-01`
- **AND** the inspections the rule already opened remain reported for their own periods
