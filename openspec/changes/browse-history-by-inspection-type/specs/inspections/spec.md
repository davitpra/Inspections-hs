## MODIFIED Requirements

### Requirement: An inspector can read back what they have completed

The system SHALL present to an inspector the scheduled inspections assigned to that account
whose period was completed, each identified by its month, its site and the date it was
completed, ordered most recent first within its inspection type.

The home screen SHALL retain a way to reach the complete history. The history index SHALL
present one entry per `template_id` for which that account has a completed inspection, and
SHALL identify the inspection type and the number of completed inspections. Selecting an
inspection type SHALL present the complete chronological list for that `template_id`.

This history SHALL be derived from the same definition of completion the scheduled
inspections listing already applies, so that a period cannot appear as completed on one
screen and not on the other.

#### Scenario: Completed months of one type are listed newest first

- **GIVEN** an inspector who completed inspections with one `template_id` for `2027-05`,
  `2027-06` and `2027-07`
- **WHEN** the inspector selects that inspection type from the history index
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Completed inspections are grouped by stable type identity

- **GIVEN** an inspector who completed inspections under two template versions sharing one
  `template_id`
- **WHEN** the inspector views the history index
- **THEN** one inspection type entry is presented for that `template_id`
- **AND** its completed inspection count includes both versions

#### Scenario: A type entry opens its complete history

- **GIVEN** an inspector whose history index contains a completed inspection type
- **WHEN** the inspector selects that type entry
- **THEN** the complete list of that account's completed inspections with the selected
  `template_id` is presented
- **AND** each submitted inspection offers access to its report

#### Scenario: Another inspector's completed months are not listed

- **GIVEN** a site where two inspectors each completed inspections
- **WHEN** one of them views the history index or an inspection type history
- **THEN** only the inspection types and inspections assigned to that account are presented

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views the history index or an inspection type history
- **THEN** that month is not counted or listed

#### Scenario: An unavailable type is not disclosed

- **GIVEN** a `template_id` for which the inspector has no visible completed inspection
- **WHEN** the inspector opens its history detail address
- **THEN** the system reports that the inspection type is not visible to the account
