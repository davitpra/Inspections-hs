## Purpose

Defines the obligation to inspect and its fulfilment: which site owes which inspection for which
monthly period, against which published template version and by whom, and what happens when the
inspector submits it. It guarantees that the template version an inspection was opened against is
frozen at scheduling time and cannot be moved by a later publication, that a period is opened
exactly once per site and template no matter how many times the opening job runs, and that every
inspector can see what they still owe. It further guarantees that a submission is recorded exactly
once however many times a device retries it, that a rejected submission leaves no partial state,
and that every answer is stored as its own row keyed by the stable concept the recurrence report
groups by.

## Requirements

### Requirement: A scheduled inspection binds a site, a period of a stated length and a frozen template version

The system SHALL store every scheduled inspection in `scheduled_inspection` with `site_id`,
`period_start`, `period_months`, `template_id`, `template_version_id`, `inspector_id`,
`scheduled_at` and `scheduled_by`. `period_start` SHALL be the first calendar day of the first
month the inspection covers. `period_months` SHALL be copied from the rule that opened it rather
than read from the rule by reference, so that deactivating or replacing a rule cannot change the
shape of a period that already exists. `period_end` SHALL be derived from `period_start` and
`period_months` as the last calendar day of the last month covered, rather than stored
independently. `template_version_id` SHALL reference a published version of `template_id`, and
the pair SHALL be enforced by the engine so that a scheduled inspection cannot name a version
belonging to a different template.

#### Scenario: A period that does not start on the first of a month is rejected

- **WHEN** a row is inserted with `period_start` `2026-08-15`
- **THEN** the insert fails with a check violation on `period_start`

#### Scenario: A quarterly period ends on the last day of its third month

- **WHEN** a scheduled inspection is read back with `period_start` `2026-01-01` and
  `period_months` `3`
- **THEN** `period_end` is `2026-03-31`

#### Scenario: A period end still lands correctly on a leap February

- **WHEN** a scheduled inspection is read back with `period_start` `2027-12-01` and
  `period_months` `3`
- **THEN** `period_end` is `2028-02-29`

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

#### Scenario: A version belonging to another template is rejected

- **WHEN** a row is inserted whose `template_id` is template A and whose `template_version_id` is a
  published version of template B
- **THEN** the insert fails with a foreign key violation on the `(template_version_id, template_id)`
  pair

### Requirement: The template version of a scheduled inspection is frozen by the engine

The system SHALL make `site_id`, `period_start`, `period_months`, `template_id`,
`scheduled_at` and `scheduled_by` immutable once a `scheduled_inspection` row exists.

`template_version_id` SHALL be monotonic rather than immutable: it SHALL only ever be
replaced by a version of the same `template_id` whose `version` is strictly greater, it
SHALL NOT be changed once an `inspection` row exists for that scheduled inspection, and it
SHALL NOT be changed on a cancelled row. Every other move — to a lower version, to a version
of another template, on a submitted period, on a cancelled period — SHALL be refused by the
engine for every role, the owning role included.

Publishing a new version of a template SHALL have no effect of its own on any scheduled
inspection that already exists. Moving an inspection to a newer version SHALL always be an
explicit act.

#### Scenario: The application role can advance a scheduled inspection to a newer version

- **GIVEN** a scheduled inspection bound to version `2` of a template whose version `3` is
  published
- **WHEN** a session connected as the application role runs
  `UPDATE scheduled_inspection SET template_version_id = <version 3 of the same template>
  WHERE id = <existing id>`
- **THEN** the statement succeeds
- **AND** `template_version_id` reads back as version `3`

#### Scenario: No role can move a scheduled inspection to a lower version

- **GIVEN** a scheduled inspection bound to version `3` of a template
- **WHEN** any role — the application role or the migration role that owns the table — runs
  `UPDATE scheduled_inspection SET template_version_id = <version 2 of the same template>
  WHERE id = <existing id>`
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE
- **AND** `template_version_id` is unchanged when read back

#### Scenario: A version belonging to another template is still refused

- **WHEN** the `template_version_id` of a scheduled inspection whose `template_id` is
  template A is updated to a published version of template B
- **THEN** the statement fails with the foreign key violation on the
  `(template_version_id, template_id)` pair

#### Scenario: A submitted inspection cannot be moved to another version

- **GIVEN** a scheduled inspection for which an `inspection` row exists
- **WHEN** its `template_version_id` is updated to a higher version of the same template
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE
- **AND** the `inspection` row's own `template_version_id` is unchanged

#### Scenario: A cancelled period cannot be moved to another version

- **GIVEN** a scheduled inspection whose `cancelled_at` is not null
- **WHEN** its `template_version_id` is updated to a higher version of the same template
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE

#### Scenario: Publishing a newer version leaves an open inspection untouched

- **GIVEN** a scheduled inspection open against version `2` of a template
- **WHEN** version `3` of that template is published
- **THEN** the scheduled inspection still reports `template_version_id` for version `2`
- **AND** no row of `scheduled_inspection` was written by the publication

### Requirement: A scheduled inspection can be advanced to the newest published version of its template

The system SHALL accept a request to advance one scheduled inspection to the highest
published version of its own template, and SHALL respond with the same field package the
frozen template version read returns: the complete document, its `template_version_id`, its
`version`, the inspection's `site_id` and the inspection's `inspector_id`.

The request SHALL be restricted to the account the inspection is assigned to and to accounts
whose role is `hs_coordinator`, and SHALL be refused as forbidden to every other account.
Advancing SHALL be resolvable only within the requester's session scope, on the same terms as
every other read of the field package.

The request SHALL be idempotent: when the inspection is already bound to the highest published
version, it SHALL write nothing and SHALL still return the package. It SHALL be refused when
the period already has a submission, when the period is cancelled, and when the template has
no version higher than the one the inspection is bound to.

Advancing SHALL be recorded in the audit log of the inspection's site as an event of its own,
naming the acting account, the `template_version_id` the inspection was bound to and the one
it is now bound to. It SHALL NOT be recorded as a reassignment or as a cancellation, and a
request that writes nothing SHALL add no entry.

#### Scenario: The assigned inspector advances to the newest version

- **GIVEN** a scheduled inspection assigned to the requesting account and bound to version `2`
  of a template whose version `3` is published
- **WHEN** the account requests the advance
- **THEN** the inspection reports `template_version_id` for version `3`
- **AND** the response carries the document of version `3` and its `version` number

#### Scenario: Advancing twice writes once

- **GIVEN** a scheduled inspection that has just been advanced to version `3`
- **WHEN** the same advance is requested again
- **THEN** the response carries version `3`
- **AND** exactly one `inspection.version_advanced` entry exists for that inspection

#### Scenario: An inspection already on the newest version is not an error

- **GIVEN** a scheduled inspection bound to the highest published version of its template
- **WHEN** the advance is requested
- **THEN** the response carries that same version
- **AND** no audit entry is added

#### Scenario: A submitted period cannot be advanced

- **GIVEN** a scheduled inspection whose submission has been accepted
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was already submitted
- **AND** `template_version_id` is unchanged

#### Scenario: A cancelled period cannot be advanced

- **GIVEN** a scheduled inspection whose `cancelled_at` is not null
- **WHEN** the advance is requested
- **THEN** the request is refused and names that the period was cancelled

#### Scenario: An account that is neither the inspector nor a coordinator is refused

- **GIVEN** a scheduled inspection assigned to another account
- **WHEN** an account whose role is `supervisor` requests the advance
- **THEN** the request is refused as forbidden
- **AND** `template_version_id` is unchanged

#### Scenario: The advance is audited with both versions

- **WHEN** an inspection bound to version `2` is advanced to version `3`
- **THEN** an audit log entry of type `inspection.version_advanced` is written for the
  inspection's `site_id` naming the acting account, the `scheduled_inspection_id`, the
  previous `template_version_id` and the new one

### Requirement: An inspector's pending list names the version published today

The system SHALL carry, on every entry of the pending list, the `version` of the
`template_version_id` the inspection is bound to, together with the `version` and the
`template_version_id` of the highest published version of that template.

The two SHALL be distinct fields and SHALL NOT be conflated: the inspection is bound to the
first and is not bound to the second until an advance is requested. They SHALL be resolved by
the server with the same expression the period opening job uses to freeze a version, so that
what the screen offers and what an advance would produce cannot disagree.

#### Scenario: The pending list carries both versions

- **GIVEN** an inspection bound to version `2` of a template whose version `3` is published
- **WHEN** the assigned inspector reads their pending list
- **THEN** the entry reports `template_version` `2`
- **AND** it reports `latest_template_version` `3` and the `template_version_id` of version `3`

#### Scenario: An inspection on the newest version reports the same version twice

- **GIVEN** an inspection bound to the highest published version of a template
- **WHEN** the assigned inspector reads their pending list
- **THEN** `template_version` and `latest_template_version` are the same number
- **AND** `template_version_id` and `latest_template_version_id` are the same identifier

### Requirement: A schedule rule declares what a site owes and how often

The system SHALL store recurrence rules in `inspection_schedule` with `site_id`,
`template_id`, `frequency_months`, `anchor_month`, `default_inspector_id`, `created_at` and
`deactivated_at`. `frequency_months` SHALL be one of `1`, `3`, `6` or `12`, and `anchor_month`
SHALL be between `1` and `12`. A rule SHALL mean that the site owes one inspection of that template
for every period that begins in a month `M` where `(M - anchor_month) mod frequency_months` is
zero, while the rule is active. At most one active rule SHALL exist per `(site_id, template_id)`,
regardless of frequency. A rule SHALL never be deleted: it is deactivated, and a deactivated rule
SHALL stop producing new periods while every inspection it already produced stays valid.

An attempt to create a rule that collides with an active one SHALL be refused with a stated reason
naming the site and the template, and SHALL NOT surface as an unhandled failure. The uniqueness
SHALL remain enforced by the database rather than by a check performed before the insert, so that
two concurrent creations converge on one rule.

#### Scenario: A quarterly rule owes four periods a year, not twelve

- **GIVEN** an active rule for site St. Thomas with `frequency_months` `3` and `anchor_month` `1`
- **WHEN** the periods that site owes for 2026 are listed
- **THEN** exactly four periods are owed, starting `2026-01-01`, `2026-04-01`, `2026-07-01` and
  `2026-10-01`

#### Scenario: The anchor month shifts the series

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `2`
- **WHEN** the periods that site owes for 2026 are listed
- **THEN** the periods start `2026-02-01`, `2026-05-01`, `2026-08-01` and `2026-11-01`

#### Scenario: A frequency that does not divide twelve is rejected

- **WHEN** a rule is inserted with `frequency_months` `5`
- **THEN** the insert fails with a check violation on `frequency_months`

#### Scenario: A second active rule for the same site and template is rejected regardless of frequency

- **GIVEN** an active rule for site St. Thomas and the monthly safety template
- **WHEN** a second rule is created for the same site and the same template
- **THEN** the insert fails with a unique violation
- **AND** the message names `site_id` and `template_id`

#### Scenario: The duplicate is reported, not raised as an unhandled failure

- **GIVEN** an active rule for site St. Thomas and the monthly safety template
- **WHEN** the coordinator requests a second rule for the same site and the same template
- **THEN** the response carries a dedicated error code rather than an unhandled server failure
- **AND** exactly one active rule exists for that site and template

#### Scenario: A rule can be recreated after deactivation

- **GIVEN** a rule for site St. Thomas and the monthly safety template with `deactivated_at` set
- **WHEN** a new rule is created for the same site and the same template
- **THEN** the insert succeeds and both rows are present

#### Scenario: A deactivated rule stops opening periods

- **GIVEN** a rule deactivated during the current period
- **WHEN** the period opening job runs
- **THEN** no scheduled inspection is created for that rule
- **AND** the inspections that rule opened in previous periods are unchanged

#### Scenario: The anchor month is resolved by the server when it is not stated

- **GIVEN** the current civil month at the site is September
- **WHEN** the coordinator creates an annual rule without stating an anchor month
- **THEN** the stored rule has `anchor_month` `9`

#### Scenario: A rule whose template has no published version cannot be created

- **WHEN** a rule is created for a template that has no `template_version` row
- **THEN** the request is rejected and names the template as having nothing publishable to inspect

### Requirement: The frequency and anchor of a rule are assigned once

The system SHALL make `frequency_months` and `anchor_month` immutable once an
`inspection_schedule` row exists. Changing how often a site owes an inspection SHALL be done by
deactivating the rule and creating a new one, never by updating it, so that the coverage already
reported for past periods cannot be rewritten.

#### Scenario: The application role cannot change the frequency

- **WHEN** a session connected as the application role runs
  `UPDATE inspection_schedule SET frequency_months = 3 WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** `frequency_months` is unchanged when read back

#### Scenario: The owner role cannot change the anchor month

- **WHEN** a session connected as the migration role — which owns the table — runs
  `UPDATE inspection_schedule SET anchor_month = 4 WHERE id = <existing id>`
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE, not with a privilege
  error

#### Scenario: The update contract does not accept the frequency

- **WHEN** a request to update a rule carries `frequency_months`
- **THEN** the request is rejected as malformed rather than silently ignoring the field

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

### Requirement: The period opening job opens the period that contains the current month

The system SHALL, for each active rule, open the period that contains the current civil month in
the site's calendar, rather than opening only when the current month is the first month of a period.
Running the job on any day of a period SHALL converge on the same `period_start`, and repeated runs
SHALL leave exactly one scheduled inspection for that period.

#### Scenario: A quarter is still opened when the job did not run on its first day

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `1`
- **AND** the job did not run during January
- **WHEN** the job runs on 15 February 2026
- **THEN** one scheduled inspection is created with `period_start` `2026-01-01` and `period_end`
  `2026-03-31`

#### Scenario: Running the job twice creates one inspection

- **GIVEN** one active rule and no scheduled inspection for the current period
- **WHEN** the period opening job runs, and then runs again
- **THEN** exactly one `scheduled_inspection` row exists for that site, template and period
- **AND** the second run reports zero inspections created

#### Scenario: Running every day of a quarter opens it once

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `1`
- **WHEN** the job runs on every day of January, February and March 2026
- **THEN** exactly one scheduled inspection exists for `period_start` `2026-01-01`

#### Scenario: A period anchored late in the year is resolved across the year boundary

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `11`
- **WHEN** the job runs in January 2027
- **THEN** the period it resolves starts `2026-11-01`

#### Scenario: The period is resolved in the site's calendar

- **GIVEN** the job runs at `2026-09-01T02:00:00Z`, which is `2026-08-31` in
  `America/Toronto`
- **WHEN** the job resolves the current period
- **THEN** `period_start` is `2026-08-01`, not `2026-09-01`

#### Scenario: Concurrent runs cannot create a duplicate

- **WHEN** two runs of the job attempt to insert the same `(site_id, template_id, period_start)`
  concurrently
- **THEN** exactly one row exists afterwards
- **AND** neither run fails with an unhandled error

#### Scenario: The opened inspection is bound to the latest published version

- **GIVEN** a template whose highest published version is `3`
- **WHEN** the job opens the current period for a rule on that template
- **THEN** the created row's `template_version_id` is version `3`

#### Scenario: A cancelled inspection lets the period be scheduled again

- **GIVEN** a scheduled inspection for the current period that has been cancelled
- **WHEN** a new inspection is scheduled for the same site, template and period
- **THEN** the insert succeeds and both rows are present, one cancelled and one open

#### Scenario: The job sees every site without a session

- **WHEN** the period opening job runs
- **THEN** it operates under an explicitly declared site scope covering every active site
- **AND** it does not run under any user session

### Requirement: The scheduling surface projects every period a site owes for a calendar year

The system SHALL present the scheduled inspections of a site as an annual schedule for a chosen
year. The schedule SHALL offer a matrix organized by requirement and calendar month and an
operational list ordered by period start and requirement name. Both presentations SHALL contain
the same entries and SHALL preserve one entry per schedule rule per owed period.

An entry whose period has been opened SHALL carry the scheduled inspection itself, including its
status, `inspector_id` and inspector name. An entry whose period has not been opened SHALL still be
present and SHALL be identified as not opened rather than omitted. A month in which a rule does
not begin a period SHALL remain visually distinct from a period that is owed but not opened.

The reader SHALL be able to move to another calendar year in both directions, without limit on
how far ahead. On a small viewport the operational list SHALL be the initial presentation so that
the schedule remains operable without requiring a twelve-column viewport.

A period a rule does not owe, either because its month does not match `frequency_months` and
`anchor_month` or because it falls outside the window bounded by `created_at` and `deactivated_at`,
SHALL NOT be projected as a missing period.

A scheduled inspection whose `period_start` falls outside every rule's owing window SHALL still be
shown in the year it belongs to. The projection adds periods that are owed; it never hides a
period that exists.

#### Scenario: A year with one monthly rule shows twelve entries

- **GIVEN** a site with one active monthly schedule rule created in `2025`
- **AND** scheduled inspections opened for `2026-01-01` through `2026-08-01`
- **WHEN** the coordinator views the year `2026`
- **THEN** twelve entries are shown for that rule, one per month
- **AND** the entries for January through August carry their scheduled inspection
- **AND** the entries for September through December are identified as not opened

#### Scenario: A quarterly rule distinguishes not due from not opened

- **GIVEN** an active rule with `frequency_months` `3` and `anchor_month` `1`
- **WHEN** the coordinator views the year `2026` in the matrix
- **THEN** January, April, July and October contain period entries
- **AND** the other month positions do not read as not opened

#### Scenario: Matrix and list present the same schedule

- **GIVEN** a year containing opened, unopened, missed and cancelled periods
- **WHEN** the reader switches between the matrix and operational list
- **THEN** both presentations contain the same projected periods and statuses

#### Scenario: A future year is entirely unopened

- **GIVEN** a site with one monthly schedule rule
- **WHEN** the coordinator moves to a future year with no scheduled inspections
- **THEN** twelve entries are shown, every one of them identified as not opened

#### Scenario: A period before the rule existed is not projected

- **GIVEN** a monthly schedule rule whose `created_at` is in `2026-03`
- **WHEN** the coordinator views the year `2026`
- **THEN** entries for January and February are not shown for that rule
- **AND** the entry for March is shown

#### Scenario: A period after the rule was deactivated is not projected

- **GIVEN** a monthly schedule rule whose `deactivated_at` is in `2026-09`
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

### Requirement: The annual schedule exposes year-scoped operational summaries and filters

The system SHALL summarize only the projected periods of the selected site and year. It SHALL
identify the total periods due and the subsets that are completed, missed, unassigned and not
opened. A cancelled period SHALL remain part of the annual schedule but SHALL NOT be classified as
completed, missed, unassigned or not opened.

The reader SHALL be able to filter the schedule by requirement and operational state. Selecting an
actionable summary SHALL apply its corresponding filter. Any notice that counts unassigned periods
SHALL use the same selected year and SHALL lead to entries present in the current schedule.

#### Scenario: A cancelled period is not reported as assigned work

- **GIVEN** a cancelled scheduled inspection whose `inspector_id` is null
- **WHEN** the annual summaries are calculated
- **THEN** the period remains included in the total due count
- **AND** it is excluded from completed, missed, unassigned and not-opened counts

#### Scenario: The unassigned notice follows the selected year

- **GIVEN** one unassigned scheduled inspection in `2026` and another in `2027`
- **WHEN** the coordinator views `2026`
- **THEN** the unassigned notice reports one period
- **AND** activating the notice reveals the `2026` entry in the current schedule

#### Scenario: A summary filters the visible schedule

- **GIVEN** the selected year contains completed and unassigned periods
- **WHEN** the coordinator activates the unassigned summary
- **THEN** only unassigned periods remain in the visible schedule
- **AND** the coordinator can clear the filter to restore all projected periods

### Requirement: Schedule requirements are configured as one focused operation

The system SHALL let an `hs_coordinator` create an inspection requirement by selecting a published
`template_id`, `frequency_months`, an applicable `anchor_month` and an optional
`default_inspector_id` before confirmation. Before creation, the surface SHALL describe the annual
cadence produced by the selected frequency and anchor and SHALL state that `frequency_months` and
`anchor_month` cannot be changed later.

The surface SHALL present one current requirement per template. It SHALL let the coordinator change
`default_inspector_id`, deactivate an active requirement after confirming the consequence for future
periods, and reactivate a deactivated requirement. Accounts without scheduling administration
permission SHALL see the requirements without any of those controls.

#### Scenario: A requirement is created with a default inspector

- **GIVEN** a published template with no active rule for the selected site
- **WHEN** the coordinator creates a quarterly requirement with `anchor_month` `2` and an eligible
  `default_inspector_id`
- **THEN** the create request carries the selected `template_id`, `frequency_months`,
  `anchor_month` and `default_inspector_id`
- **AND** the new requirement describes periods beginning in February, May, August and November

#### Scenario: A monthly requirement does not request a meaningless anchor

- **WHEN** the coordinator selects `frequency_months` `1`
- **THEN** the requirement form does not ask the coordinator to choose an `anchor_month`
- **AND** the cadence preview states that one period begins every month

#### Scenario: Deactivation explains what remains unchanged

- **GIVEN** an active schedule requirement
- **WHEN** the coordinator chooses to deactivate it
- **THEN** the confirmation states that no future period will be opened from the requirement
- **AND** the confirmation states that periods already opened remain unchanged

#### Scenario: A reader cannot administer requirements

- **WHEN** an account whose role is `jhsc_member` views the scheduling surface
- **THEN** the current requirements and their default inspectors are readable
- **AND** no control to create, update, deactivate or reactivate a requirement is offered

### Requirement: Period operations are exposed on demand from an annual entry

The system SHALL let a reader select an owed-period entry to inspect its period label, template,
status and inspector without placing a form in every annual entry. For an `hs_coordinator`, the
focused period view SHALL expose the operations valid for that entry: opening an unopened period,
confirming an inspector assignment, cancelling an eligible scheduled inspection with a reason, or
scheduling a cancelled period again. Other roles SHALL receive the same readable detail without
administrative controls.

Opening a period SHALL identify the currently published `template_version` that the operation will
freeze. Changing an inspector selection SHALL NOT send an assignment until the coordinator
explicitly confirms it. A failed assignment SHALL retain the persisted inspector and display the
server's reason.

#### Scenario: Selecting an unopened entry offers one opening operation

- **GIVEN** an owed period with no scheduled inspection
- **WHEN** the coordinator selects its annual entry
- **THEN** the focused view offers an optional `inspector_id` and one action to open the period
- **AND** it identifies the published `template_version` that will be frozen

#### Scenario: Selecting an inspector does not immediately assign it

- **GIVEN** an opened period and two eligible inspectors
- **WHEN** the coordinator selects a different `inspector_id` without confirming
- **THEN** no assignment request is sent
- **AND** a separate confirmation action remains available

#### Scenario: A cancelled period offers scheduling again

- **GIVEN** a cancelled scheduled inspection with a `cancellation_reason`
- **WHEN** the coordinator selects its annual entry
- **THEN** the focused view shows the cancellation reason
- **AND** it offers scheduling the period again rather than clearing the cancellation

### Requirement: Supporting-data failures are not presented as empty scheduling choices

The system SHALL distinguish a failure to load published templates or eligible inspector candidates
from a successful response containing no choices. An operation that depends on failed supporting data
SHALL remain unavailable and SHALL present a connection or server error where the coordinator
attempted the operation.

#### Scenario: Inspector candidates fail to load

- **GIVEN** an opened period that can be assigned
- **WHEN** loading eligible inspector candidates fails
- **THEN** the focused period view reports that candidates could not be loaded
- **AND** it does not present the failure as if the site had no eligible inspectors
- **AND** assignment confirmation is unavailable

#### Scenario: Published templates fail to load

- **WHEN** loading published templates for requirement creation fails
- **THEN** the requirement form reports that templates could not be loaded
- **AND** requirement creation is unavailable

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

### Requirement: Only the HS coordinator schedules, reassigns and cancels

The system SHALL restrict creating and deactivating schedule rules, scheduling an inspection
outside the automatic calendar, reassigning `inspector_id` and cancelling a scheduled inspection to
accounts whose role is `hs_coordinator`. `inspector_id` SHALL reference an account that sits on the
JHSC — one whose role is `jhsc_member`, or one whose role is `hs_coordinator` and whose
`jhsc_seat_granted_at` is non-null — and whose active site scope includes the inspection's
`site_id`. Every one of these operations SHALL be recorded in the audit log with the acting
account.

An `hs_coordinator` who holds no JHSC seat SHALL be refused as `inspector_id`, and the refusal
SHALL say that the account holds no seat rather than name the role, because the role is not what is
missing.

Withdrawing an account's JHSC seat SHALL NOT change the `inspector_id` of any scheduled inspection
already assigned to it, and SHALL NOT remove those inspections from what that account still owes:
the seat governs what is offered and what is accepted from that moment on, not what was already
decided.

#### Scenario: A JHSC member cannot reassign an inspection

- **WHEN** an account whose role is `jhsc_member` requests a change of `inspector_id` on a
  scheduled inspection
- **THEN** the request is rejected as forbidden
- **AND** `inspector_id` is unchanged

#### Scenario: A supervisor cannot create a schedule rule

- **WHEN** an account whose role is `supervisor` requests the creation of a schedule rule
- **THEN** the request is rejected as forbidden

#### Scenario: An inspector without scope for the site is rejected

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `jhsc_member` but
  whose active site scope does not include the inspection's `site_id`
- **THEN** the request is rejected and names the site the account lacks

#### Scenario: An account that is not a JHSC member is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `management`
- **THEN** the request is rejected and names the role

#### Scenario: A coordinator who holds a seat can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` an `hs_coordinator` account whose
  `jhsc_seat_granted_at` is non-null and whose active site scope includes the inspection's
  `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A coordinator who holds no seat is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an `hs_coordinator` account whose
  `jhsc_seat_granted_at` is null
- **THEN** the request is rejected and says the account holds no JHSC seat

#### Scenario: Leaving the committee does not reassign what was already assigned

- **GIVEN** a scheduled inspection assigned to an `hs_coordinator` account that holds a seat
- **WHEN** that account's seat is withdrawn
- **THEN** the inspection's `inspector_id` is unchanged
- **AND** the inspection is still among what that account still owes

#### Scenario: A reassignment is audited

- **WHEN** the coordinator changes `inspector_id` on a scheduled inspection
- **THEN** an audit log entry is written for the inspection's `site_id` naming the acting account,
  the previous `inspector_id` and the new one

### Requirement: The accounts eligible to be assigned an inspection at a site can be listed

The system SHALL expose, for a site, the accounts eligible to be named as `inspector_id` of a
scheduled inspection at that site: accounts that are not deactivated, that sit on the JHSC — role
`jhsc_member`, or role `hs_coordinator` with a non-null `jhsc_seat_granted_at` — and whose
`user_site_scope` for that `site_id` has not been revoked.

The system SHALL determine that list with **the same predicate** it uses to validate an
assignment, so that every account the list offers is an account a reassignment accepts, and an
account a reassignment refuses as `inspector_invalid` never appears in the list.

The listing SHALL be restricted to accounts whose role is `hs_coordinator`, because it is the only
read that projects the account table and it exists solely to feed an operation that is already
the coordinator's alone. A request for a site outside the session's site scope SHALL be refused
and SHALL return no entry, and the endpoint SHALL apply that check itself, because `app_user` and
`user_site_scope` carry no site isolation policy to apply it for them.

Each entry SHALL carry the account's `id` — the value that travels as `inspector_id`, never the
`person.id` — together with `employee_number`, `first_name` and `last_name`. Those three SHALL be
nullable: eligibility is defined over `user_site_scope` while the name lives in `person`, which is
site-isolated and whose `site_id` is a separate mutable column, so an eligible account whose person
row is outside the reader's scope SHALL still be listed, without its name, rather than dropped.

#### Scenario: Every account offered is an account an assignment accepts

- **GIVEN** a site with a mix of accounts of several roles and scopes
- **WHEN** the eligible accounts for that site are listed
- **AND** each one is then assigned to a scheduled inspection of that site
- **THEN** every assignment is accepted

#### Scenario: An account refused as inspector is never offered

- **GIVEN** an account whose role is `management`, and one whose role is `jhsc_member` but whose
  scope for the site has been revoked, and one that has been deactivated, and an `hs_coordinator`
  account that holds no JHSC seat
- **WHEN** the eligible accounts for that site are listed
- **THEN** none of the four appears
- **AND** assigning any of them is refused with the code `inspector_invalid`

#### Scenario: A coordinator with a seat is offered

- **GIVEN** an `hs_coordinator` account with active scope for the site and a non-null
  `jhsc_seat_granted_at`
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears
- **AND** it stops appearing once its seat is withdrawn

#### Scenario: An eligible account whose person row is out of scope is still offered

- **GIVEN** an account whose role is `jhsc_member` with active scope for St. Thomas, whose `person`
  row belongs to Glencoe
- **WHEN** a coordinator whose scope covers only St. Thomas lists the eligible accounts
- **THEN** the account is listed with a null `first_name` and a null `last_name`
- **AND** assigning it to a St. Thomas inspection is accepted

#### Scenario: A JHSC member cannot list the eligible accounts

- **WHEN** an account whose role is `jhsc_member` requests the eligible accounts of its own site
- **THEN** the request is rejected as forbidden

#### Scenario: A site outside the session scope returns nothing

- **WHEN** a coordinator whose scope covers only Glencoe requests the eligible accounts of
  St. Thomas
- **THEN** the request is refused
- **AND** no entry is returned

### Requirement: A scheduled inspection with no inspector is listed and identified as such

The system SHALL return `inspector_id` as null, rather than omitting the entry, for a scheduled
inspection that has not been assigned. A period opened from a schedule rule whose
`default_inspector_id` is null SHALL be reachable by the coordinator from the moment it is created.

This is required because such an inspection is absent from every pending list — those are filtered
by `inspector_id` — and would otherwise exist as an obligation that no screen names.

#### Scenario: An unassigned inspection is listed with a null inspector

- **GIVEN** a schedule rule whose `default_inspector_id` is null
- **WHEN** the period opening job opens its period and the scheduled inspections are listed
- **THEN** the created inspection is listed with a null `inspector_id`

#### Scenario: The unassigned inspection is in nobody's pending list

- **GIVEN** a scheduled inspection whose `inspector_id` is null
- **WHEN** every account of its site reads its pending inspections
- **THEN** the inspection appears in none of them
- **AND** it is still listed among the site's scheduled inspections

#### Scenario: Assigning it puts it in the inspector's pending list

- **GIVEN** a scheduled inspection whose `inspector_id` is null
- **WHEN** the coordinator assigns an eligible account to it
- **THEN** that account's pending inspections include it

### Requirement: The scheduling surface names people, not identifiers

The system SHALL accompany `inspector_id` and `default_inspector_id` with the name of the account
they refer to, resolved by the system rather than left for the reader to resolve.

The name SHALL survive the assignee ceasing to be eligible: an assignment is a historical fact, and
an account that has been deactivated or has lost its scope for the site SHALL still be named on the
inspection it was assigned to, even though it is no longer offered as a candidate.

The name SHALL be null when the account has no `person` row the reader may see, and a null name
SHALL NOT remove the entry.

#### Scenario: A listed assignment carries the assignee's name

- **GIVEN** a scheduled inspection assigned to an account whose person is named Dana Okafor
- **WHEN** the scheduled inspections are listed
- **THEN** the entry carries both the `inspector_id` and the name Dana Okafor

#### Scenario: A deactivated assignee is still named

- **GIVEN** a scheduled inspection assigned to an account that is then deactivated
- **WHEN** the scheduled inspections are listed
- **THEN** the entry still carries the assignee's name
- **AND** that account is not among the eligible accounts for the site

#### Scenario: A rule names its default inspector

- **GIVEN** a schedule rule whose `default_inspector_id` is set
- **WHEN** the schedule rules are listed
- **THEN** the entry carries the default inspector's name alongside the identifier

### Requirement: Cancelling requires a reason and never removes the row

The system SHALL cancel a scheduled inspection by setting `cancelled_at` and `cancellation_reason`
together. Neither SHALL be set without the other, and neither SHALL be cleared once set: an
inspection is not un-cancelled, it is scheduled again. A cancelled inspection SHALL disappear from
pending lists while remaining readable as a record of the period.

#### Scenario: Cancelling without a reason is rejected

- **WHEN** `cancelled_at` is set on a row while `cancellation_reason` stays null
- **THEN** the statement fails with a check violation naming both columns

#### Scenario: A cancellation cannot be undone

- **WHEN** any role attempts to set `cancelled_at` back to null on a cancelled row
- **THEN** the statement fails with the guard trigger's dedicated SQLSTATE

#### Scenario: A cancelled inspection leaves the pending list

- **GIVEN** a scheduled inspection assigned to an inspector and then cancelled
- **WHEN** that inspector reads their pending inspections
- **THEN** the cancelled inspection is not listed

### Requirement: Every inspector can list what they still owe

The system SHALL expose, for the requesting account, the scheduled inspections that are assigned to
it and not cancelled, ordered by `period_end` ascending so that the most overdue appears first.
Each entry SHALL carry the site, the period, the template name and the `template_version_id` the
inspection is bound to, and SHALL indicate whether `period_end` is already past. The list SHALL be
restricted to sites in the requesting account's active site scope by the site isolation policy, not
by a filter in the endpoint.

#### Scenario: The list contains only the requester's own inspections

- **GIVEN** two open inspections in the same site, one assigned to inspector A and one to
  inspector B
- **WHEN** inspector A reads their pending inspections
- **THEN** only the inspection assigned to A is listed

#### Scenario: Overdue periods sort first and are flagged

- **GIVEN** an inspection for the previous period and one for the current period, both assigned to
  the same inspector
- **WHEN** that inspector reads their pending inspections
- **THEN** the previous period's inspection is listed first and is flagged as overdue
- **AND** the current period's inspection is not flagged as overdue

#### Scenario: A session with no site scope sees nothing

- **WHEN** the pending list is read in a transaction that declares no site scope
- **THEN** no rows are returned

### Requirement: The coordinator is notified once per site for each opening run

The system SHALL notify every active coordinator with scope on a site when that run opened at least
one inspection there, deduplicated by site and by the month the run resolved. The notification
payload SHALL carry the period start, end and length of each opened inspection individually,
because rules of different frequencies opened by the same run cover different periods.

The notification SHALL be delivered in the application; the system SHALL NOT depend on outbound
email. At most one such notification SHALL exist per recipient, site and period, enforced by the
database, so that a repeated job run does not produce a second one. A recipient SHALL be able to
mark a notification as read, and `read_at` SHALL be the only value a notification ever changes.

`inspection_period_opened` SHALL be one of several notification kinds, and the shape of
`notification.payload` SHALL be determined by `kind`: a reader SHALL NOT assume that every
notification carries the period payload. A reader that does not recognise a `kind` SHALL fail
loudly rather than render an unknown payload, because the set of kinds is closed and adding one is
a change that has to state how it is shown.

#### Scenario: Opening a period notifies the coordinator

- **GIVEN** an active `hs_coordinator` account whose site scope includes St. Thomas
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** a `notification` row exists for that account with `kind` `inspection_period_opened`
- **AND** its payload names the period and the inspections opened

#### Scenario: One notification lists inspections of different lengths

- **GIVEN** a monthly rule and a quarterly rule that both open in the same run
- **WHEN** the job runs
- **THEN** the coordinator receives one notification
- **AND** its payload lists both inspections, each with its own `period_start`, `period_end` and
  `period_months`

#### Scenario: A repeated run does not notify twice

- **WHEN** the opening job runs a second time in the same period
- **THEN** the coordinator still has exactly one `inspection_period_opened` notification for that
  site and period

#### Scenario: A job run that opens nothing notifies nobody

- **GIVEN** every rule of a site already has its inspection for the current period
- **WHEN** the opening job runs
- **THEN** no notification is created for that site

#### Scenario: A notification body cannot be rewritten

- **WHEN** any role attempts to update a notification's `payload`, `kind`, `user_id` or `site_id`
- **THEN** the statement fails
- **AND** setting `read_at` on the same row succeeds

#### Scenario: A coordinator outside the site scope is not notified

- **GIVEN** an active `hs_coordinator` account whose site scope covers only Glencoe
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** no notification for St. Thomas is created for that account

#### Scenario: The inbox carries notifications of several kinds together

- **GIVEN** a coordinator with one `inspection_period_opened` notification and one
  `corrective_action_overdue_supervisor` notification
- **WHEN** the inbox is read
- **THEN** both are returned
- **AND** each carries the payload of its own `kind`

#### Scenario: An unknown kind is not silently rendered

- **WHEN** a notification whose `kind` is outside the closed list is read
- **THEN** the read fails rather than returning a notification with an unrecognised payload

### Requirement: A scheduled inspection serves the field package it needs to be worked offline

The system SHALL make everything a scheduled inspection needs available to the device that
will carry it, as three separate reads keyed by the inspection: its frozen template version
document, the location catalog of its site, and the active roster subset of its site.

The three SHALL be separate reads and SHALL NOT be combined into a single response, so that
a device that obtains some but not all of them can name exactly which part is missing.

Each read SHALL be resolvable while the requester still has a connection, and SHALL carry
no dependency on any earlier read.

#### Scenario: The three reads together are everything the device needs

- **GIVEN** a scheduled inspection assigned within the requester's site scope
- **WHEN** the device reads the inspection's template version, locations and roster
- **THEN** each read returns its part of the field package
- **AND** no further request is required before the inspection can be worked with no network

#### Scenario: One read failing does not prevent the others

- **GIVEN** a scheduled inspection whose roster read fails
- **WHEN** the template version and location reads are performed
- **THEN** both return their content
- **AND** the roster can be read again on its own without repeating the other two

### Requirement: The template version served is the one the inspection is bound to

The system SHALL serve the complete frozen document of the `template_version_id` recorded on
the scheduled inspection, together with that `template_version_id`, its `version` number, the
inspection's `site_id` and the inspection's `inspector_id`.

`inspector_id` SHALL be the account the inspection is assigned to, or `null` when it is
assigned to nobody. It SHALL be served so that a device can tell whose inspection it is
after it loses network, for the same reason `site_id` is served: what the device must know
about the inspection cannot depend on asking again later.

Serving `inspector_id` SHALL NOT narrow what the read returns to whom. A read remains
resolvable by any account whose session scope reaches the inspection, whether or not it is
the assigned one.

The system SHALL NEVER resolve the template version at read time — not as the highest
published version of the template, and not as the most recent one. Publishing a newer
version of a template SHALL NOT change what an already-scheduled inspection serves.

#### Scenario: The frozen document is returned with its identifiers

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** the device reads its template version
- **THEN** the response carries the document of version `2`, its `template_version_id`, the
  number `2`, the inspection's `site_id`, and the inspection's `inspector_id`

#### Scenario: An unassigned inspection serves a null inspector

- **GIVEN** a scheduled inspection whose `inspector_id` is `NULL`
- **WHEN** the device reads its template version
- **THEN** the response carries `inspector_id` as `null`
- **AND** the document, `template_version_id`, `version` and `site_id` are served as usual

#### Scenario: An account that is not the assigned inspector still reads the package

- **GIVEN** a scheduled inspection assigned to inspector A
- **WHEN** an account within the inspection's site scope that is not A reads its template
  version
- **THEN** the read succeeds and carries A as `inspector_id`

#### Scenario: Publishing a newer version does not change what is served

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** version `3` of that template is published and the device reads the inspection's
  template version again
- **THEN** the response still carries version `2`

#### Scenario: The served document is the one the shared engine accepts

- **WHEN** the template version of a scheduled inspection is read
- **THEN** the returned document parses against the shared template document schema
- **AND** the same answers validated against it on the device and on the server reach the
  same verdict

### Requirement: The catalog and roster served belong to the inspection's site and exclude what is deactivated

The system SHALL serve, for a scheduled inspection, only the locations of that inspection's
`site_id` and only the people of that same site.

The system SHALL exclude deactivated locations and deactivated people from both reads: a
deactivated entry still resolves from history but SHALL NOT be offered as a choice on a
walkthrough.

Each location SHALL carry its `id`, `code` and `name`. Each person SHALL carry their `id`,
`employee_number`, `first_name` and `last_name`, and SHALL NOT carry anything else.

#### Scenario: Only the inspection's site is served

- **GIVEN** a requester whose scope covers two sites, and a scheduled inspection at one of
  them
- **WHEN** the device reads the inspection's locations and roster
- **THEN** only entries belonging to the inspection's site are returned
- **AND** no entry from the other site appears, even though the requester may read it

#### Scenario: A deactivated location is not offered

- **GIVEN** a location of the inspection's site that has been deactivated
- **WHEN** the device reads the inspection's locations
- **THEN** that location is not in the response

#### Scenario: A deactivated person is not offered

- **GIVEN** a person of the inspection's site who has been deactivated
- **WHEN** the device reads the inspection's roster
- **THEN** that person is not in the response

#### Scenario: The roster read carries no profile detail

- **WHEN** the device reads the inspection's roster
- **THEN** each entry carries only `id`, `employee_number`, `first_name` and `last_name`

### Requirement: The field package is scoped by the session and refused outside it

The system SHALL determine what a field package read may return from the requester's session
scope, and SHALL NOT accept a site, an actor or a scope from the request.

A read for a scheduled inspection that the requester's scope does not reach SHALL be refused
with the same `inspection_not_found` response the system already gives for an inspection that
does not exist, and SHALL return no part of the package. The two SHALL be indistinguishable,
so that the routes cannot be used to discover what is scheduled at a site the requester
cannot see.

#### Scenario: An inspection outside the requester's scope is refused

- **WHEN** an account reads the field package of a scheduled inspection at a site outside its
  scope
- **THEN** the request is rejected as `inspection_not_found`
- **AND** no document, location or roster entry is returned

#### Scenario: A nonexistent inspection is refused the same way

- **WHEN** an account reads the field package of an inspection identifier that does not exist
- **THEN** the response is the same refusal as for an inspection outside its scope

#### Scenario: A cancelled inspection serves no field package

- **GIVEN** a scheduled inspection that has been cancelled
- **WHEN** the device reads its field package
- **THEN** the request is rejected as `inspection_not_found`
- **AND** no part of the package is returned

### Requirement: A submitted inspection freezes what was inspected, by whom, and against which version

The system SHALL store every accepted submission as one row of `inspection` carrying `site_id`,
`scheduled_inspection_id`, `template_version_id`, `client_submission_id`, `submitted_by`,
`signed_at`, `received_at` and `answer_count`. `signed_at` SHALL be the device clock reported in
the payload and `received_at` SHALL be assigned by the engine. `template_version_id` SHALL equal
the `template_version_id` the scheduled inspection is bound to, and the engine SHALL reject any
row where it does not, so that a submission can never be recorded against a version the inspector
was not given.

#### Scenario: An accepted submission records both clocks

- **WHEN** a submission with `signed_at` `2026-08-03T14:20:00-04:00` is accepted on 2026-08-09
- **THEN** the created `inspection` row reports `signed_at` `2026-08-03T14:20:00-04:00`
- **AND** `received_at` is the server time of the accepting transaction, not the device time

#### Scenario: A submission naming another version of the same template is refused

- **GIVEN** a scheduled inspection bound to version `2` of a template, and version `3` published
- **WHEN** a submission for that scheduled inspection is posted with `template_version_id` of
  version `3`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row exists for that `client_submission_id`

#### Scenario: The engine refuses a mismatched version even outside the endpoint

- **WHEN** a row is inserted directly into `inspection` whose `template_version_id` differs from
  the `template_version_id` of its `scheduled_inspection_id`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE
- **AND** no row is present when read back

### Requirement: A submission is idempotent by client submission id

The system SHALL treat `client_submission_id` as the idempotency key of the whole system.
Re-posting a payload whose `client_submission_id` already exists SHALL return the existing record
with the same HTTP status and the same response shape as the first acceptance, distinguished only
by `created` being `false`, and SHALL NOT create a second `inspection`, write a second set of
answers, or append a second audit entry. Uniqueness SHALL be enforced by a unique index on
`inspection.client_submission_id` rather than by a check performed before the insert, so that two
concurrent posts of the same identifier converge on one row.

#### Scenario: Re-posting the same submission returns the existing record

- **GIVEN** a submission already accepted with `client_submission_id` `C`
- **WHEN** the identical payload is posted again
- **THEN** the response carries the same `id`, `scheduled_inspection_id`, `template_version_id`,
  `submitted_at` and `submitted_by` as the first response
- **AND** `created` is `false`
- **AND** the response status is the one the first acceptance returned, not `409`

#### Scenario: A replay adds no rows and no audit entry

- **GIVEN** a submission already accepted with `client_submission_id` `C` and 40 answers
- **WHEN** the identical payload is posted three more times
- **THEN** exactly one `inspection` row exists with `client_submission_id` `C`
- **AND** exactly 40 rows of `inspection_answer` reference it
- **AND** exactly one `audit_log` entry of type `inspection.submitted` names it

#### Scenario: Two concurrent posts of the same identifier create one record

- **WHEN** two requests carrying the same `client_submission_id` are posted concurrently
- **THEN** both receive a successful response naming the same `inspection.id`
- **AND** exactly one `inspection` row exists for that `client_submission_id`

### Requirement: A scheduled inspection accepts exactly one submission

The system SHALL allow at most one `inspection` per `scheduled_inspection_id`, enforced by a
unique index. A submission carrying a `client_submission_id` that does not exist yet, for a
scheduled inspection that already has one, SHALL be rejected with the code `already_submitted`
rather than accepted as a second record: one owner, one device, one signer. Correcting an accepted
inspection SHALL NOT be done by submitting again.

#### Scenario: A second submission from a different draft is refused

- **GIVEN** a scheduled inspection with an accepted submission for `client_submission_id` `C1`
- **WHEN** a submission for the same `scheduled_inspection_id` is posted with
  `client_submission_id` `C2`
- **THEN** the request is rejected with the code `already_submitted`
- **AND** exactly one `inspection` row exists for that `scheduled_inspection_id`
- **AND** the row is the one created for `C1`

#### Scenario: A cancelled scheduled inspection accepts nothing

- **GIVEN** a scheduled inspection whose `cancelled_at` is set
- **WHEN** a submission for it is posted
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** the message states that the inspection was cancelled

### Requirement: Answers are validated against the frozen template version and a rejection leaves nothing behind

The system SHALL validate the submitted answers against the document of the
`template_version` the scheduled inspection is bound to, using the same shared form engine the
device used, and SHALL reject a submission that produces any violation with the code
`validation_failed` and the full list of violations, each naming its `item_key` and its violation
code. A rejected submission SHALL leave no `inspection` row, no `inspection_answer` row and no
audit entry: the whole ingestion is one transaction that either commits entirely or not at all.

#### Scenario: A missing required answer rejects the whole submission

- **GIVEN** a template version with a required item `dock.guards` and 39 other answered items
- **WHEN** a submission omits `dock.guards`
- **THEN** the response carries the code `validation_failed` and a violation with `item_key`
  `dock.guards` and code `required_missing`
- **AND** no `inspection` row exists for that `client_submission_id`
- **AND** no `inspection_answer` row was written for any of the 39 valid answers

#### Scenario: All violations are reported at once

- **WHEN** a submission has three items with answers of the wrong shape and one required item
  missing
- **THEN** the response lists four violations, not one

#### Scenario: An answer for an item the document does not contain is refused

- **WHEN** a submission carries an answer whose `item_key` is not an item of the bound
  `template_version`
- **THEN** the response carries the code `validation_failed` with a violation of code
  `unknown_item` for that `item_key`

#### Scenario: An answer for an item its own answers hide is refused

- **GIVEN** a template version where `spill.cleanup` is visible only when `spill.present` is `yes`
- **WHEN** a submission answers `spill.present` with `no` and also carries an answer for
  `spill.cleanup`
- **THEN** the response carries a violation of code `answer_for_hidden_item` for `spill.cleanup`

### Requirement: Answers are stored as rows keyed by the stable item key

The system SHALL store one row of `inspection_answer` per answered item, with `inspection_id`,
`site_id`, `template_version_item_id`, `item_key` and `value`. It SHALL NOT store the answer set
as a single document column. `template_version_item_id` SHALL record which published row was
answered — the legal fidelity of §4 — and `item_key` SHALL record the stable concept the
recurrence report groups by. The engine SHALL guarantee that `item_key` is the key of the
referenced `template_version_item` and that the item belongs to the inspection's
`template_version_id`. `item_key` SHALL be indexed so that grouping every answer of a site by
concept does not require reading the answers of every inspection.

#### Scenario: One row per answered item

- **WHEN** a submission with 40 answers is accepted
- **THEN** 40 rows of `inspection_answer` reference the created `inspection`
- **AND** each row carries the `item_key` of the item it answers and the
  `template_version_item_id` of that item within the bound version

#### Scenario: The same item answered in two versions groups under one key

- **GIVEN** two accepted inspections of the same site, one against version `2` and one against
  version `3` of a template, both answering the item whose `item_key` is `dock.guards`
- **WHEN** the answers of that site are grouped by `item_key`
- **THEN** both rows fall in the same group
- **AND** their `template_version_item_id` values differ

#### Scenario: An answer cannot name an item of another version

- **WHEN** a row is inserted into `inspection_answer` whose `template_version_item_id` belongs to
  a `template_version` other than the one of its `inspection`
- **THEN** the insert fails with the guard trigger's dedicated SQLSTATE

#### Scenario: An answer cannot claim an item key that is not the referenced item's

- **WHEN** a row is inserted into `inspection_answer` whose `item_key` is not the `item_key` of
  its `template_version_item_id`
- **THEN** the insert fails with a foreign key violation on the
  `(template_version_item_id, item_key)` pair

#### Scenario: The same item cannot be answered twice in one inspection

- **WHEN** a second `inspection_answer` row is inserted with an `item_key` already present for
  that `inspection_id`
- **THEN** the insert fails with a unique violation

### Requirement: A submission carries object keys, never bytes, and only its own

The system SHALL accept photo and signature answers as object keys of files already uploaded
before the submission, merge the keys reported in `photos` into the answer set under their
`item_key` before validating, and reject any submission whose payload references an object key
outside the prefix derived from its own `site_id` and `scheduled_inspection_id`. The
`photo_object_keys` of the `findings` block SHALL be held to the same prefix rule, and SHALL NOT
be merged into the answer set: they are the photos of the finding, not the answer to a photo item,
and merging them would collide with the answer of the very item they belong to.

#### Scenario: Uploaded photo keys satisfy a photo item

- **GIVEN** a template version with a photo item `dock.guards.photo` requiring at least one photo
- **WHEN** a submission carries no answer for `dock.guards.photo` but reports one object key for
  it under `photos`
- **THEN** the submission is accepted
- **AND** the stored `inspection_answer` for `dock.guards.photo` carries that object key

#### Scenario: A key belonging to another inspection is refused

- **WHEN** a submission references an object key whose prefix names another
  `scheduled_inspection_id`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` row is created

#### Scenario: A finding photo of another inspection is refused

- **WHEN** a `findings` entry reports a `photo_object_keys` value outside the prefix of its own
  `site_id` and `scheduled_inspection_id`
- **THEN** the request is rejected with the code `invalid_submission`
- **AND** no `inspection` and no `finding` row is created

#### Scenario: A finding photo does not become the answer to its item

- **GIVEN** a `yes_no` item `dock.guards` answered `false` with two finding photos
- **WHEN** the submission is accepted
- **THEN** the `inspection_answer` for `dock.guards` holds the boolean `false`
- **AND** the two object keys are held by `finding_photo` rows of its finding

#### Scenario: A payload carrying image bytes is refused

- **WHEN** a submission carries a base64 blob in place of an object key for a photo item
- **THEN** the request is rejected before any row is written

### Requirement: Only the assigned inspector submits, and only within their site scope

The system SHALL accept a submission only from the account named as `inspector_id` of the
scheduled inspection, and SHALL record that account as `submitted_by`. A submission for a
scheduled inspection outside the session's site scope SHALL be answered exactly as one for a
scheduled inspection that does not exist, so that the endpoint cannot be used to learn what the
other site is inspecting.

#### Scenario: An account that is not the assigned inspector is refused

- **GIVEN** a scheduled inspection assigned to inspector A
- **WHEN** inspector B of the same site posts a submission for it
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `inspection` row is created

#### Scenario: A scheduled inspection with no inspector accepts nothing

- **GIVEN** a scheduled inspection whose `inspector_id` is `NULL`
- **WHEN** any account posts a submission for it
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Another site's inspection is indistinguishable from a missing one

- **GIVEN** a scheduled inspection of Glencoe
- **WHEN** an inspector whose scope is only St. Thomas posts a submission for it
- **THEN** the response carries the code `inspection_not_found`
- **AND** the response body reveals nothing about the site, period or template of that inspection

#### Scenario: The submitter is taken from the session, not from the payload

- **WHEN** a submission is accepted
- **THEN** `inspection.submitted_by` is the account of the authenticated session
- **AND** no field of the request payload can set it

### Requirement: A submission carries the finding details of every negative answer

The system SHALL accept, alongside `answers` and `photos`, a `findings` block of the submission
payload keyed by `item_key`, each entry carrying `description`, `location_id` and
`photo_object_keys`. The system SHALL reject with `validation_failed` a submission whose set of
`findings` keys is not exactly the set of its negative answers: a negative answer with no entry
SHALL produce a violation of code `finding_missing` for its `item_key`, and an entry for an answer
that is not negative SHALL produce a violation of code `unexpected_finding`. These violations
SHALL be reported together with every other violation of the submission, in one response, and
SHALL leave no `inspection`, `inspection_answer`, `finding` row or audit entry behind.

#### Scenario: A negative answer with no finding details is refused

- **GIVEN** a submission whose answer for `dock.guards` is `false`
- **WHEN** it carries no `findings` entry for `dock.guards`
- **THEN** the response carries the code `validation_failed` and a violation with `item_key`
  `dock.guards` and code `finding_missing`
- **AND** no `inspection` row exists for that `client_submission_id`

#### Scenario: Finding details for a compliant answer are refused

- **WHEN** a submission carries a `findings` entry for an item answered `true`
- **THEN** the response carries a violation of code `unexpected_finding` for that `item_key`

#### Scenario: Finding details for an item that is not in the document are refused

- **WHEN** a submission carries a `findings` entry whose `item_key` is not an item of the bound
  `template_version`
- **THEN** the response carries a violation of code `unknown_item` for that `item_key`

#### Scenario: Missing details are reported with every other violation

- **GIVEN** a submission with two negative answers lacking their details and one required item
  missing
- **WHEN** it is posted
- **THEN** the response lists three violations, not one

#### Scenario: A complete submission is accepted and its findings are written

- **WHEN** a submission carries a `findings` entry for each of its 3 negative answers, each with
  a description, a `location_id` of the inspection's site and at least one object key
- **THEN** the submission is accepted
- **AND** 3 `finding` rows reference the created `inspection`

### Requirement: Findings are derived inside the ingestion transaction

The system SHALL derive the findings of a submission in the same transaction that inserts the
`inspection` and the `inspection_answer` rows, before it commits, and SHALL NOT defer the
derivation to a background job, a queue or an event handler. A failure at any point of the
ingestion SHALL leave neither an inspection without its findings nor findings without their
inspection.

#### Scenario: An inspection and its findings commit together

- **WHEN** a submission with negative answers is accepted
- **THEN** the `inspection`, its `inspection_answer` rows and its `finding` rows are all visible
  as of the same transaction
- **AND** no queued job is required for the findings to exist

#### Scenario: A failure while writing findings loses the whole submission

- **GIVEN** a submission whose second finding violates a database constraint
- **WHEN** it is posted
- **THEN** no `inspection` row is created
- **AND** the device can retry with the same `client_submission_id`

#### Scenario: An inspection is never left without the findings its answers imply

- **WHEN** the accepted inspections of a site are compared with their negative answers
- **THEN** every negative answer of every accepted inspection has exactly one finding

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
- **WHEN** the period's status is read
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

### Requirement: A listed scheduled inspection carries when it was completed

The system SHALL accompany every listed scheduled inspection with `inspection_id` and
`completed_at`, both null while no submission exists for that period and both populated once
one does.

`completed_at` SHALL be the submission's `signed_at` — the moment the inspector signed the
walk — and SHALL NOT be the moment the server received it. The two differ by however long the
device stayed offline, and the month a record belongs to is what identifies the obligation to
a regulator: an inspection walked and signed on the last day of a month SHALL be dated in that
month even when it is transmitted in the next one.

This is required because a reader can already tell **that** a period was completed, from the
derived status, but cannot date the record without it, and a list of completed inspections
that cannot say when each was closed is not evidence of anything.

#### Scenario: A completed period carries its signing date

- **GIVEN** a scheduled inspection for `2027-07-01` whose submission was signed on
  `2027-07-29` and received on `2027-08-02`
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `status` is `completed`
- **AND** its `completed_at` is `2027-07-29`
- **AND** its `inspection_id` is the id of that submission

#### Scenario: A period with no submission carries neither

- **GIVEN** a scheduled inspection for `2027-09-01` with no submission
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `completed_at` is null
- **AND** its `inspection_id` is null

#### Scenario: A cancelled period is not dated

- **GIVEN** a scheduled inspection that was cancelled before any submission
- **WHEN** the scheduled inspections are listed
- **THEN** the entry's `status` is `cancelled`
- **AND** its `completed_at` is null

### Requirement: The inspector's home names the assignment that comes next

The system SHALL present, on the screen an inspector opens the application to, the earliest
assignment that is neither overdue nor the month in progress, identified by its month, its
site, the inspector it is assigned to, and when it becomes available to start.

When no such assignment exists the system SHALL present nothing in its place rather than an
empty frame: most months only the period in progress is open, because periods are opened one
at a time, and a permanently empty card would read as something failing to load.

The screen SHALL NOT present a calendar of the remaining months of the year. The assignment
that matters now is presented on its own, and the months behind it are reached as each is
resolved.

#### Scenario: A month scheduled ahead is named before it opens

- **GIVEN** an inspector whose current month is assigned
- **AND** a further assignment for the following month at the same site
- **WHEN** the inspector opens the home screen
- **THEN** the next assignment is presented with that month, that site, the inspector's own
  name, and the day it opens

#### Scenario: Nothing is scheduled beyond the current month

- **GIVEN** an inspector with an assignment for the month in progress and no later one
- **WHEN** the inspector opens the home screen
- **THEN** no next assignment is presented

#### Scenario: An overdue month is not offered as what comes next

- **GIVEN** an inspector with an overdue assignment and one scheduled for a later month
- **WHEN** the inspector opens the home screen
- **THEN** the overdue assignment is the one presented as the current obligation
- **AND** the later month is the one presented as what comes next

### Requirement: An inspector can read back what they have completed

The system SHALL present to an inspector the scheduled inspections assigned to that account
whose period was completed, each identified by its month, its site and the date it was
completed, ordered most recent first.

The home screen SHALL present the most recent of these and a way to reach the whole list; a
separate screen SHALL present all of them.

This list SHALL be derived from the same definition of completion the scheduled inspections
listing already applies, so that a period cannot appear as completed on one screen and not on
the other.

#### Scenario: Completed months are listed newest first

- **GIVEN** an inspector who completed the inspections for `2027-05`, `2027-06` and `2027-07`
- **WHEN** the inspector views their completed inspections
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Another inspector's completed months are not listed

- **GIVEN** a site where two inspectors each completed inspections
- **WHEN** one of them views their completed inspections
- **THEN** only the inspections assigned to that account are listed

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views their completed inspections
- **THEN** that month is not listed

### Requirement: A submitted inspection can be read back against the version it was written under

The system SHALL return, for a scheduled inspection that has been submitted, the record of
that submission: the template document the inspection was answered against, the answer
recorded for each `item_key`, `submitted_by`, `signed_at`, `received_at` and `answer_count`.

The document returned SHALL be the one identified by the inspection's own
`template_version_id`, never the currently published version of its template. A later
publication SHALL NOT change how an older submission reads: the questions, their order and
their wording are the ones the inspector actually answered.

An answer SHALL be returned under the same `item_key` it was submitted with, so that a
reader can pair every answer with its question without interpreting the value.

An item of the frozen document that has no answer SHALL be identifiable as unanswered
rather than reported as an empty answer. A question hidden by a condition at capture time
has no answer, and reporting it as blank would assert that the inspector left it out.

#### Scenario: The submission is returned with its answers

- **GIVEN** a scheduled inspection submitted with answers for `housekeeping.floors_clear`
  and `housekeeping.aisles_marked`
- **WHEN** the submitted inspection is read
- **THEN** the response carries the answer recorded for each of those two `item_key` values
- **AND** it carries `submitted_by`, `signed_at`, `received_at` and `answer_count`

#### Scenario: A later publication does not change an older submission

- **GIVEN** an inspection submitted against `template_version_id` of version 2
- **AND** version 5 of the same template published afterwards
- **WHEN** the submitted inspection is read
- **THEN** the document returned is the one of version 2
- **AND** the questions of version 5 that did not exist in version 2 are absent

#### Scenario: An item that was never answered is distinguishable from a blank one

- **GIVEN** an inspection whose document contains an item hidden by a condition, never
  answered
- **WHEN** the submitted inspection is read
- **THEN** that item is identifiable as having no answer
- **AND** it is not reported as an answer with an empty value

### Requirement: The read-back carries the findings the inspection opened

The system SHALL return, with a submitted inspection, the findings whose `origin` is the
inspection itself, each carrying its `item_key`, `location_id`, `description` and the count
of its `photo_object_keys`, so that a reader can see which answer opened which finding.

A finding recorded outside an inspection SHALL NOT be returned here: its `origin` is manual
and it belongs to no submission.

#### Scenario: A negative answer's finding travels with the submission

- **GIVEN** an inspection whose answer to `housekeeping.floors_clear` was negative and
  opened a finding
- **WHEN** the submitted inspection is read
- **THEN** that finding is returned with `item_key` `housekeeping.floors_clear`, its
  `location_id` and its `description`

#### Scenario: A manual finding of the same site is not part of the submission

- **GIVEN** a manual finding recorded at the same site in the same month
- **WHEN** the submitted inspection is read
- **THEN** that finding is not returned

### Requirement: The read-back states the evidence it does not return

The system SHALL NOT return image bytes or retrieval URLs for the photos of an answer or of
a finding, nor for a signature answer. It SHALL instead report how many object keys each
one carries.

This is required because the absence has to be visible: a reader who sees a finding with no
mention of its photos concludes none were taken, and a record that understates its own
evidence is worse than one that names what it is withholding.

#### Scenario: A photo answer reports its count and no image

- **GIVEN** an inspection with a `photo` answer carrying three object keys
- **WHEN** the submitted inspection is read
- **THEN** the response reports that the answer carries three photos
- **AND** no image bytes and no retrieval URL are returned

#### Scenario: A signature answer is reported without its image

- **GIVEN** an inspection with a `signature` answer
- **WHEN** the submitted inspection is read
- **THEN** the response reports that the item was signed
- **AND** no retrieval URL for the signature image is returned

### Requirement: Only a submitted inspection within the reader's scope is readable

The system SHALL refuse to return a submission for a scheduled inspection that has none, and
SHALL refuse in the same way for one the requesting session has no site scope over, so that
the refusal cannot be used to learn whether an inspection exists at a site the reader cannot
see.

Reading a submission SHALL NOT create, alter or remove any row of the submission, its
answers or its findings. The record is immutable and reading it is a read.

#### Scenario: A period that was never submitted has nothing to read

- **GIVEN** a scheduled inspection with no submission
- **WHEN** its submitted inspection is requested
- **THEN** the request is refused as not found

#### Scenario: A submission of another site is not readable

- **GIVEN** a submitted inspection at a site the session has no scope over
- **WHEN** its submitted inspection is requested
- **THEN** the request is refused as not found
- **AND** the refusal is indistinguishable from that of an inspection that does not exist

#### Scenario: Reading writes nothing

- **WHEN** a submitted inspection is read
- **THEN** no row of `inspection`, `inspection_answer` or `finding` is created, changed or
  removed

### Requirement: Deactivated inspection requirements can be archived without changing obligations

The system SHALL allow an `hs_coordinator` to archive an inspection requirement only when its
`deactivated_at` is non-null. Archiving SHALL set `archived_at`, SHALL NOT delete the
`inspection_schedule` row, and SHALL NOT change the periods the rule produced or the months it
historically owed. An attempt to archive an active requirement SHALL be refused with a stated
reason.

#### Scenario: A deactivated requirement is archived

- **GIVEN** an inspection requirement whose `deactivated_at` is non-null and whose `archived_at`
  is null
- **WHEN** an `hs_coordinator` archives the requirement
- **THEN** its `archived_at` is set
- **AND** its `deactivated_at` and existing scheduled inspections are unchanged

#### Scenario: An active requirement cannot be archived

- **GIVEN** an inspection requirement whose `deactivated_at` is null
- **WHEN** an `hs_coordinator` attempts to archive it
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains null

#### Scenario: Archiving does not rewrite the annual schedule

- **GIVEN** a deactivated requirement that historically owed periods in the selected year
- **WHEN** the requirement is archived
- **THEN** those periods remain in the annual schedule projection
- **AND** existing scheduled inspections remain visible

### Requirement: Archived inspection requirements are hidden by default and can be restored

The scheduling surface SHALL omit requirements whose `archived_at` is non-null from the default
requirements table. It SHALL offer an `hs_coordinator` a control to show archived requirements,
identify them as `Archived`, and restore one when no other non-archived requirement exists for the
same `site_id` and `template_id`. Restoration SHALL clear `archived_at` while leaving
`deactivated_at` non-null. Accounts without scheduling administration permission SHALL NOT receive
archive or restore controls.

#### Scenario: Archived requirements are hidden by default

- **GIVEN** the selected site has one current requirement and one requirement whose `archived_at`
  is non-null
- **WHEN** the scheduling surface opens
- **THEN** the current requirement is shown
- **AND** the archived requirement is omitted

#### Scenario: A coordinator shows and restores an archived requirement

- **GIVEN** an archived requirement with no other non-archived requirement for the same `site_id`
  and `template_id`
- **WHEN** an `hs_coordinator` shows archived requirements and restores it
- **THEN** its `archived_at` is cleared
- **AND** its `deactivated_at` remains non-null
- **AND** it returns to the default table as `Deactivated`

#### Scenario: A superseded archived requirement cannot be restored

- **GIVEN** an archived requirement and another non-archived requirement with the same `site_id`
  and `template_id`
- **WHEN** an `hs_coordinator` attempts to restore the archived requirement
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains set

#### Scenario: A reader cannot archive or restore requirements

- **WHEN** an account without scheduling administration permission shows the requirements table
- **THEN** the table does not offer archive or restore controls
