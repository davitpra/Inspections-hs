## ADDED Requirements

### Requirement: The inspector home lists every inspection still assigned to them

The system SHALL use the inspector home as the surface that presents one row for every
scheduled inspection assigned to the requesting account that is not cancelled and has no
submission. The rows SHALL preserve the `period_end` ascending order received from the
pending-inspections reading and the surface SHALL state how many rows it holds.

Each row SHALL name its period from `period_start` and `period_months`, its
`template_name`, site, remaining or elapsed days against `period_end`, and its derived
device status. The requirement name SHALL remain present when two rows share a period.

#### Scenario: Two requirements in one period are visible on entry

- **GIVEN** an inspector assigned two scheduled inspections with the same `period_start`
  and different `template_name`
- **WHEN** the inspector opens the application home
- **THEN** both rows are shown in the order returned by the pending reading
- **AND** the home states that it holds two rows

#### Scenario: Nothing pending has an explicit empty state

- **GIVEN** the pending reading contains no scheduled inspection
- **WHEN** the inspector opens the application home
- **THEN** the inspector is told that nothing is scheduled

### Requirement: A pending inspection is selected before capture

The system SHALL make each pending inspection selectable from the home and SHALL open the
selected inspection at `/inspections/$id`. The detail SHALL resolve the assignment by that
`id` and SHALL present only that assignment's preparation, progress, instructions, site,
status, and action. It SHALL NOT substitute an overdue, current, or next assignment for the
one selected by the inspector.

The detail SHALL offer the action derived for that inspection to start, resume, or open its
capture. It SHALL provide a way back to the complete pending list. If the selected `id` is
not in the requesting account's pending reading, the detail SHALL state that the inspection
is unavailable and SHALL NOT offer capture.

#### Scenario: Selecting the second inspection opens the second inspection

- **GIVEN** an inspector with two pending inspections and the first is overdue
- **WHEN** the inspector selects the second inspection
- **THEN** `/inspections/$id` presents the second inspection
- **AND** the overdue inspection is not substituted for it

#### Scenario: An unavailable assignment cannot be started

- **GIVEN** an `id` that is absent from the requesting account's pending reading
- **WHEN** the inspector opens `/inspections/$id`
- **THEN** the inspector is told that the inspection is unavailable
- **AND** no capture action is offered

### Requirement: Field packages can be prepared from the pending list

The system SHALL derive each row's status from the same device-readiness and draft decision
used by its detail. A row with no complete field package SHALL offer the existing package
download without requiring the inspector to open the detail. While device readiness is
unknown, the row SHALL offer no operational action.

After a successful download, the row SHALL identify the inspection as ready and SHALL make
its detail available as the next action. A complete package SHALL NOT be offered a secondary
refresh from the list.

#### Scenario: A second assignment is prepared before leaving coverage

- **GIVEN** a pending inspection without a complete field package
- **WHEN** the inspector downloads its package from the home list
- **THEN** that row becomes ready
- **AND** selecting its action opens `/inspections/$id` rather than capture directly

#### Scenario: Device state has not resolved

- **GIVEN** a row whose stored field package has not resolved
- **WHEN** the home list is presented
- **THEN** that row offers no download or capture action

### Requirement: Supporting inspection access remains on the home

The system SHALL retain on the inspector home the acknowledgement of an accepted
submission, access to past inspections, and drafts that still exist on the device. These
supporting surfaces SHALL NOT be repeated in an individual inspection detail.

#### Scenario: Returning from an accepted submission

- **GIVEN** an inspector whose signed submission was accepted
- **WHEN** capture returns the inspector to the home
- **THEN** the home acknowledges the accepted submission
- **AND** the submitted inspection is absent from the pending rows

## REMOVED Requirements

### Requirement: The inspector's home names the assignment that comes next

**Reason**: The inspector now selects an assignment explicitly from the complete pending
list; automatically naming a next assignment would restore a second, contradictory choice.

**Migration**: Use the pending rows on the inspector home and open the selected assignment
at `/inspections/$id`.
