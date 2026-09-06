## ADDED Requirements

### Requirement: A coordinator can make an assigned future period visible early

The system SHALL let an account whose role is `hs_coordinator` advance `visible_early` from `false` to `true` on an opened scheduled inspection whose `inspector_id` is non-null, whose `period_start` is later than the current civil month, and which is neither cancelled nor completed. The operation SHALL make that inspection appear in the assigned inspector's pending list immediately. No other role SHALL be allowed the operation.

The scheduling surface SHALL offer this operation as `Make visible` only while those conditions hold, SHALL require confirmation before sending it, and SHALL retain the persisted state with an error inside the confirmation when the request fails.

#### Scenario: A future assignment becomes pending after confirmation

- **GIVEN** an opened scheduled inspection with `visible_early` equal to `false`, a non-null `inspector_id`, and a future `period_start`
- **WHEN** an `hs_coordinator` confirms `Make visible`
- **THEN** `visible_early` becomes `true`
- **AND** the scheduled inspection appears in that inspector's pending list
- **AND** its year-plan row reads `Visible`

#### Scenario: An unassigned future period is not offered the operation

- **GIVEN** an opened scheduled inspection with a null `inspector_id` and a future `period_start`
- **WHEN** an `hs_coordinator` opens its row menu
- **THEN** `Make visible` is not offered
- **AND** assigning an inspector remains available

#### Scenario: A closed inspection cannot change visibility

- **GIVEN** a scheduled inspection that is cancelled or completed
- **WHEN** an `hs_coordinator` requests early visibility
- **THEN** the request is rejected
- **AND** `visible_early` is unchanged

#### Scenario: A non-coordinator cannot change visibility

- **WHEN** an account whose role is not `hs_coordinator` requests early visibility
- **THEN** the request is rejected as forbidden
- **AND** `visible_early` is unchanged

#### Scenario: A failed confirmation remains attributable

- **GIVEN** a future assigned period whose persisted `visible_early` is `false`
- **WHEN** its early-visibility request fails
- **THEN** the confirmation remains open with the failure
- **AND** the year-plan row continues to read `Not visible`
