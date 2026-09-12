## MODIFIED Requirements

### Requirement: The HS coordinator can register a new site from the console

The system SHALL allow only an administrative account — `hs_coordinator` or `management` — to
register a new `site` from a `code` and a `name`.
The registered row SHALL carry the submitted `code`, the submitted `name`, a `created_at` timestamp
and a null `deactivated_at`. `code` SHALL satisfy the catalogue code pattern and SHALL be unique
across every site, active or not.

The registration operation SHALL NOT accept `deactivated_at` or `code` changes. Site name changes,
deactivation and reactivation SHALL be offered only by the separate site-management operation. The
 application SHALL NOT offer a physical removal operation, and the application role SHALL hold
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

#### Scenario: A JHSC member cannot register a site

- **WHEN** a `jhsc_member` submits a site registration
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
- **AND** site name changes, deactivation and reactivation are available only through site management

#### Scenario: A removed site is not registered again under its own code

- **GIVEN** a site whose `deactivated_at` is non-null
- **WHEN** an HS coordinator submits a registration carrying that site's `code`
- **THEN** the request is refused with HTTP 400
- **AND** no new `site` row is stored

### Requirement: The HS coordinator can manage a site from the Locations console

The system SHALL allow only an administrative account — `hs_coordinator` or `management` — to
update a scoped site's human-readable `name`, to
deactivate that site, or to reactivate a site it previously deactivated, through the Locations
console. The operation SHALL never change `code`, `created_at` or any historical record. A
deactivated site SHALL remain readable with its non-null `deactivated_at`, but SHALL not appear as
an active site column in the Locations console.

Reactivation SHALL set `deactivated_at` back to null and SHALL change nothing else. It SHALL NOT
restore the `organization_location_id` values that the deactivation cleared: the site's physical
locations SHALL come back unmapped, and mapping them again SHALL be the separate mapping operation.
Reactivation SHALL be refused for a site that is already active and for a site outside the session's
scope, and it SHALL NOT grant scope over any site.

#### Scenario: A coordinator renames a site

- **WHEN** an HS coordinator submits a valid new `name` for a scoped site
- **THEN** the request succeeds with the site's `id`, unchanged `code`, new `name` and current
  `deactivated_at`

#### Scenario: A JHSC member cannot manage a site

- **WHEN** a `jhsc_member` submits a site rename or deactivation
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

#### Scenario: A coordinator reactivates a removed site

- **GIVEN** a scoped site whose `deactivated_at` is non-null
- **WHEN** an HS coordinator reactivates it
- **THEN** the request succeeds with the site's `id`, unchanged `code`, unchanged `name` and a null
  `deactivated_at`
- **AND** the site appears again as an active site column in the Locations console

#### Scenario: Reactivation does not restore the cleared location mappings

- **GIVEN** a site was removed while its `location` rows carried non-null
  `organization_location_id` values
- **WHEN** an HS coordinator reactivates that site
- **THEN** every `location` row of that site still carries a null `organization_location_id`
- **AND** each of those locations is offered as an unmapped row in the Locations console

#### Scenario: An active site cannot be reactivated

- **WHEN** an HS coordinator reactivates a site whose `deactivated_at` is already null
- **THEN** the request is refused with HTTP 400
- **AND** the site row is unchanged

#### Scenario: A site outside the scope cannot be reactivated

- **WHEN** an HS coordinator reactivates a site that is not in the session's site scope
- **THEN** the request is refused with HTTP 404
- **AND** the site row is unchanged

#### Scenario: Reactivation preserves the site's identity and history

- **GIVEN** a site that was renamed and then removed
- **WHEN** an HS coordinator reactivates it
- **THEN** its `code` and `created_at` are unchanged
- **AND** every record that referenced the site while it was removed still resolves to it

### Requirement: The HS coordinator adds catalogue entries from the console

The system SHALL let the HS coordinator create both kinds of catalogue entry without a
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

Every creation SHALL be restricted to the HS coordinator, and a collision SHALL name the
field to change: a repeated code and a repeated active name are two different constraints
and two different corrections.

#### Scenario: A shared location is created without a site

- **WHEN** the HS coordinator creates an `organization_location` with a `code` and a `name`
- **THEN** the entry is created and carries no site
- **AND** it is offered as a section destination to every plant

#### Scenario: A plant location is created unmapped

- **WHEN** the HS coordinator creates a `location` in one of their plants
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

- **WHEN** an account whose role is `jhsc_member` creates either kind of entry
- **THEN** the request is refused

### Requirement: The HS coordinator can retire a shared organization location

The system SHALL allow only an administrative account — `hs_coordinator` or `management` — to
retire an active
`organization_location` by setting its `deactivated_at` timestamp. The operation SHALL accept
only the deactivation command and SHALL never delete the row or provide reactivation through the
console operation.

#### Scenario: A coordinator retires an active shared location

- **WHEN** an HS coordinator submits the deactivation command for an active
  `organization_location`
- **THEN** the system sets that row's `deactivated_at` to a non-null timestamp
- **AND** the `organization_location` row remains stored

#### Scenario: A JHSC member cannot retire a shared location

- **WHEN** a `jhsc_member` submits the deactivation command for an active `organization_location`
- **THEN** the request is refused with HTTP 403
- **AND** the `organization_location.deactivated_at` value is unchanged

#### Scenario: Retiring an already retired shared location is not idempotent

- **WHEN** an HS coordinator submits the deactivation command for an
  `organization_location` whose `deactivated_at` is already non-null
- **THEN** the system refuses the request with HTTP 404
- **AND** the existing `deactivated_at` value is unchanged

