## MODIFIED Requirements

### Requirement: Site lifecycle and physical-location unlinking are audited by the database

The system SHALL record site renames, site deactivations, site reactivations and
physical-location unlinks as chained `audit_log` entries written by the database in the same
transaction as the corresponding change. The entries SHALL use the acting account declared by the
transaction, and SHALL use a null `actor_user_id` for seed or migration activity. A committed
change without its audit entry MUST be an impossible state.

The site lifecycle event types SHALL be `site.renamed`, `site.deactivated` and
`site.reactivated`. A `site.reactivated` entry SHALL be written when and only when a site's
`deactivated_at` goes from non-null to null, and SHALL carry the site's `id`, `code` and `name`.
Each physical location mapping removed during site deactivation SHALL produce one
`location.unlinked` entry on the deactivated site's chain. The unlink payload SHALL carry the
`location` identifier and the previous `organization_location_id`.

#### Scenario: Renaming a site writes both names

- **WHEN** a coordinator renames a site from `St. Thomas` to `St. Thomas Plant`
- **THEN** a `site.renamed` entry exists on that site's chain
- **AND** its payload contains the previous and new `name`
- **AND** its `actor_user_id` is the coordinator

#### Scenario: Deactivating a site writes a site event

- **WHEN** a coordinator deactivates a site
- **THEN** a `site.deactivated` entry exists on that site's chain
- **AND** its payload contains the site's `id`, `code` and deactivation timestamp
- **AND** its `actor_user_id` is the coordinator

#### Scenario: Reactivating a site writes a site event

- **GIVEN** a site whose `deactivated_at` is non-null
- **WHEN** a coordinator reactivates it
- **THEN** a `site.reactivated` entry exists on that site's chain, after its `site.deactivated`
  entry
- **AND** its payload contains the site's `id`, `code` and `name`
- **AND** its `actor_user_id` is the coordinator

#### Scenario: A site rename does not write a reactivation entry

- **GIVEN** an active site whose `deactivated_at` is null
- **WHEN** a coordinator renames it
- **THEN** no `site.reactivated` entry is written

#### Scenario: Unlinking a physical location writes an entry

- **GIVEN** a site has a `location` mapped to an `organization_location`
- **WHEN** the site is deactivated
- **THEN** a `location.unlinked` entry exists on that site's chain for that `location`
- **AND** its payload contains the `location` identifier and previous organization location id

#### Scenario: A failed site operation leaves no audit entries

- **WHEN** a site rename, deactivation or reactivation transaction rolls back
- **THEN** no lifecycle or unlink audit entry from that transaction exists

#### Scenario: A site operation does not write to another site's chain

- **GIVEN** an account can reach two sites
- **WHEN** the account renames, deactivates or reactivates one site
- **THEN** no corresponding lifecycle or unlink entry is written with the other site's `site_id`
