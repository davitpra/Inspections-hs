## ADDED Requirements

### Requirement: An audit entry belongs to a registered site

The system SHALL enforce that `audit_log.site_id` references an existing `site` row. Until the
site catalogue existed the column was an unconstrained `uuid` by order of construction; from now
on an entry SHALL NOT be recorded against a site that does not exist, because an entry nobody can
attribute to a workplace cannot support the regulatory record it exists to protect.

#### Scenario: An entry for an unknown site is rejected

- **WHEN** an `audit_log` row is inserted with a `site_id` that matches no `site` row
- **THEN** the insert fails with a foreign key violation

#### Scenario: An entry for a registered site is accepted and chained

- **WHEN** an `audit_log` row is inserted with the `site_id` of a seeded site
- **THEN** the insert succeeds
- **AND** the entry carries a non-null `hash`, as every chained entry does

#### Scenario: A site with audit entries cannot be removed

- **WHEN** any role attempts to delete a `site` row that has `audit_log` entries
- **THEN** the attempt fails and both the site and its entries are still present when read back

### Requirement: Catalogue changes are audited by the database, not by the caller

The system SHALL record an audit entry for every creation, rename, deactivation and reactivation
of a `location`, written by the database as part of the same transaction as the change itself. A
committed catalogue change with no corresponding audit entry MUST be an impossible state, and
producing the entry SHALL NOT depend on the endpoint remembering to write it.

Each entry SHALL carry the `site_id` of the location, an `event_type` naming the operation, and a
`payload` containing the location's identifier and code together with the values that changed.
The acting user SHALL be taken from the scope declared by the transaction and SHALL be null when
the change is made by a seed or a migration, which have no user behind them.

#### Scenario: Creating a location writes an entry

- **WHEN** a `location` is inserted for a site
- **THEN** an `audit_log` entry exists with that location's `site_id` and an `event_type`
  identifying a location creation
- **AND** its `payload` contains the location's identifier and `code`

#### Scenario: Renaming a location writes an entry carrying both names

- **WHEN** a `location` row's `name` is updated from `Packaging line 3` to `Packaging line 3 (west)`
- **THEN** an `audit_log` entry exists with an `event_type` identifying a rename
- **AND** its `payload` contains both the previous and the new `name`

#### Scenario: Deactivating and reactivating are distinct events

- **WHEN** `deactivated_at` is set on a `location` row and later set back to null
- **THEN** two further `audit_log` entries exist for that location
- **AND** their `event_type` values distinguish the deactivation from the reactivation

#### Scenario: The entry names the acting user when the transaction declares one

- **WHEN** a transaction that declares an acting user renames a location
- **THEN** the resulting entry's `actor_user_id` is that user

#### Scenario: A seeded catalogue change has no acting user

- **WHEN** the seed command inserts the initial locations
- **THEN** the resulting entries have a null `actor_user_id`
- **AND** they are chained normally, with `prev_hash` linking each to the previous entry of the
  same site

#### Scenario: A failed catalogue change leaves no entry

- **WHEN** a transaction renames a location and is then rolled back
- **THEN** no `audit_log` entry for that rename exists
