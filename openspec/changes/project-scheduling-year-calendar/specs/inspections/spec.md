## ADDED Requirements

### Requirement: A schedule rule carries the window during which it owes periods

The system SHALL accompany every listed schedule rule with `created_at`, alongside the
`deactivated_at` it already carries. Together they bound the months the rule owes: a rule owes
every month from the month containing `created_at` through the month containing
`deactivated_at`, inclusive at both ends, and owes no month outside that window.

This is required because a reader that projects the obligation forward or backward from the rule
alone cannot otherwise tell a month the site owed and never opened from a month that predates the
rule and was never owed at all.

Both timestamps SHALL be resolved to a month in the `America/Toronto` calendar, the same calendar
the opening job resolves the current period in, so that a rule created on the last day of a month
late in the evening owes that month and not the next one.

#### Scenario: A listed rule carries the month it started owing

- **GIVEN** a schedule rule created on `2026-03-12`
- **WHEN** the schedule rules are listed
- **THEN** the entry carries `created_at` on `2026-03-12`
- **AND** its `deactivated_at` is null

#### Scenario: The owing window is resolved in the site's calendar

- **GIVEN** a schedule rule whose `created_at` is `2026-04-01T02:00:00Z`, which is `2026-03-31` in
  `America/Toronto`
- **WHEN** the months that rule owes are derived
- **THEN** the first month it owes is `2026-03`, not `2026-04`

### Requirement: The scheduling surface projects every period a site owes for a calendar year

The system SHALL present the scheduled inspections of a site as a calendar year: for a chosen
year, every month that year that any of the site's schedule rules owes, one entry per rule per
owed month, ordered from January to December.

An entry whose period has been opened SHALL carry the scheduled inspection itself — its status,
its `inspector_id` and its inspector's name — exactly as the scheduled inspections listing
describes it today. An entry whose period has **not** been opened SHALL still be present and
SHALL be identified as not opened, rather than omitted.

The reader SHALL be able to move to another calendar year, in both directions, without limit on
how far ahead: the obligation is monthly and therefore known for any future year.

A month a rule does not owe — outside the window of that rule's `created_at` and
`deactivated_at` — SHALL NOT be projected as a missing period, because the site never owed it.

A scheduled inspection whose `period_start` falls outside every rule's owing window — one
scheduled outside the automatic calendar, or one left behind by a rule that was deactivated —
SHALL still be shown in the year it belongs to. The projection adds months that are owed; it
never hides a period that exists.

#### Scenario: A year with one rule shows twelve entries

- **GIVEN** a site with one active schedule rule created in `2025`
- **AND** scheduled inspections opened for `2026-01-01` through `2026-08-01`
- **WHEN** the coordinator views the year `2026`
- **THEN** twelve entries are shown for that rule, one per month
- **AND** the entries for January through August carry their scheduled inspection
- **AND** the entries for September through December are identified as not opened

#### Scenario: A future year is entirely unopened

- **GIVEN** the same site and rule
- **WHEN** the coordinator moves to the year `2027`
- **THEN** twelve entries are shown, every one of them identified as not opened

#### Scenario: A month before the rule existed is not projected

- **GIVEN** a schedule rule whose `created_at` is in `2026-03`
- **WHEN** the coordinator views the year `2026`
- **THEN** the entries for January and February are not shown for that rule
- **AND** the entry for March is shown

#### Scenario: A month after the rule was deactivated is not projected

- **GIVEN** a schedule rule whose `deactivated_at` is in `2026-09`
- **WHEN** the coordinator views the year `2026`
- **THEN** the entry for September is shown
- **AND** no entry is shown for that rule for October through December

#### Scenario: A period of a deactivated rule is still shown

- **GIVEN** a scheduled inspection for `2026-10-01` whose rule was deactivated in `2026-09`
- **WHEN** the coordinator views the year `2026`
- **THEN** that scheduled inspection is shown under October

#### Scenario: A cancelled period reads as cancelled, not as unopened

- **GIVEN** the only scheduled inspection for `2026-05-01` has been cancelled
- **WHEN** the coordinator views the year `2026`
- **THEN** the May entry carries the cancelled inspection and its cancellation reason
- **AND** May is not identified as not opened

### Requirement: The coordinator can open an owed month ahead of the automatic job

The system SHALL let an account whose role is `hs_coordinator` open a not-yet-opened month
directly from the year projection, creating the scheduled inspection for that `site_id`,
`template_id` and `period_start` and optionally naming its `inspector_id` in the same act. No
other role SHALL be offered or allowed that operation.

A period opened this way SHALL be indistinguishable from one the job opened, except that
`scheduled_by` names the coordinator rather than being null. The opening job SHALL NOT create a
second inspection when it later reaches that month.

The created inspection SHALL be bound to the highest published version of its template **at the
moment the coordinator opens it**, not at the moment the period begins, and that binding is
frozen thereafter. This is the stated cost of planning ahead, and it is why the automatic job is
not made to open months in advance: opening a month early freezes a template version early, and
the row cannot be corrected afterwards.

#### Scenario: Opening a future month from its empty entry

- **GIVEN** the year `2027` where no period is opened
- **WHEN** the coordinator opens the entry for `2027-04-01` and names an eligible inspector
- **THEN** a scheduled inspection exists for that site, template and `period_start`
- **AND** it carries that `inspector_id`
- **AND** the entry for April now reads as an opened period

#### Scenario: The job does not duplicate a period opened ahead

- **GIVEN** a scheduled inspection the coordinator opened for a month that has not begun
- **WHEN** that month becomes the current period and the opening job runs
- **THEN** exactly one non-cancelled scheduled inspection exists for that site, template and
  `period_start`

#### Scenario: A period opened ahead freezes today's version

- **GIVEN** a template whose highest published version is `2`
- **WHEN** the coordinator opens a period six months ahead
- **AND** version `3` of that template is published before the period begins
- **THEN** the scheduled inspection's `template_version` is still `2`

#### Scenario: A JHSC member is not offered the operation

- **WHEN** an account whose role is `jhsc_member` views the year projection
- **THEN** no control to open a month is offered
- **AND** a request to create a scheduled inspection from that account is rejected as forbidden
