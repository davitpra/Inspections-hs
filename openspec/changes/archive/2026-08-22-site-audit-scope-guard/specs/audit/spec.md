## MODIFIED Requirements

### Requirement: Site lifecycle and physical-location unlinking are audited by the database

The system SHALL record site renames, site deactivations, site reactivations and physical-location
unlinks as chained `audit_log` entries written by the database in the same transaction as the
corresponding change. The entries SHALL use the acting account declared by the transaction, and
SHALL use a null `actor_user_id` when no account is declared, as with seed or migration activity.
A committed change without its audit entry MUST be an impossible state.

The site lifecycle event types SHALL be `site.renamed`, `site.deactivated` and `site.reactivated`.
A `site.reactivated` entry SHALL be written when and only when a site's `deactivated_at` goes from
non-null to null, and SHALL carry the site's `id`, `code` and `name`. Each physical location
mapping removed during site deactivation SHALL produce one `location.unlinked` entry on the
deactivated site's chain. The unlink payload SHALL carry the `location` identifier and the previous
`organization_location_id`.

Renaming, deactivating or reactivating a site SHALL require that the transaction has declared that
site in its site scope, and SHALL be refused otherwise with an error naming the site and the
missing declaration, before any audit entry is attempted. Writing about a site the transaction
never claimed is what the isolation exists to catch, and the refusal SHALL NOT arrive as a
row-level security error on `audit_log`, which names neither the site nor what is missing.

Registering a site SHALL be the one exception, and SHALL work with no declared scope: a site that
is being created cannot be in any scope yet, and a seeded site is still recorded. The system SHALL
in that case declare the new site in addition to whatever the transaction had already declared,
and SHALL NOT replace it, so that a statement registering several sites leaves all of them
declared rather than only the last.

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

#### Scenario: Deactivating a site the transaction never declared is refused

- **GIVEN** an active site
- **WHEN** its `deactivated_at` is set in a transaction that has declared no site scope
- **THEN** the statement fails with an error naming that site
- **AND** the error is not a row-level security refusal on `audit_log`
- **AND** the site's `deactivated_at` is still null when read back
- **AND** no `site.deactivated` entry exists on its chain

#### Scenario: Renaming a site the transaction never declared is refused

- **GIVEN** a site named `Console A`
- **WHEN** its `name` is updated in a transaction that has declared a different site
- **THEN** the statement fails with an error naming the site being renamed
- **AND** the stored `name` is unchanged

#### Scenario: Registering a site needs no declared scope

- **WHEN** a `site` row is inserted in a transaction that has declared no site scope
- **THEN** the insert succeeds
- **AND** a `site.created` entry exists on the new site's chain

#### Scenario: Registering several sites at once declares all of them

- **WHEN** one statement inserts two `site` rows in a transaction that has declared no site scope
- **THEN** a `site.created` entry exists on each of the two chains
- **AND** the transaction's declared scope names both sites afterwards

#### Scenario: Registering a site keeps the scope the transaction already had

- **GIVEN** a transaction that has declared one site
- **WHEN** it inserts a second `site` row
- **THEN** its declared scope afterwards names both the site it had declared and the new one

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
