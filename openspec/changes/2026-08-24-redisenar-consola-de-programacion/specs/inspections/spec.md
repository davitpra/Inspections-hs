## MODIFIED Requirements

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
`anchor_month` or because it falls outside the window bounded by `created_at` and
`deactivated_at`, SHALL NOT be projected as a missing period.

A scheduled inspection whose `period_start` falls outside every rule's owing window SHALL still
be shown in the year it belongs to. The projection adds periods that are owed; it never hides a
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

## ADDED Requirements

### Requirement: The annual schedule exposes year-scoped operational summaries and filters

The system SHALL summarize only the projected periods of the selected site and year. It SHALL
identify the total periods due and the subsets that are completed, missed, unassigned and not
opened. A cancelled period SHALL remain part of the annual schedule but SHALL NOT be classified as
completed, missed, unassigned or not opened.

The reader SHALL be able to filter the schedule by requirement and operational state. Selecting
an actionable summary SHALL apply its corresponding filter. Any notice that counts unassigned
periods SHALL use the same selected year and SHALL lead to entries present in the current schedule.

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

The surface SHALL present one current requirement per template. It SHALL let the coordinator
change `default_inspector_id`, deactivate an active requirement after confirming the consequence
for future periods, and reactivate a deactivated requirement. Accounts without scheduling
administration permission SHALL see the requirements without any of those controls.

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

Opening a period SHALL identify the currently published `template_version` that the operation
will freeze. Changing an inspector selection SHALL NOT send an assignment until the coordinator
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

The system SHALL distinguish a failure to load published templates or eligible inspector
candidates from a successful response containing no choices. An operation that depends on failed
supporting data SHALL remain unavailable and SHALL present a connection or server error where the
coordinator attempted the operation.

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
