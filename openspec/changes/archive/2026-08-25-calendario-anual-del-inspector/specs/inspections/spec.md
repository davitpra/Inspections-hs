## ADDED Requirements

### Requirement: The inspector home presents an annual view of assigned periods

The system SHALL present an annual matrix on the inspector home containing every scheduled inspection whose `inspector_id` is the requesting account and whose `period_start` falls in the selected year. The matrix SHALL include open, missed, completed and cancelled inspections, SHALL exclude scheduled inspections assigned to another account, and SHALL NOT invent unopened periods from site requirements.

The system SHALL allow the inspector to navigate calendar years and read the recorded status and details of an assigned period from its matrix cell.

#### Scenario: The annual view includes every recorded assignment state

- **GIVEN** an account has open, completed and cancelled scheduled inspections with `period_start` in the selected year
- **WHEN** the account opens the inspector home
- **THEN** the annual matrix contains each of those scheduled inspections
- **AND** each cell identifies its recorded status

#### Scenario: Another inspector's periods stay out of the annual view

- **GIVEN** two accounts have scheduled inspections in the same site and year
- **WHEN** one account opens the inspector home
- **THEN** the annual matrix contains only scheduled inspections whose `inspector_id` matches that account

#### Scenario: Site requirements do not become personal assignments

- **GIVEN** an active inspection requirement owes a period that has not been opened and assigned
- **WHEN** an inspector opens the annual view
- **THEN** the matrix does not present that unopened period as their work

#### Scenario: An inspector reads an assigned period

- **GIVEN** an assigned scheduled inspection appears in the annual matrix
- **WHEN** the inspector selects its cell
- **THEN** the system presents that period's recorded details without administrative controls
