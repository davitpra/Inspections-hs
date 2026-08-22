## MODIFIED Requirements

### Requirement: A site is an identified workplace

The system SHALL store each workplace as a `site` row carrying a stable `code`, a human-readable
`name`, a `created_at` timestamp and a nullable `deactivated_at`. `code` SHALL be unique and SHALL
NOT change once assigned: it is what the seeds, the fixtures and the operator use to name a site
without knowing its `id`.

A `site` row SHALL be creatable by the application, by an HS coordinator, and SHALL be updatable by
the application only through the site-management operation for `name` and `deactivated_at`.
The site's identity, including `code`, SHALL be non-deletable by the application. The allowed
columns and the prohibition on deletion SHALL be enforced by the engine for every role, including
the role that owns the table.

#### Scenario: The two workplaces exist after seeding

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** exactly two `site` rows exist, with `code` `st-thomas` and `code` `glencoe`
- **AND** both have a non-null `name` and a null `deactivated_at`

#### Scenario: A site code cannot be reused

- **WHEN** a second `site` row is inserted with `code` `st-thomas`
- **THEN** the insert fails with a unique violation on `code`

#### Scenario: A site code cannot be changed

- **WHEN** any role runs `UPDATE site SET code = 'st-thomas-2' WHERE code = 'st-thomas'`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `code` is unchanged when read back

#### Scenario: A site is never physically removed

- **WHEN** a session connected as the application role runs `DELETE FROM site WHERE code = 'glencoe'`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: A site's name can be changed through site management

- **WHEN** an HS coordinator changes the `name` of a site through the site-management operation
- **THEN** the stored `name` is the submitted name
- **AND** the stored `code` is unchanged

#### Scenario: A site can be logically deactivated

- **WHEN** an HS coordinator removes a site through the site-management operation
- **THEN** the site's `deactivated_at` is non-null
- **AND** the `site` row remains present

### Requirement: The HS coordinator can register a new site from the console

The system SHALL allow only an HS coordinator to register a new `site` from a `code` and a `name`.
The registered row SHALL carry the submitted `code`, the submitted `name`, a `created_at` timestamp
and a null `deactivated_at`. `code` SHALL satisfy the catalogue code pattern and SHALL be unique
across every site, active or not.

The registration operation SHALL NOT accept `deactivated_at` or `code` changes. Site name changes
and deactivation SHALL be offered only by the separate site-management operation. The application
SHALL NOT offer a physical removal or reactivation operation, and the application role SHALL hold
neither `DELETE` on `site` nor `UPDATE` on `site.code`.

#### Scenario: A coordinator registers a third plant

- **WHEN** an HS coordinator submits a `code` and a `name` that no `site` uses
- **THEN** a `site` row is stored with that `code` and that `name`
- **AND** its `deactivated_at` is null
- **AND** the registered site is returned with its `id`, `code`, `name` and `deactivated_at`

#### Scenario: A site code is not reusable from the console

- **WHEN** an HS coordinator submits a `code` that an existing `site` already carries
- **THEN** the request is refused with HTTP 400
- **AND** the refusal names the code that is already in use
- **AND** no new `site` row is stored

#### Scenario: A supervisor cannot register a site

- **WHEN** a `supervisor` submits a site registration
- **THEN** the request is refused with HTTP 403
- **AND** no `site` row is stored

#### Scenario: A malformed site code is refused before it reaches the engine

- **WHEN** an HS coordinator submits a `code` that does not satisfy the catalogue code pattern
- **THEN** the request is refused with HTTP 400
- **AND** no `site` row is stored

#### Scenario: The registered site appears in its registrant's site list

- **GIVEN** an HS coordinator has registered a site
- **WHEN** that account lists the sites
- **THEN** the registered site is returned alongside the sites it already reached

#### Scenario: Registration exposes no lifecycle fields

- **WHEN** the site registration operation is inspected
- **THEN** it accepts only a `code` and a `name`
- **AND** site name changes and deactivation are available only through site management

## ADDED Requirements

### Requirement: The HS coordinator can manage a site from the Locations console

The system SHALL allow only an HS coordinator to update a scoped site's human-readable `name` or
to deactivate that site through the Locations console. The operation SHALL never change `code`,
`created_at` or any historical record. A deactivated site SHALL remain readable with its non-null
`deactivated_at`, but SHALL not appear as an active site column in the Locations console.

#### Scenario: A coordinator renames a site

- **WHEN** an HS coordinator submits a valid new `name` for a scoped site
- **THEN** the request succeeds with the site's `id`, unchanged `code`, new `name` and current
  `deactivated_at`

#### Scenario: A supervisor cannot manage a site

- **WHEN** a `supervisor` submits a site rename or deactivation
- **THEN** the request is refused with HTTP 403
- **AND** the site row is unchanged

#### Scenario: A coordinator cannot change a site code

- **WHEN** an HS coordinator submits a site-management request containing a different `code`
- **THEN** the request is refused with HTTP 400
- **AND** the stored `code` is unchanged

#### Scenario: Removing a site retains the site row

- **WHEN** an HS coordinator removes an active site
- **THEN** the request succeeds
- **AND** the site's `deactivated_at` is set
- **AND** the site remains readable for historical references

#### Scenario: Removing a site unlinks its physical locations

- **GIVEN** a site has `location` rows whose `site_id` is that site's id and whose
  `organization_location_id` is non-null
- **WHEN** an HS coordinator removes the site
- **THEN** every such `organization_location_id` is set to null
- **AND** each `location` row remains present with its `site_id`, `code` and historical fields

#### Scenario: Removing a site does not alter the shared location catalogue

- **GIVEN** a site maps a physical location to an `organization_location` row
- **WHEN** the site is removed
- **THEN** the `organization_location` row remains present and unchanged

#### Scenario: Site removal is atomic with unlinking

- **WHEN** any part of a site-removal transaction fails
- **THEN** the site's `deactivated_at` remains null
- **AND** every affected `location.organization_location_id` retains its previous value

#### Scenario: An already deactivated site cannot be removed again

- **WHEN** an HS coordinator removes a site whose `deactivated_at` is already non-null
- **THEN** the request is refused with HTTP 400
- **AND** no location mapping is changed
