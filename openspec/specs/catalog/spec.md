## Purpose

Defines the two workplaces and, for each of them, the closed list of locations a finding can be
attributed to, so that "the same problem, in the same place" is a groupable fact rather than a
guess made over free text, and so that a location retired today still resolves from the
inspections that referenced it years ago.

## Requirements

### Requirement: A site is an identified workplace

The system SHALL store each workplace as a `site` row carrying a stable `code`, a human-readable
`name`, a `created_at` timestamp and a nullable `deactivated_at`. `code` SHALL be unique and
SHALL NOT change once assigned: it is what the seeds, the fixtures and the operator use to name
a site without knowing its `id`.

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

#### Scenario: A site is never removed

- **WHEN** a session connected as the application role runs `DELETE FROM site WHERE code = 'glencoe'`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

### Requirement: An account can list the sites in its own scope

The system SHALL expose, for the requesting account, the sites its active site scope covers, each
carrying `id`, `code`, `name` and `deactivated_at`. A site outside that scope SHALL NOT be
returned, and a session that declares no scope SHALL receive an empty list.

The system SHALL apply that restriction **in the query**, and that is not a departure from the rule
that site isolation is enforced by policy rather than by the endpoint. `site` carries no row
security policy by an explicit decision recorded with the table: a policy there would create a
bootstrap circularity — inserting the first row would require declaring a site identifier in the
session scope before that identifier exists — in exchange for hiding the fact that the other plant
exists, which is not what the confidentiality requirement protects. What it protects is the
findings, and those live in tables that do carry `site_id` and a policy. Isolation begins at
`location`. There is therefore no policy being bypassed here: the scope filter is selection, in the
same category as the site filter already applied when serving an inspection's locations and roster.

A deactivated site SHALL still be returned, flagged by its `deactivated_at`, so that a rule or an
inspection belonging to a closed plant still resolves to a name rather than to an identifier.

#### Scenario: The list is exactly the session's scope

- **GIVEN** an account whose active scope covers St. Thomas only
- **WHEN** it lists the sites
- **THEN** St. Thomas is returned
- **AND** Glencoe is not returned

#### Scenario: A session with no scope receives nothing

- **WHEN** the site list is read in a session that declares no site scope
- **THEN** the list is empty

#### Scenario: A deactivated site is named, not hidden

- **GIVEN** a site in the account's scope whose `deactivated_at` is set
- **WHEN** the account lists the sites
- **THEN** the site is returned with its `deactivated_at` set

#### Scenario: Every role may name the plants it works in

- **WHEN** an account whose role is `jhsc_member` lists the sites
- **THEN** the sites of its own scope are returned

### Requirement: A location belongs to exactly one site

The system SHALL store every location as a `location` row carrying `site_id`, a `code` that is
stable for the life of the row, a `name`, a `created_at` timestamp and a nullable
`deactivated_at`. `site_id` SHALL be mandatory and SHALL reference an existing `site`. A location
SHALL NOT belong to two sites, and SHALL NOT exist without one.

#### Scenario: A location without a site is rejected

- **WHEN** a `location` row is inserted with a null `site_id`
- **THEN** the insert is rejected
- **AND** the rejection comes from the site-isolation policy, which a null `site_id` cannot
  satisfy, before the not-null constraint is reached

#### Scenario: A location pointing at an unknown site is rejected

- **WHEN** a `location` row is inserted with a `site_id` that matches no `site` row
- **THEN** the insert fails with a foreign key violation

#### Scenario: A location cannot be moved to another site

- **WHEN** any role runs `UPDATE location SET site_id = <the other site's id> WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `site_id` is unchanged when read back

### Requirement: Location codes and active names are unique within their site

The system SHALL enforce that `code` is unique per `site_id`, so that a location can be named in
a seed or a fixture without ambiguity. The system SHALL also enforce that `name` is unique per
`site_id` **among locations whose `deactivated_at` is null**, so that the selection list never
offers the same wording twice, while a name freed by a deactivation years earlier remains
reusable.

The two sites SHALL be independent namespaces: the same `code` and the same `name` may exist at
both.

#### Scenario: A duplicate code within a site is rejected

- **WHEN** a second `location` row is inserted with the same `site_id` and the same `code` as an
  existing row
- **THEN** the insert fails with a unique violation

#### Scenario: The same code at the other site is accepted

- **WHEN** a `location` row with `code` `shipping-dock` is inserted for `st-thomas`
- **AND** a `location` row with `code` `shipping-dock` is inserted for `glencoe`
- **THEN** both rows exist

#### Scenario: A duplicate active name within a site is rejected

- **WHEN** a second active `location` row is inserted with the same `site_id` and the same `name`
  as an existing active row
- **THEN** the insert fails with a unique violation

#### Scenario: A name freed by deactivation can be used again

- **WHEN** the `location` row named `Packaging line 3` has a non-null `deactivated_at`
- **AND** a new `location` row is inserted for the same `site_id` with `name` `Packaging line 3`
  and a different `code`
- **THEN** the insert succeeds
- **AND** both rows exist, one active and one deactivated

### Requirement: A location's identity is immutable; only its label and its status change

The system SHALL allow updates to `location.name` and `location.deactivated_at` and SHALL reject
updates to every other column, including `id`, `site_id`, `code` and `created_at`. The rejection
SHALL hold for every role, not only for the application role.

#### Scenario: Renaming is accepted

- **WHEN** a session connected as the application role runs
  `UPDATE location SET name = 'Packaging line 3 (west)' WHERE id = <existing id>`
- **THEN** the statement succeeds and the new `name` is readable back

#### Scenario: Changing the code is rejected for the application role

- **WHEN** a session connected as the application role runs
  `UPDATE location SET code = 'packaging-line-9' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)

#### Scenario: Changing the code is rejected for the owner role

- **WHEN** a session connected as the migration role — which owns the table — runs
  `UPDATE location SET code = 'packaging-line-9' WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`, not with a privilege error
- **AND** the stored `code` is unchanged when read back

### Requirement: Locations are deactivated, never deleted

The system SHALL retire a location by setting `location.deactivated_at` and SHALL NOT provide any
way to delete one. A deactivated location SHALL be absent from the selection list offered for new
records and SHALL still resolve as a reference from records that already point at it, so that a
historical inspection keeps reporting the place it was carried out in.

Reactivation SHALL be possible by setting `deactivated_at` back to null, and SHALL be subject to
the same active-name uniqueness rule as an insert.

#### Scenario: Deleting a location is rejected

- **WHEN** a session connected as the application role runs `DELETE FROM location WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: Deleting a location is rejected for the owner role too

- **WHEN** a session connected as the migration role runs `DELETE FROM location WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`

#### Scenario: A deactivated location still resolves from a historical record

- **WHEN** a record referencing location `packaging-line-3` exists
- **AND** `deactivated_at` is then set on that `location` row
- **THEN** reading the record back still resolves the location's `code` and `name`

#### Scenario: A deactivated location is not offered for selection

- **WHEN** the selection list for a site is read
- **THEN** it contains every `location` of that site whose `deactivated_at` is null
- **AND** it contains no `location` whose `deactivated_at` is non-null

#### Scenario: Reactivating onto a taken name is rejected

- **WHEN** an active `location` of the site already carries `name` `Packaging line 3`
- **AND** `deactivated_at` is set back to null on a deactivated `location` of the same site with
  the same `name`
- **THEN** the update fails with a unique violation

### Requirement: Location is chosen from the list, never typed

The system SHALL model the location of any record as a reference to a `location` row. It SHALL
NOT provide a free-text location field anywhere in the schema or in the shared contracts: a
location that is not in the catalogue cannot be recorded, and adding one is a catalogue
operation.

#### Scenario: The shared contract exposes a reference, not a string

- **WHEN** the shared contract for a location-bearing record is inspected
- **THEN** its location field is the identifier of a catalogue entry
- **AND** no field accepts arbitrary location text

#### Scenario: A reference to an unknown location is rejected

- **WHEN** a record is written with a location identifier that matches no `location` row
- **THEN** the write fails with a foreign key violation

### Requirement: A record cannot borrow a location from another site

The system SHALL guarantee that a record belonging to a site can only reference a location of
that same site. The guarantee SHALL be structural — enforced by the database over the pair
`(site_id, location_id)` — and SHALL NOT depend on the endpoint validating the payload.

#### Scenario: A cross-site location reference is rejected

- **WHEN** a record whose `site_id` is `st-thomas` is written with a `location_id` belonging to
  `glencoe`
- **THEN** the write fails with a foreign key violation
- **AND** the failure occurs even when the write is issued directly against the database, with no
  application code involved

#### Scenario: A same-site location reference is accepted

- **WHEN** a record whose `site_id` is `st-thomas` is written with a `location_id` belonging to
  `st-thomas`
- **THEN** the write succeeds

### Requirement: The catalogue is isolated per site

The system SHALL restrict every read and write of `location` to the sites declared as the
transaction's scope, through a row-level security policy rather than a `WHERE` clause in the
endpoint. A transaction that declares no scope SHALL see no location at all.

#### Scenario: A single-site scope sees only its own locations

- **WHEN** a transaction declares a scope of `st-thomas` only
- **THEN** selecting from `location` returns only locations whose `site_id` is `st-thomas`
- **AND** the locations of `glencoe` are absent from the result

#### Scenario: A two-site scope sees both catalogues

- **WHEN** a transaction declares a scope of both sites, as the coordinator's scope does
- **THEN** selecting from `location` returns the locations of both sites

#### Scenario: No declared scope means no rows

- **WHEN** a transaction selects from `location` without declaring any scope
- **THEN** the result is empty, and no error is raised

#### Scenario: Inserting outside the declared scope is rejected

- **WHEN** a transaction declaring a scope of `st-thomas` only inserts a `location` whose
  `site_id` is `glencoe`
- **THEN** the insert is rejected by the row-level security policy

#### Scenario: The isolation applies to the owner role as well

- **WHEN** the migration role — which owns the table — selects from `location` in a transaction
  declaring a scope of `st-thomas` only
- **THEN** the locations of `glencoe` are absent from the result

### Requirement: A location is one level deep

The system SHALL model a location as a flat entry within its site. It SHALL NOT provide a parent
reference, a hierarchy, coordinates, floor-plan geometry or a scannable code. Subdividing a place
means registering another entry with its own `code`.

#### Scenario: The catalogue exposes no parent

- **WHEN** the `location` schema is inspected
- **THEN** it declares no self-referencing parent column and no geometry or coordinate column

### Requirement: The catalogue is loaded from versioned seed files

The system SHALL load the two sites and their initial locations from SQL seed files kept under
version control, safe to run more than once. Sites SHALL be seeded with fixed identifiers so that
seeds, fixtures and tests can reference a site without querying for it first.

#### Scenario: Seeding twice leaves one copy

- **WHEN** the seed command runs against a database that already contains the seeded catalogue
- **THEN** it completes without error
- **AND** the number of `site` and `location` rows is unchanged

#### Scenario: Each site starts with a usable catalogue

- **WHEN** the seed command runs against a freshly migrated database
- **THEN** each `site` row has at least one active `location`
- **AND** every seeded `location` has a `code`, a `name` and a null `deactivated_at`
