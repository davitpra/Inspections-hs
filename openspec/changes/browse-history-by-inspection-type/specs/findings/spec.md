## ADDED Requirements

### Requirement: An inspector browses inspection-derived findings by inspection type

The system SHALL present one named findings section per `template_id` for which the signed-in
account completed at least one inspection that recorded a finding. Each section SHALL contain
all matching inspections most recent first on the same page, and each inspection SHALL offer
its existing findings-only reading. The sections SHALL be ordered by inspection type name.

The findings sections SHALL exclude clean inspections, inspections completed by another
account, incomplete periods and manual findings that have no `inspection_id` or inspection
type. They SHALL derive findings from the reader's existing site-scoped finding listing.

#### Scenario: Inspection versions share one findings type section

- **GIVEN** the account completed two inspections with one `template_id` under different
  `template_version_id` values and both recorded findings
- **WHEN** the account views findings
- **THEN** one section is presented for that `template_id`
- **AND** its table contains both completed inspections

#### Scenario: Multiple findings count as one inspection

- **GIVEN** one completed inspection recorded three findings
- **WHEN** the account views findings
- **THEN** that inspection is presented once in its type section

#### Scenario: Clean and foreign inspections are excluded

- **GIVEN** the account completed a clean inspection and another account completed an
  inspection that recorded a finding
- **WHEN** the account views findings
- **THEN** neither inspection is presented in a type section

#### Scenario: All findings types are visible on one page

- **GIVEN** the account completed inspections of one `template_id` in `2027-05` and `2027-07`
  and both recorded findings
- **WHEN** the account views findings
- **THEN** the two inspections are listed in the order `2027-07`, `2027-05`
- **AND** each inspection offers its findings-only reading addressed by scheduled inspection id
