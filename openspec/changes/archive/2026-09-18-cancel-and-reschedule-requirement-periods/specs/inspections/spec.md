## MODIFIED Requirements

### Requirement: Each owed period of a requirement is planned on its own row

The system SHALL offer a `coordinator`, on each row of the annual plan, the operations
valid for that period and no other.

A period that has not been opened SHALL offer one action to open it, SHALL identify the
published `template_version` that the action will freeze, and SHALL NOT offer an inspector
until the period exists. An opened period whose status is `open` or `missed` SHALL offer the
eligible inspectors of the site and SHALL NOT send an assignment until the coordinator
confirms it. A completed period and a cancelled period SHALL be readable, carrying the
inspector and the `cancellation_reason` they hold, and SHALL offer no assignment.

An opened period whose status is `open` or `missed` SHALL also offer an action to cancel it.
Cancelling SHALL require a `reason` of 1 to 500 characters after trimming, SHALL NOT be sent
while the reason is empty, and SHALL be confirmed separately from the action that offers
it. A completed period and a period that has not been opened SHALL NOT offer cancellation.

A cancelled period SHALL offer an action to schedule it again. Scheduling it again SHALL
create a new scheduled inspection for the same site, template and `period_start`, bound
to the `template_version` published at that moment and not to the one the cancelled row
holds. It SHALL identify that version before it is confirmed, and SHALL display the
`cancellation_reason` of the cancelled row while it is being decided. The cancelled row
SHALL remain as the record of the cancellation. Once a period has a scheduled inspection
that is not cancelled, the row SHALL present that inspection and SHALL NOT offer to
schedule the period again.

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
- **AND** the row offers no cancellation

#### Scenario: A cancelled period is read with its reason

- **GIVEN** a row whose only scheduled inspection has been cancelled
- **WHEN** the coordinator opens the annual plan
- **THEN** the row shows the cancelled status and the `cancellation_reason`
- **AND** the row offers no inspector selection
- **AND** the row offers to schedule the period again

#### Scenario: Cancelling an open period requires a reason

- **GIVEN** a row for an opened period whose status is `open`
- **WHEN** the coordinator chooses to cancel it and leaves the `reason` empty
- **THEN** no cancellation request is sent
- **AND** the confirmation remains unavailable until a `reason` is written

#### Scenario: A cancelled period shows its reason and leaves the pending list

- **GIVEN** a row for an opened period whose status is `missed`, assigned to an inspector
- **WHEN** the coordinator cancels it with the `reason` `Plant shutdown`
- **THEN** the row shows the cancelled status and the `cancellation_reason` `Plant shutdown`
- **AND** the period no longer appears in that inspector's pending inspections

#### Scenario: Scheduling a cancelled period again keeps the cancellation

- **GIVEN** a row whose scheduled inspection was cancelled while bound to version `2`, and a
  template whose published version is `3`
- **WHEN** the coordinator confirms scheduling that period again
- **THEN** a new scheduled inspection for the same `site_id`, `template_id` and `period_start`
  is created, bound to version `3`
- **AND** the row presents the new inspection with the status `open` or `missed`
- **AND** the cancelled scheduled inspection still exists with its `cancelled_at` and
  `cancellation_reason`

#### Scenario: A rejected cancellation affects one row only

- **GIVEN** an annual plan with several opened periods
- **WHEN** a cancellation is rejected by the server for one period
- **THEN** the server's reason is displayed for that period
- **AND** that row keeps its previous status
- **AND** the other rows offer their operations unchanged

#### Scenario: A rejected assignment affects one row only

- **GIVEN** an annual plan whose rows carry different inspectors
- **WHEN** an assignment is rejected by the server for one period
- **THEN** that row displays the server's reason and keeps the persisted inspector
- **AND** the other rows keep their inspectors and offer their operations unchanged

#### Scenario: A reader cannot plan

- **WHEN** an account whose role is `inspector` opens the annual plan of a requirement
- **THEN** every owed period, its status and its inspector are readable
- **AND** no control to open a period, to assign an inspector, to cancel a period or to
  schedule a cancelled period again is offered
