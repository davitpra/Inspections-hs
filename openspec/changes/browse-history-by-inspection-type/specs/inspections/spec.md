## MODIFIED Requirements

### Requirement: An inspector can read back what they have completed

The system SHALL present to an inspector the scheduled inspections assigned to that account
whose period was completed, each identified by its month, its site and the date it was
completed, ordered most recent first within its inspection type.

The home screen SHALL retain a way to reach the complete history. The history SHALL present
one named section per `template_id` for which that account has a completed inspection, and
each section SHALL contain the complete chronological list for that `template_id` on the
same page. The sections SHALL be ordered by inspection type name.

This history SHALL be derived from the same definition of completion the scheduled
inspections listing already applies, so that a period cannot appear as completed on one
screen and not on the other.

#### Scenario: Completed months of one type are listed newest first

- **GIVEN** an inspector who completed inspections with one `template_id` for `2027-05`,
  `2027-06` and `2027-07`
- **WHEN** the inspector views the complete history
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Completed inspections are grouped by stable type identity

- **GIVEN** an inspector who completed inspections under two template versions sharing one
  `template_id`
- **WHEN** the inspector views the complete history
- **THEN** one inspection type section is presented for that `template_id`
- **AND** its table includes both versions

#### Scenario: All inspection types are visible in one history

- **GIVEN** an inspector who completed inspections with two different `template_id` values
- **WHEN** the inspector views the complete history
- **THEN** one named table is presented for each `template_id`
- **AND** both tables are present without selecting an intermediate type entry
- **AND** each submitted inspection offers access to its report

#### Scenario: Another inspector's completed months are not listed

- **GIVEN** a site where two inspectors each completed inspections
- **WHEN** one of them views the complete history
- **THEN** only the inspection type sections and inspections assigned to that account are presented

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views the complete history
- **THEN** that month is not listed
