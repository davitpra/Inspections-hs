## RENAMED Requirements

- FROM: `### Requirement: The HS coordinator can register a new site from the console`
- TO: `### Requirement: The coordinator can register a new site from the console`

- FROM: `### Requirement: The HS coordinator can manage a site from the Locations console`
- TO: `### Requirement: The coordinator can manage a site from the Locations console`

- FROM: `### Requirement: The HS coordinator adds catalogue entries from the console`
- TO: `### Requirement: The coordinator adds catalogue entries from the console`

- FROM: `### Requirement: The HS coordinator can retire a shared organization location`
- TO: `### Requirement: The coordinator can retire a shared organization location`


## MODIFIED Requirements

### Requirement: A site is an identified workplace

The system SHALL store each workplace as a `site` row carrying a stable `code`, a human-readable
`name`, a `created_at` timestamp and a nullable `deactivated_at`. `code` SHALL be unique and
SHALL NOT change once assigned: it is what the seeds, the fixtures and the operator use to name
a site without knowing its `id`.

A `site` row SHALL be creatable by the application, by a coordinator, and SHALL be updatable by
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

- **WHEN** a coordinator changes the `name` of a site through the site-management operation
- **THEN** the stored `name` is the submitted name
- **AND** the stored `code` is unchanged

#### Scenario: A site can be logically deactivated

- **WHEN** a coordinator removes a site through the site-management operation
- **THEN** the site's `deactivated_at` is non-null
- **AND** the `site` row remains present when read back

### Requirement: The coordinator can register a new site from the console

The system SHALL allow only an administrative account — `coordinator` or `management` — to
register a new `site` from a `code` and a `name`.
The registered row SHALL carry the submitted `code`, the submitted `name`, a `created_at` timestamp
and a null `deactivated_at`. `code` SHALL satisfy the catalogue code pattern and SHALL be unique
across every site, active or not.

The registration operation SHALL NOT accept `deactivated_at` or `code` changes. Site name changes,
deactivation and reactivation SHALL be offered only by the separate site-management operation. The
 application SHALL NOT offer a physical removal operation, and the application role SHALL hold
 neither `DELETE` on `site` nor `UPDATE` on `site.code`.

#### Scenario: A coordinator registers a third plant

- **WHEN** a coordinator submits a `code` and a `name` that no `site` uses
- **THEN** a `site` row is stored with that `code` and that `name`
- **AND** its `deactivated_at` is null
- **AND** the registered site is returned with its `id`, `code`, `name` and `deactivated_at`

#### Scenario: A site code is not reusable from the console

- **WHEN** a coordinator submits a `code` that an existing `site` already carries
- **THEN** the request is refused with HTTP 400
- **AND** the refusal names the code that is already in use
- **AND** no new `site` row is stored

#### Scenario: An inspector cannot register a site

- **WHEN** an `inspector` submits a site registration
- **THEN** the request is refused with HTTP 403
- **AND** no `site` row is stored

#### Scenario: A malformed site code is refused before it reaches the engine

- **WHEN** a coordinator submits a `code` that does not satisfy the catalogue code pattern
- **THEN** the request is refused with HTTP 400
- **AND** no `site` row is stored

#### Scenario: The registered site appears in its registrant's site list

- **GIVEN** a coordinator has registered a site
- **WHEN** that account lists the sites
- **THEN** the registered site is returned alongside the sites it already reached

#### Scenario: Registration exposes no lifecycle fields

- **WHEN** the site registration operation is inspected
- **THEN** it accepts only a `code` and a `name`
- **AND** site name changes, deactivation and reactivation are available only through site management

#### Scenario: A removed site is not registered again under its own code

- **GIVEN** a site whose `deactivated_at` is non-null
- **WHEN** a coordinator submits a registration carrying that site's `code`
- **THEN** the request is refused with HTTP 400
- **AND** no new `site` row is stored

### Requirement: The coordinator can manage a site from the Locations console

The system SHALL allow only an administrative account — `coordinator` or `management` — to update
a scoped site's human-readable `name`, to deactivate that site, or to reactivate a site it previously deactivated, through the Locations
console. The operation SHALL never change `code`, `created_at` or any historical record. A
deactivated site SHALL remain readable with its non-null `deactivated_at`, but SHALL not appear as
an active site column in the Locations console.

Reactivation SHALL set `deactivated_at` back to null and SHALL change nothing else. It SHALL NOT
restore the `organization_location_id` values that the deactivation cleared: the site's physical
locations SHALL come back unmapped, and mapping them again SHALL be the separate mapping operation.
Reactivation SHALL be refused for a site that is already active and for a site outside the session's
scope, and it SHALL NOT grant scope over any site.

#### Scenario: A coordinator renames a site

- **WHEN** a coordinator submits a valid new `name` for a scoped site
- **THEN** the request succeeds with the site's `id`, unchanged `code`, new `name` and current
  `deactivated_at`

#### Scenario: An inspector cannot manage a site

- **WHEN** an `inspector` submits a site rename or deactivation
- **THEN** the request is refused with HTTP 403
- **AND** the site row is unchanged

#### Scenario: A coordinator cannot change a site code

- **WHEN** a coordinator submits a site-management request containing a different `code`
- **THEN** the request is refused with HTTP 400
- **AND** the stored `code` is unchanged

#### Scenario: Removing a site retains the site row

- **WHEN** a coordinator removes an active site
- **THEN** the request succeeds
- **AND** the site's `deactivated_at` is set
- **AND** the site remains readable for historical references

#### Scenario: Removing a site unlinks its physical locations

- **GIVEN** a site has `location` rows whose `site_id` is that site's id and whose
  `organization_location_id` is non-null
- **WHEN** a coordinator removes the site
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

- **WHEN** a coordinator removes a site whose `deactivated_at` is already non-null
- **THEN** the request is refused with HTTP 400
- **AND** no location mapping is changed

#### Scenario: A coordinator reactivates a removed site

- **GIVEN** a scoped site whose `deactivated_at` is non-null
- **WHEN** a coordinator reactivates it
- **THEN** the request succeeds with the site's `id`, unchanged `code`, unchanged `name` and a null
  `deactivated_at`
- **AND** the site appears again as an active site column in the Locations console

#### Scenario: Reactivation does not restore the cleared location mappings

- **GIVEN** a site was removed while its `location` rows carried non-null
  `organization_location_id` values
- **WHEN** a coordinator reactivates that site
- **THEN** every `location` row of that site still carries a null `organization_location_id`
- **AND** each of those locations is offered as an unmapped row in the Locations console

#### Scenario: An active site cannot be reactivated

- **WHEN** a coordinator reactivates a site whose `deactivated_at` is already null
- **THEN** the request is refused with HTTP 400
- **AND** the site row is unchanged

#### Scenario: A site outside the scope cannot be reactivated

- **WHEN** a coordinator reactivates a site that is not in the session's site scope
- **THEN** the request is refused with HTTP 404
- **AND** the site row is unchanged

#### Scenario: Reactivation preserves the site's identity and history

- **GIVEN** a site that was renamed and then removed
- **WHEN** a coordinator reactivates it
- **THEN** its `code` and `created_at` are unchanged
- **AND** every record that referenced the site while it was removed still resolves to it

### Requirement: Registering a site records it in the audit chain

The system SHALL write a `site.created` entry to `audit_log` for every `site` registered, from the
database engine rather than from the service, so that any write path that registers a site is
recorded. The entry SHALL carry the registering account as its actor, and its `site_id` SHALL be
the identifier of the site just registered. The entry SHALL be written on the new site's own chain
and on no other site's chain.

#### Scenario: The registration is recorded on the new site's chain

- **WHEN** a coordinator registers a site
- **THEN** an `audit_log` entry whose `event_type` is `site.created` exists
- **AND** its `site_id` is the identifier of the registered site
- **AND** its `actor_user_id` is the registering account
- **AND** its payload carries the registered `code` and `name`

#### Scenario: The other plants record nothing about the new one

- **WHEN** a coordinator scoped to St. Thomas and Glencoe registers a site
- **THEN** no `site.created` entry is written on the St. Thomas chain
- **AND** no `site.created` entry is written on the Glencoe chain

#### Scenario: A seeded site is recorded the same way

- **WHEN** a `site` row is inserted by the migration role rather than by the application
- **THEN** a `site.created` entry is written for it
- **AND** its `actor_user_id` is null, because no account is behind a seed

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

- **WHEN** an account whose role is `inspector` lists the sites
- **THEN** the sites of its own scope are returned

### Requirement: The coordinator adds catalogue entries from the console

The system SHALL let an administrative account — `coordinator` or `management` — create both kinds of catalogue entry without a
deployment: an `organization_location`, which carries no site, and a `location`, which
belongs to one. Seeding SHALL remain a valid and sufficient way to load the catalogue, and
neither path SHALL produce an entry the other could not have produced.

The site of a new `location` SHALL travel in the request path and never in the request
body. It names which of the requester's plants the entry belongs to; it is a selection
within scope and not the isolation boundary, which stays with the row-level security policy
on `location`. A site outside the requester's scope SHALL therefore be refused by the
engine rather than by a check in the endpoint.

A new `location` SHALL be created unmapped. Recording that a plant has a place and
declaring which shared location it represents are two acts, and a creation that did both
would force the coordinator to decide the second before knowing the first.

Every creation SHALL be restricted to an administrative account, and a collision SHALL name the
field to change: a repeated code and a repeated active name are two different constraints
and two different corrections.

#### Scenario: A shared location is created without a site

- **WHEN** the coordinator creates an `organization_location` with a `code` and a `name`
- **THEN** the entry is created and carries no site
- **AND** it is offered as a section destination to every plant

#### Scenario: A plant location is created unmapped

- **WHEN** the coordinator creates a `location` in one of their plants
- **THEN** the entry belongs to that site
- **AND** its `organization_location_id` is null until it is mapped

#### Scenario: The same code in both plants is two entries

- **WHEN** a `location` with code `shipping-dock` is created in each of two sites
- **THEN** both are created
- **AND** they are distinct rows, each belonging to its own site

#### Scenario: A site outside the requester's scope is refused by the engine

- **GIVEN** a coordinator whose scope covers only St. Thomas
- **WHEN** they create a `location` naming Glencoe
- **THEN** the row-level security policy on `location` rejects the insert
- **AND** the refusal does not depend on any site comparison in the endpoint

#### Scenario: A collision names the field to change

- **WHEN** a `location` is created with a `code` already used in that site
- **THEN** the refusal names the code
- **WHEN** a `location` is created with a `name` already used by an active location of that
  site
- **THEN** the refusal names the name

#### Scenario: Only an administrative account can add

- **WHEN** an account whose role is `inspector` creates either kind of entry
- **THEN** the request is refused

### Requirement: The coordinator can retire a shared organization location

The system SHALL allow only an administrative account — `coordinator` or `management` — to retire an active
`organization_location` by setting its `deactivated_at` timestamp. The operation SHALL accept
only the deactivation command and SHALL never delete the row or provide reactivation through the
console operation.

#### Scenario: A coordinator retires an active shared location

- **WHEN** a coordinator submits the deactivation command for an active
  `organization_location`
- **THEN** the system sets that row's `deactivated_at` to a non-null timestamp
- **AND** the `organization_location` row remains stored

#### Scenario: An inspector cannot retire a shared location

- **WHEN** an `inspector` submits the deactivation command for an active `organization_location`
- **THEN** the request is refused with HTTP 403
- **AND** the `organization_location.deactivated_at` value is unchanged

#### Scenario: Retiring an already retired shared location is not idempotent

- **WHEN** a coordinator submits the deactivation command for an
  `organization_location` whose `deactivated_at` is already non-null
- **THEN** the system refuses the request with HTTP 404
- **AND** the existing `deactivated_at` value is unchanged

### Requirement: Retiring a shared location retires its in-scope physical locations

The system SHALL, in the same transaction as retiring an `organization_location`, set
`location.deactivated_at` for every active physical `location` row with that
`organization_location_id` visible in the requester's site scope. The operation SHALL be atomic
for the shared row and the physical rows.

#### Scenario: A two-site coordinator retires both physical mappings

- **GIVEN** an active `organization_location` mapped by active physical `location` rows in St.
  Thomas and Glencoe
- **WHEN** a coordinator whose scope covers both sites retires the `organization_location`
- **THEN** the shared row and both physical `location` rows have non-null `deactivated_at`
- **AND** the shared location is absent from active organization-location reads
- **AND** both physical locations are absent from active location reads

#### Scenario: A single-site coordinator retires only visible physical mappings

- **GIVEN** an active `organization_location` mapped by active physical `location` rows in St.
  Thomas and Glencoe
- **AND** a coordinator whose scope covers St. Thomas only retires the
  `organization_location`
- **THEN** the shared row is deactivated for the organization
- **AND** the St. Thomas physical `location` is deactivated
- **AND** the Glencoe physical `location` remains active and is visible as an orphan to an
  appropriately scoped catalogue read

#### Scenario: A failed physical update does not leave a partial retirement

- **WHEN** the physical-location cascade cannot complete after the shared row update starts
- **THEN** the transaction rolls back
- **AND** the `organization_location.deactivated_at` value remains null
- **AND** no affected `location.deactivated_at` value is changed
