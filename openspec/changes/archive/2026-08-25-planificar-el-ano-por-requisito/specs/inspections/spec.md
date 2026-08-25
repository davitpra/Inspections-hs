## ADDED Requirements

### Requirement: An inspection requirement exposes a focused annual plan

The system SHALL let a reader open one inspection requirement on a surface of its own,
addressed by the `inspection_schedule` identifier, and SHALL present there one row per
period that requirement owes in a chosen calendar year, ordered by `period_start`. A month
in which the rule does not begin a period SHALL NOT produce a row.

Each row SHALL name its period and its operational status in the first column and SHALL
present the inspector of that period in the second. The surface SHALL name the requirement,
its site and the cadence produced by its `frequency_months` and `anchor_month`, and SHALL
state that the cadence cannot be changed there.

The projection SHALL be the same one the annual schedule uses: a period the rule does not
owe SHALL NOT be shown, and a scheduled inspection of that requirement that falls in the
chosen year SHALL be shown even when no active rule owes it. The reader SHALL be able to
move to another calendar year in both directions, with the same lower bound the annual
schedule applies. An identifier that matches no requirement visible to the account SHALL
be reported as not found and SHALL lead back to the scheduling surface.

#### Scenario: A quarterly requirement owes four rows and no others

- **GIVEN** an active requirement with `frequency_months` `3` and `anchor_month` `1`
- **WHEN** the coordinator opens its annual plan for `2026`
- **THEN** four rows are shown, for the periods beginning in January, April, July and October
- **AND** no row is shown for February, March, May, June, August, September, November or December

#### Scenario: An annual requirement owes one row and a monthly one owes twelve

- **GIVEN** an active requirement with `frequency_months` `12` and `anchor_month` `1`
- **WHEN** the coordinator opens its annual plan for `2026`
- **THEN** one row is shown, labelled for the whole year
- **AND** the annual plan of a requirement with `frequency_months` `1` shows twelve rows for the same year

#### Scenario: The plan states the cadence it cannot change

- **GIVEN** a requirement with `frequency_months` `3` and `anchor_month` `2`
- **WHEN** the coordinator opens its annual plan
- **THEN** the surface describes periods beginning in February, May, August and November
- **AND** it states that `frequency_months` and `anchor_month` cannot be changed there

#### Scenario: A period before the requirement existed is not planned

- **GIVEN** a monthly requirement whose `created_at` is in `2026-03`
- **WHEN** the coordinator opens its annual plan for `2026`
- **THEN** no row is shown for January or February
- **AND** a row is shown for March

#### Scenario: A period the requirement no longer owes is still shown

- **GIVEN** a scheduled inspection of that requirement for `2026-10-01` whose rule was deactivated in `2026-09`
- **WHEN** the coordinator opens its annual plan for `2026`
- **THEN** the October period is shown with its scheduled inspection

#### Scenario: Moving to another year keeps the requirement

- **GIVEN** the annual plan of a quarterly requirement for `2026`
- **WHEN** the coordinator moves to `2027`
- **THEN** the rows are the periods that same requirement owes in `2027`
- **AND** the requirement, its site and its cadence remain named

#### Scenario: An unknown requirement is reported as not found

- **WHEN** an account opens an `inspection_schedule` identifier that is not visible to it
- **THEN** the surface states that the requirement was not found
- **AND** it offers a way back to the scheduling surface

### Requirement: Each owed period of a requirement is planned on its own row

The system SHALL offer an `hs_coordinator`, on each row of the annual plan, the operation
valid for that period and no other.

A period that has not been opened SHALL offer one action to open it, SHALL identify the
published `template_version` that the action will freeze, and SHALL NOT offer an inspector
until the period exists. An opened period whose status is `open` or `missed` SHALL offer
the eligible inspectors of the site and SHALL NOT send an assignment until the coordinator
confirms it. A completed period and a cancelled period SHALL be readable, carrying the
inspector and the `cancellation_reason` they hold, and SHALL offer no assignment.

Each row SHALL carry its own outcome. An operation SHALL be sent for one period at a time,
its pending state SHALL be shown on that row, and a failure SHALL retain the persisted
inspector and display the server's reason on that row alone, leaving the other rows
unchanged. The plan SHALL NOT hold unsaved rows behind a single confirmation of the whole
table.

Accounts without scheduling administration permission SHALL read every row, its status and
its inspector, without any of those controls.

#### Scenario: Opening a period does not assign anybody

- **GIVEN** a row for a period that has not been opened
- **WHEN** the coordinator opens it
- **THEN** the row's action identifies the published `template_version` it freezes
- **AND** the period is created with no `inspector_id`
- **AND** the row then offers the eligible inspectors

#### Scenario: Selecting an inspector does not immediately assign it

- **GIVEN** a row for an opened period and two eligible inspectors
- **WHEN** the coordinator selects a different `inspector_id` without confirming
- **THEN** no assignment request is sent
- **AND** a separate confirmation action remains available on that row

#### Scenario: A missed period can still be assigned

- **GIVEN** a row for a period whose `period_end` has passed with no inspection
- **WHEN** the coordinator opens the annual plan
- **THEN** the row offers the eligible inspectors
- **AND** it states that the period closed without an inspection and can still be submitted

#### Scenario: A completed period is read, not planned

- **GIVEN** a row for a period that carries a submitted inspection
- **WHEN** the coordinator opens the annual plan
- **THEN** the row shows the inspector who holds it and the completed status
- **AND** the row offers no inspector selection

#### Scenario: A cancelled period is read with its reason

- **GIVEN** a row whose only scheduled inspection has been cancelled
- **WHEN** the coordinator opens the annual plan
- **THEN** the row shows the cancelled status and the `cancellation_reason`
- **AND** the row offers no inspector selection

#### Scenario: A rejected assignment affects one row only

- **GIVEN** an annual plan whose rows carry different inspectors
- **WHEN** an assignment is rejected by the server for one period
- **THEN** that row displays the server's reason and keeps the persisted inspector
- **AND** the other rows keep their inspectors and offer their operations unchanged

#### Scenario: A reader cannot plan

- **WHEN** an account whose role is `jhsc_member` opens the annual plan of a requirement
- **THEN** every owed period, its status and its inspector are readable
- **AND** no control to open a period or to assign an inspector is offered

## MODIFIED Requirements

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

Every listed requirement SHALL lead to its own annual plan, addressed by its
`inspection_schedule` identifier. The navigation SHALL be available to every reader,
including accounts without scheduling administration permission, and SHALL be offered for
deactivated and archived requirements as well as active ones.

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
- **AND** each requirement still leads to its annual plan

#### Scenario: A listed requirement leads to its annual plan

- **GIVEN** the scheduling surface listing a current requirement
- **WHEN** the reader follows that requirement
- **THEN** the annual plan of that `inspection_schedule` identifier is presented

### Requirement: Period operations are exposed on demand from an annual entry

The system SHALL let a reader select an owed-period entry of the annual schedule to inspect its
period label, template, status and inspector without placing a form in every entry of that
schedule, which spans every requirement of the site across twelve months. For an
`hs_coordinator`, the focused period view SHALL expose the operations valid for that entry: opening
an unopened period, confirming an inspector assignment, cancelling an eligible scheduled inspection
with a reason, or scheduling a cancelled period again. Other roles SHALL receive the same readable
detail without administrative controls.

Opening a period SHALL identify the currently published `template_version` that the operation will
freeze. Changing an inspector selection SHALL NOT send an assignment until the coordinator
explicitly confirms it. A failed assignment SHALL retain the persisted inspector and display the
server's reason.

Cancelling a scheduled inspection and scheduling a cancelled period again SHALL be reached
only from the focused period view of an annual entry.

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

#### Scenario: The annual entry keeps its form on demand

- **GIVEN** an annual schedule spanning several requirements and twelve months
- **WHEN** the coordinator views it
- **THEN** no entry of that schedule carries an inspector form of its own
- **AND** the operations of an entry remain reachable by selecting it
