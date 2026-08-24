## MODIFIED Requirements

### Requirement: A schedule rule declares what a site owes and how often

The system SHALL store recurrence rules in `inspection_schedule` with `site_id`,
`template_id`, `frequency_months`, `anchor_month`, `default_inspector_id`, `created_at` and
`deactivated_at`. `frequency_months` SHALL be one of `1`, `3`, `6` or `12`, and
`anchor_month` SHALL be between `1` and `12`. A rule SHALL mean that the site owes one
inspection of that template for every period that begins in a month `M` where
`(M - anchor_month) mod frequency_months` is zero, while the rule is active. At most one
active rule SHALL exist per `(site_id, template_id)`, regardless of frequency. A rule SHALL
never be deleted: it is deactivated, and a deactivated rule SHALL stop producing new
periods while every inspection it already produced stays valid.

An attempt to create a rule that collides with an active one SHALL be refused with a stated
reason naming the site and the template, and SHALL NOT surface as an unhandled failure. The
uniqueness SHALL remain enforced by the database rather than by a check performed before
the insert, so that two concurrent creations converge on one rule.

When the coordinator does not state an anchor month, the system SHALL resolve it to the
current civil month in the site's calendar rather than accepting one from the client.

#### Scenario: A quarterly rule owes four periods a year, not twelve

- **GIVEN** an active rule for site St. Thomas with `frequency_months` `3` and
  `anchor_month` `1`
- **WHEN** the periods that site owes for 2026 are listed
- **THEN** exactly four periods are owed, starting `2026-01-01`, `2026-04-01`,
  `2026-07-01` and `2026-10-01`

#### Scenario: The anchor month shifts the series

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `2`
- **WHEN** the periods that site owes for 2026 are listed
- **THEN** the periods start `2026-02-01`, `2026-05-01`, `2026-08-01` and `2026-11-01`

#### Scenario: A frequency that does not divide twelve is rejected

- **WHEN** a rule is inserted with `frequency_months` `5`
- **THEN** the insert fails with a check violation on `frequency_months`

#### Scenario: A second active rule for the same site and template is rejected regardless of frequency

- **GIVEN** an active monthly rule for site St. Thomas and the monthly safety template
- **WHEN** a quarterly rule is created for the same site and the same template
- **THEN** the insert fails with a unique violation
- **AND** the message names `site_id` and `template_id`

#### Scenario: The anchor month is resolved by the server when it is not stated

- **GIVEN** the current civil month at the site is September
- **WHEN** the coordinator creates an annual rule without stating an anchor month
- **THEN** the stored rule has `anchor_month` `9`

### Requirement: The frequency and anchor of a rule are assigned once

The system SHALL make `frequency_months` and `anchor_month` immutable once an
`inspection_schedule` row exists. Changing how often a site owes an inspection SHALL be
done by deactivating the rule and creating a new one, never by updating it, so that the
coverage already reported for past periods cannot be rewritten.

#### Scenario: The application role cannot change the frequency

- **WHEN** a session connected as the application role runs
  `UPDATE inspection_schedule SET frequency_months = 3 WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `frequency_months` is unchanged when read back

#### Scenario: The owner role cannot change the anchor month

- **WHEN** a session connected as the migration role — which owns the table — runs
  `UPDATE inspection_schedule SET anchor_month = 4 WHERE id = <existing id>`
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a
  privilege error

#### Scenario: The update contract does not accept the frequency

- **WHEN** a request to update a rule carries `frequency_months`
- **THEN** the request is rejected as malformed rather than silently ignoring the field

### Requirement: A scheduled inspection binds a site, a period of a stated length and a frozen template version

The system SHALL store every scheduled inspection in `scheduled_inspection` with `site_id`,
`period_start`, `period_months`, `template_id`, `template_version_id`, `inspector_id`,
`scheduled_at` and `scheduled_by`. `period_start` SHALL be the first calendar day of the
first month the inspection covers. `period_months` SHALL be copied from the rule that
opened it rather than read from the rule by reference, so that deactivating or replacing a
rule cannot change the shape of a period that already exists. `period_end` SHALL be derived
from `period_start` and `period_months` as the last calendar day of the last month covered,
rather than stored independently. `template_version_id` SHALL reference a published version
of `template_id`, and the pair SHALL be enforced by the engine so that a scheduled
inspection cannot name a version belonging to a different template.

#### Scenario: A quarterly period ends on the last day of its third month

- **WHEN** a scheduled inspection is read back with `period_start` `2026-01-01` and
  `period_months` `3`
- **THEN** `period_end` is `2026-03-31`

#### Scenario: A period end still lands correctly on a leap February

- **WHEN** a scheduled inspection is read back with `period_start` `2027-12-01` and
  `period_months` `3`
- **THEN** `period_end` is `2028-02-29`

#### Scenario: A period that does not start on the first of a month is rejected

- **WHEN** a row is inserted with `period_start` `2026-08-15`
- **THEN** the insert fails with a check violation on `period_start`

#### Scenario: The length of a period cannot be changed

- **WHEN** any role runs
  `UPDATE scheduled_inspection SET period_months = 1 WHERE id = <existing id>`
- **THEN** the statement fails and `period_months` is unchanged when read back

#### Scenario: Scheduling outside the calendar inherits the length from the active rule

- **GIVEN** an active quarterly rule for a site and template
- **WHEN** the coordinator schedules that template for a period outside the calendar
- **THEN** the created scheduled inspection has `period_months` `3`

#### Scenario: Scheduling a template with no rule produces a monthly period

- **GIVEN** no active rule for a site and template
- **WHEN** the coordinator schedules that template for a period
- **THEN** the created scheduled inspection has `period_months` `1`

### Requirement: The period opening job opens the period that contains the current month

The system SHALL, for each active rule, open the period that contains the current civil
month in the site's calendar, rather than opening only when the current month is the first
month of a period. Running the job on any day of a period SHALL converge on the same
`period_start`, and repeated runs SHALL leave exactly one scheduled inspection for that
period.

#### Scenario: A quarter is still opened when the job did not run on its first day

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `1`
- **AND** the job did not run during January
- **WHEN** the job runs on 15 February 2026
- **THEN** one scheduled inspection is created with `period_start` `2026-01-01` and
  `period_end` `2026-03-31`

#### Scenario: Running every day of a quarter opens it once

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `1`
- **WHEN** the job runs on every day of January, February and March 2026
- **THEN** exactly one scheduled inspection exists for `period_start` `2026-01-01`

#### Scenario: A period anchored late in the year is resolved across the year boundary

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `11`
- **WHEN** the job runs in January 2027
- **THEN** the period it resolves starts `2026-11-01`

### Requirement: The coordinator is notified once per site for each opening run

The system SHALL notify every active coordinator with scope on a site when that run opened
at least one inspection there, deduplicated by site and by the month the run resolved. The
notification payload SHALL carry the period start, end and length of each opened
inspection individually, because rules of different frequencies opened by the same run
cover different periods.

#### Scenario: One notification lists inspections of different lengths

- **GIVEN** a monthly rule and a quarterly rule that both open in the same run
- **WHEN** the job runs
- **THEN** the coordinator receives one notification
- **AND** its payload lists both inspections, each with its own `period_start`,
  `period_end` and `period_months`
