## MODIFIED Requirements

### Requirement: A scheduled inspection reports the compliance status of its period

The system SHALL expose, for every non-cancelled `scheduled_inspection`, a compliance status
derived from the engine rather than stored as a column: `completed` when an `inspection` exists
for it, `open` when its `period_end` has not yet passed in the `America/Toronto` calendar and no
`inspection` exists, and `missed` when its `period_end` has passed and no `inspection` exists. A
cancelled scheduled inspection SHALL report `cancelled` together with its `cancellation_reason`.
The status SHALL NOT depend on `recorded_at`: an inspection walked before `period_end` and
synchronised after it SHALL report `completed` for that period, because §5 risk C fixed the device
clock at signing as the compliance clock.

The status SHALL accompany a scheduled inspection **wherever it is listed**, and SHALL NOT be
reachable only through the compliance report of a single site over a range of whole months. The
system SHALL derive it from **one** expression shared by every reader, so that the status a
listing reports and the status the coverage report reports for the same `scheduled_inspection`
cannot disagree, and so that the `America/Toronto` boundary exists in one place.

#### Scenario: A late synchronisation still completes its period

- **GIVEN** a scheduled inspection whose `period_end` is `2026-08-31`
- **AND** a submission whose `signed_at` is `2026-08-28` and whose `received_at` is `2026-09-04`
- **WHEN** the period's compliance status is read
- **THEN** it is `completed`

#### Scenario: A period still running is open, not missed

- **GIVEN** a scheduled inspection of the current period with no submission
- **WHEN** its compliance status is read
- **THEN** it is `open`

#### Scenario: A closed period without a submission is missed

- **GIVEN** a scheduled inspection whose `period_end` has passed, not cancelled, with no
  submission
- **WHEN** its compliance status is read
- **THEN** it is `missed`

#### Scenario: A cancelled period reports its reason

- **GIVEN** a scheduled inspection cancelled with the reason `plant shutdown`
- **WHEN** its compliance status is read
- **THEN** it is `cancelled` and carries the reason `plant shutdown`

#### Scenario: The listing and the coverage report agree on the same row

- **GIVEN** a site with scheduled inspections in four periods, one of each status
- **WHEN** the scheduled inspections are listed and the coverage report is read for the same range
- **THEN** for every `scheduled_inspection_id` present in both, the two statuses are equal

#### Scenario: The status is available without naming a site or a range

- **WHEN** the scheduled inspections within the session's site scope are listed with no site
  parameter and no period range
- **THEN** every entry carries its compliance status

### Requirement: A schedule rule declares what a site owes every month

The system SHALL store recurrence rules in `inspection_schedule` with `site_id`, `template_id`,
`default_inspector_id`, `created_at` and `deactivated_at`. A rule SHALL mean that the site owes one
inspection of that template for every monthly period while the rule is active. At most one active
rule SHALL exist per `(site_id, template_id)`. A rule SHALL never be deleted: it is deactivated,
and a deactivated rule SHALL stop producing new periods while every inspection it already produced
stays valid.

An attempt to create a rule that collides with an active one SHALL be refused with a stated reason
naming the site and the template, and SHALL NOT surface as an unhandled failure. The uniqueness
SHALL remain enforced by the database rather than by a check performed before the insert, so that
two concurrent creations converge on one rule.

#### Scenario: A second active rule for the same site and template is rejected

- **GIVEN** an active rule for site St. Thomas and the monthly safety template
- **WHEN** a second rule is created for the same site and the same template
- **THEN** the insert fails with a unique violation
- **AND** the message names `site_id` and `template_id`

#### Scenario: The duplicate is reported, not raised as an unhandled failure

- **GIVEN** an active rule for site St. Thomas and the monthly safety template
- **WHEN** the coordinator requests a second rule for the same site and the same template
- **THEN** the response carries a dedicated error code rather than an unhandled server failure
- **AND** exactly one active rule exists for that site and template

#### Scenario: A rule can be recreated after deactivation

- **GIVEN** a rule for site St. Thomas and the monthly safety template with `deactivated_at` set
- **WHEN** a new rule is created for the same site and the same template
- **THEN** the insert succeeds and both rows are present

#### Scenario: A deactivated rule stops opening periods

- **GIVEN** a rule deactivated during the current period
- **WHEN** the period opening job runs
- **THEN** no scheduled inspection is created for that rule
- **AND** the inspections that rule opened in previous periods are unchanged

#### Scenario: A rule whose template has no published version cannot be created

- **WHEN** a rule is created for a template that has no `template_version` row
- **THEN** the request is rejected and names the template as having nothing publishable to inspect

## ADDED Requirements

### Requirement: The accounts eligible to be assigned an inspection at a site can be listed

The system SHALL expose, for a site, the accounts eligible to be named as `inspector_id` of a
scheduled inspection at that site: accounts that are not deactivated, whose role is `jhsc_member`,
and whose `user_site_scope` for that `site_id` has not been revoked.

The system SHALL determine that list with **the same predicate** it uses to validate an
assignment, so that every account the list offers is an account a reassignment accepts, and an
account a reassignment refuses as `inspector_invalid` never appears in the list.

The listing SHALL be restricted to accounts whose role is `hs_coordinator`, because it is the only
read that projects the account table and it exists solely to feed an operation that is already
the coordinator's alone. A request for a site outside the session's site scope SHALL be refused
and SHALL return no entry, and the endpoint SHALL apply that check itself, because `app_user` and
`user_site_scope` carry no site isolation policy to apply it for them.

Each entry SHALL carry the account's `id` — the value that travels as `inspector_id`, never the
`person.id` — together with `employee_number`, `first_name` and `last_name`. Those three SHALL be
nullable: eligibility is defined over `user_site_scope` while the name lives in `person`, which is
site-isolated and whose `site_id` is a separate mutable column, so an eligible account whose person
row is outside the reader's scope SHALL still be listed, without its name, rather than dropped.

#### Scenario: Every account offered is an account an assignment accepts

- **GIVEN** a site with a mix of accounts of several roles and scopes
- **WHEN** the eligible accounts for that site are listed
- **AND** each one is then assigned to a scheduled inspection of that site
- **THEN** every assignment is accepted

#### Scenario: An account refused as inspector is never offered

- **GIVEN** an account whose role is `management`, and one whose role is `jhsc_member` but whose
  scope for the site has been revoked, and one that has been deactivated
- **WHEN** the eligible accounts for that site are listed
- **THEN** none of the three appears
- **AND** assigning any of them is refused with the code `inspector_invalid`

#### Scenario: An eligible account whose person row is out of scope is still offered

- **GIVEN** an account whose role is `jhsc_member` with active scope for St. Thomas, whose `person`
  row belongs to Glencoe
- **WHEN** a coordinator whose scope covers only St. Thomas lists the eligible accounts
- **THEN** the account is listed with a null `first_name` and a null `last_name`
- **AND** assigning it to a St. Thomas inspection is accepted

#### Scenario: A JHSC member cannot list the eligible accounts

- **WHEN** an account whose role is `jhsc_member` requests the eligible accounts of its own site
- **THEN** the request is rejected as forbidden

#### Scenario: A site outside the session scope returns nothing

- **WHEN** a coordinator whose scope covers only Glencoe requests the eligible accounts of
  St. Thomas
- **THEN** the request is refused
- **AND** no entry is returned

### Requirement: A scheduled inspection with no inspector is listed and identified as such

The system SHALL return `inspector_id` as null, rather than omitting the entry, for a scheduled
inspection that has not been assigned. A period opened from a schedule rule whose
`default_inspector_id` is null SHALL be reachable by the coordinator from the moment it is created.

This is required because such an inspection is absent from every pending list — those are filtered
by `inspector_id` — and would otherwise exist as an obligation that no screen names.

#### Scenario: An unassigned inspection is listed with a null inspector

- **GIVEN** a schedule rule whose `default_inspector_id` is null
- **WHEN** the period opening job opens its period and the scheduled inspections are listed
- **THEN** the created inspection is listed with a null `inspector_id`

#### Scenario: The unassigned inspection is in nobody's pending list

- **GIVEN** a scheduled inspection whose `inspector_id` is null
- **WHEN** every account of its site reads its pending inspections
- **THEN** the inspection appears in none of them
- **AND** it is still listed among the site's scheduled inspections

#### Scenario: Assigning it puts it in the inspector's pending list

- **GIVEN** a scheduled inspection whose `inspector_id` is null
- **WHEN** the coordinator assigns an eligible account to it
- **THEN** that account's pending inspections include it

### Requirement: The scheduling surface names people, not identifiers

The system SHALL accompany `inspector_id` and `default_inspector_id` with the name of the account
they refer to, resolved by the system rather than left for the reader to resolve.

The name SHALL survive the assignee ceasing to be eligible: an assignment is a historical fact, and
an account that has been deactivated or has lost its scope for the site SHALL still be named on the
inspection it was assigned to, even though it is no longer offered as a candidate.

The name SHALL be null when the account has no `person` row the reader may see, and a null name
SHALL NOT remove the entry.

#### Scenario: A listed assignment carries the assignee's name

- **GIVEN** a scheduled inspection assigned to an account whose person is named Dana Okafor
- **WHEN** the scheduled inspections are listed
- **THEN** the entry carries both the `inspector_id` and the name Dana Okafor

#### Scenario: A deactivated assignee is still named

- **GIVEN** a scheduled inspection assigned to an account that is then deactivated
- **WHEN** the scheduled inspections are listed
- **THEN** the entry still carries the assignee's name
- **AND** that account is not among the eligible accounts for the site

#### Scenario: A rule names its default inspector

- **GIVEN** a schedule rule whose `default_inspector_id` is set
- **WHEN** the schedule rules are listed
- **THEN** the entry carries the default inspector's name alongside the identifier
