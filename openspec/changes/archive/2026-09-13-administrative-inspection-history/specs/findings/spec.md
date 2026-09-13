## MODIFIED Requirements

### Requirement: An inspector browses inspection-derived findings by inspection type

The system SHALL present one named findings section per `template_id` for which the signed-in
account can review a completed inspection that recorded a finding. Each section SHALL contain all
matching inspections most recent first on the same page, and each inspection SHALL offer its
existing findings-only reading. The sections SHALL be ordered by inspection type name.

An `hs_coordinator` or `management` account SHALL be able to review findings from completed
inspections assigned to any account when the inspection belongs to a site in its active site
scope. Each findings row presented to an administrative account SHALL identify the inspector who
completed the inspection by the available inspector name. A `jhsc_member` account SHALL be able to
review only findings from completed inspections assigned to that account.

The findings sections SHALL exclude clean inspections, inspections outside the reader's active
site scope, incomplete periods and manual findings that have no `inspection_id` or inspection
type. They SHALL derive findings from the reader's existing site-scoped finding listing.

#### Scenario: Inspection versions share one findings type section

- **GIVEN** the account completed two inspections with one `template_id` under different `template_version_id` values and both recorded findings
- **WHEN** the account views findings
- **THEN** one section is presented for that `template_id`
- **AND** its table contains both completed inspections

#### Scenario: Multiple findings count as one inspection

- **GIVEN** one completed inspection recorded three findings
- **WHEN** the account views findings
- **THEN** that inspection is presented once in its type section

#### Scenario: Clean and foreign inspections are excluded for a JHSC member

- **GIVEN** the account completed a clean inspection and another account completed an inspection that recorded a finding
- **WHEN** the `jhsc_member` account views findings
- **THEN** neither inspection is presented in a type section

#### Scenario: Administrative accounts can review foreign findings in scope

- **GIVEN** an `hs_coordinator` or `management` account and another account completed an inspection in a site within the administrator's active site scope, and that inspection recorded a finding
- **WHEN** the administrative account views findings
- **THEN** the completed inspection is presented in its inspection type section

#### Scenario: Administrative findings identify the completing inspector

- **GIVEN** an `hs_coordinator` or `management` account reviewing a finding from an inspection assigned to another account
- **WHEN** the administrative account views findings
- **THEN** the inspection row presents the assigned inspector's name

#### Scenario: Findings outside the active site scope are excluded

- **GIVEN** an administrative account and another account completed an inspection with a finding in a site outside the administrator's active site scope
- **WHEN** the administrative account views findings
- **THEN** that inspection is not presented

#### Scenario: All findings types are visible on one page

- **GIVEN** the account completed inspections of one `template_id` in `2027-05` and `2027-07` and both recorded findings
- **WHEN** the account views findings
- **THEN** the two inspections are listed in the order `2027-07`, `2027-05`
- **AND** each inspection offers its findings-only reading addressed by scheduled inspection id
