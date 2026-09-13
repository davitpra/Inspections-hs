## MODIFIED Requirements

### Requirement: An inspector can read back what they have completed

The system SHALL present to a signed-in account the scheduled inspections whose period was
completed, each identified by its month, its site and the date it was completed, ordered most
recent first within its inspection type. An `hs_coordinator` or `management` account SHALL see
completed inspections for every site in its active site scope, while a `jhsc_member` account
SHALL see only completed inspections assigned to that account. For administrative accounts, each
history row SHALL also identify the inspector who completed the inspection by the available
inspector name.

The home screen SHALL retain a way to reach the complete history. The history SHALL present one
named section per `template_id` for which a completed inspection is available to the account, and
each section SHALL contain the complete chronological list for that `template_id` on the same page.
The sections SHALL be ordered by inspection type name. For `hs_coordinator` and `management`, the
history SHALL include completed inspections assigned to other accounts when those inspections
belong to a site in the account's active site scope.

This list SHALL be derived from the same definition of completion the scheduled inspections
listing already applies, so that a period cannot appear as completed on one screen and not on the
other. Drafts, incomplete periods, missed periods and cancelled periods SHALL NOT be presented as
completed history.

#### Scenario: Completed months of one type are listed newest first

- **GIVEN** an inspector who completed inspections with one `template_id` for `2027-05`, `2027-06` and `2027-07`
- **WHEN** the inspector views the complete history
- **THEN** the three are listed in the order `2027-07`, `2027-06`, `2027-05`
- **AND** each carries the date it was completed

#### Scenario: Completed inspections are grouped by stable type identity

- **GIVEN** an inspector who completed inspections under two template versions sharing one `template_id`
- **WHEN** the inspector views the complete history
- **THEN** one inspection type section is presented for that `template_id`
- **AND** its table includes both versions

#### Scenario: All inspection types are visible in one history

- **GIVEN** an inspector who completed inspections with two different `template_id` values
- **WHEN** the inspector views the complete history
- **THEN** one named table is presented for each `template_id`
- **AND** both tables are present without selecting an intermediate type entry
- **AND** each submitted inspection offers access to its report

#### Scenario: A coordinator reviews completed inspections in the active site scope

- **GIVEN** an `hs_coordinator` whose active site scope contains a site where two inspectors each completed inspections
- **WHEN** the coordinator views the complete history
- **THEN** the history presents completed inspections assigned to both inspectors

#### Scenario: Management reviews completed inspections in the active site scope

- **GIVEN** a `management` account whose active site scope contains a site where another inspector completed an inspection
- **WHEN** management views the complete history
- **THEN** the completed inspection assigned to the other inspector is presented with access to its report

#### Scenario: Administrative history identifies the completing inspector

- **GIVEN** an `hs_coordinator` or `management` account reviewing a completed inspection assigned to another account
- **WHEN** the account views the complete history
- **THEN** the inspection row presents the assigned inspector's name

#### Scenario: A completed inspection outside the active site scope is not listed

- **GIVEN** an administrative account whose active site scope excludes the site where an inspection was completed
- **WHEN** the account views the complete history
- **THEN** that inspection is not presented

#### Scenario: An outstanding month is not listed as completed

- **GIVEN** an inspector with an overdue assignment and no submission for it
- **WHEN** the inspector views the complete history
- **THEN** that month is not listed
