## ADDED Requirements

### Requirement: The HS coordinator can register a new site from the console

The system SHALL allow only an HS coordinator to register a new `site` from a `code` and a `name`.
The registered row SHALL carry the submitted `code`, the submitted `name`, a `created_at` timestamp
and a null `deactivated_at`. `code` SHALL satisfy the catalogue code pattern and SHALL be unique
across every site, active or not.

The system SHALL NOT offer, through this operation or any other application endpoint, a way to
rename a site, to deactivate it, to reactivate it or to remove it: the application role holds
`INSERT` on `site` and holds neither `UPDATE` nor `DELETE`.

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

#### Scenario: The console offers no way to rename or close a site

- **WHEN** the site registration operation is inspected
- **THEN** it accepts only a `code` and a `name`
- **AND** no application endpoint updates `site.name` or `site.deactivated_at`

### Requirement: Registering a site records it in the audit chain

The system SHALL write a `site.created` entry to `audit_log` for every `site` registered, from the
database engine rather than from the service, so that any write path that registers a site is
recorded. The entry SHALL carry the registering account as its actor, and its `site_id` SHALL be
the identifier of the site just registered. The entry SHALL be written on the new site's own chain
and on no other site's chain.

#### Scenario: The registration is recorded on the new site's chain

- **WHEN** an HS coordinator registers a site
- **THEN** an `audit_log` entry whose `event_type` is `site.created` exists
- **AND** its `site_id` is the identifier of the registered site
- **AND** its `actor_user_id` is the registering account
- **AND** its payload carries the registered `code` and `name`

#### Scenario: The other plants record nothing about the new one

- **WHEN** an HS coordinator scoped to St. Thomas and Glencoe registers a site
- **THEN** no `site.created` entry is written on the St. Thomas chain
- **AND** no `site.created` entry is written on the Glencoe chain

#### Scenario: A seeded site is recorded the same way

- **WHEN** a `site` row is inserted by the migration role rather than by the application
- **THEN** a `site.created` entry is written for it
- **AND** its `actor_user_id` is null, because no account is behind a seed

## MODIFIED Requirements

### Requirement: A site is an identified workplace

The system SHALL store each workplace as a `site` row carrying a stable `code`, a human-readable
`name`, a `created_at` timestamp and a nullable `deactivated_at`. `code` SHALL be unique and
SHALL NOT change once assigned: it is what the seeds, the fixtures and the operator use to name
a site without knowing its `id`.

A `site` row SHALL be creatable by the application, by an HS coordinator, and SHALL remain
non-updatable and non-deletable by it. The immutability of a site's identity SHALL be enforced by
the engine for every role, including the role that owns the table.

#### Scenario: The two initial workplaces exist after seeding

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** `site` rows with `code` `st-thomas` and `code` `glencoe` exist
- **AND** both have a non-null `name` and a null `deactivated_at`

#### Scenario: A site code cannot be reused

- **WHEN** a second `site` row is inserted with `code` `st-thomas`
- **THEN** the insert fails with a unique violation on `code`

#### Scenario: A site code cannot be changed

- **WHEN** any role runs `UPDATE site SET code = 'st-thomas-2' WHERE code = 'st-thomas'`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `code` is unchanged when read back

#### Scenario: A site is never removed

- **WHEN** a session connected as the application role runs `DELETE FROM site WHERE code = 'glencoe'`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: A site's name cannot be changed by the application

- **WHEN** a session connected as the application role runs
  `UPDATE site SET name = 'Renamed' WHERE code = 'glencoe'`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the stored `name` is unchanged when read back

### Requirement: The catalogue is loaded from versioned seed files

The system SHALL load the initial sites and their initial locations from SQL seed files kept under
version control, safe to run more than once. Seeded sites SHALL carry fixed identifiers so that
seeds, fixtures and tests can reference them without querying for them first. Seeding SHALL be the
way the catalogue starts, not the only way a site can come to exist.

#### Scenario: Seeding twice leaves one copy

- **WHEN** the seed command runs against a database that already contains the seeded catalogue
- **THEN** it completes without error
- **AND** the number of `site` and `location` rows is unchanged

#### Scenario: Each seeded site starts with a usable catalogue

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** each seeded `site` row has at least one active `location`
- **AND** every seeded `location` has a `code`, a `name` and a null `deactivated_at`

#### Scenario: Seeding does not disturb a site registered from the console

- **GIVEN** an HS coordinator has registered a site that no seed file names
- **WHEN** the seed command runs again
- **THEN** the registered site is still present and unchanged
