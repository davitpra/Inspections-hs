## ADDED Requirements

### Requirement: An inspector browses inspection-derived findings by inspection type

The system SHALL present a findings index with one entry per `template_id` for which the
signed-in account completed at least one inspection that recorded a finding. Each entry SHALL
identify the inspection type and count those completed inspections, not the individual
findings they recorded. Selecting an entry SHALL present all matching inspections most recent
first, and each inspection SHALL offer its existing findings-only reading.

The index and type detail SHALL exclude clean inspections, inspections completed by another
account, incomplete periods and manual findings that have no `inspection_id` or inspection
type. They SHALL derive findings from the reader's existing site-scoped finding listing.

#### Scenario: Inspection versions share one findings type entry

- **GIVEN** the account completed two inspections with one `template_id` under different
  `template_version_id` values and both recorded findings
- **WHEN** the account views the findings index
- **THEN** one entry is presented for that `template_id`
- **AND** its completed inspection count is `2`

#### Scenario: Multiple findings count as one inspection

- **GIVEN** one completed inspection recorded three findings
- **WHEN** the account views the findings index
- **THEN** the inspection type count increases by `1`

#### Scenario: Clean and foreign inspections are excluded

- **GIVEN** the account completed a clean inspection and another account completed an
  inspection that recorded a finding
- **WHEN** the account views the findings index
- **THEN** neither inspection contributes an entry or count

#### Scenario: A type entry opens its inspections with findings

- **GIVEN** the account completed inspections of one `template_id` in `2027-05` and `2027-07`
  and both recorded findings
- **WHEN** the account selects that type from the findings index
- **THEN** the two inspections are listed in the order `2027-07`, `2027-05`
- **AND** each inspection offers its findings-only reading addressed by scheduled inspection id

#### Scenario: An unavailable findings type is not disclosed

- **GIVEN** a `template_id` with no inspection containing findings completed by the account
- **WHEN** the account opens its findings type detail address
- **THEN** the system reports that the inspection type is not visible to the account
