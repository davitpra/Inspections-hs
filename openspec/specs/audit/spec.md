## Purpose

Records every consequential event as an append-only entry linked into a per-site SHA-256 hash
chain, so that tampering with the regulatory record is detectable rather than a matter of taking
the operator's word for it.

## Requirements

### Requirement: Audit entries are append-only

The system SHALL store audit entries in a table that is immutable under the rules of the
`immutability` capability: the application role may `INSERT` and `SELECT`, and no role may
`UPDATE` or `DELETE`.

#### Scenario: Entry survives an update attempt

- **WHEN** any role attempts to modify an existing `audit_log` row
- **THEN** the attempt fails and the stored `payload`, `prev_hash` and `hash` are unchanged

### Requirement: Audit entries carry author, site and full payload

The system SHALL record, for each entry, the site it belongs to (`site_id`), the acting user
(`actor_user_id`), the kind of event (`event_type`) and the complete event payload (`payload`)
as a JSON document.

#### Scenario: Entry is written with its full context

- **WHEN** an event is recorded with `site_id`, `actor_user_id`, `event_type` and `payload`
- **THEN** all four values are readable back unchanged from `audit_log`

#### Scenario: An entry without a payload is rejected

- **WHEN** an insert into `audit_log` omits `payload` or `event_type`
- **THEN** the insert fails with a not-null violation

### Requirement: Audit entries carry both a device and a server timestamp

The system SHALL store two distinct timestamps per entry: `occurred_at`, supplied by the client
and describing when the event happened on the device, and `recorded_at`, assigned by the database
server when the row is written. `recorded_at` MUST NOT be settable by the caller, because it is
what establishes the ordering of the log.

#### Scenario: Server timestamp is assigned by the database

- **WHEN** a caller inserts an entry supplying a `recorded_at` far in the past
- **THEN** the stored `recorded_at` is the server's own transaction timestamp, not the supplied
  value

#### Scenario: Device timestamp is preserved verbatim

- **WHEN** a caller inserts an entry whose `occurred_at` is earlier than `recorded_at`, as
  happens when an offline capture syncs days later
- **THEN** the stored `occurred_at` is exactly the value supplied and the entry is accepted

### Requirement: Each entry is chained to the previous entry of its site

The system SHALL maintain one hash chain per site. Each entry SHALL store `prev_hash`, the
`hash` of the preceding entry of the same `site_id`, and `hash`, the SHA-256 digest computed
over `prev_hash` together with the entry's own recorded content. The first entry of a site has a
null `prev_hash`.

#### Scenario: First entry of a site opens the chain

- **WHEN** the first entry for a site is recorded
- **THEN** its `prev_hash` is null and its `hash` is non-null

#### Scenario: Successive entries link to their predecessor

- **WHEN** three entries are recorded for the same site
- **THEN** the second entry's `prev_hash` equals the first entry's `hash`
- **AND** the third entry's `prev_hash` equals the second entry's `hash`

#### Scenario: Chains of different sites are independent

- **WHEN** entries are recorded for site A and site B interleaved in time
- **THEN** site B's first entry has a null `prev_hash` even though site A already has entries
- **AND** no entry of site B references a `hash` belonging to site A

### Requirement: The chain is computed by the database, not by the caller

The system SHALL compute `prev_hash`, `hash` and the per-site sequence number inside the
database when the row is inserted, and SHALL ignore any value the caller supplies for them. A
chain the application can write is a chain the application can forge.

#### Scenario: Caller-supplied hash is overwritten

- **WHEN** a caller inserts an entry supplying an arbitrary `hash` and `prev_hash`
- **THEN** the stored values are the ones the database computed, not the ones supplied
- **AND** verification of the chain passes

### Requirement: Concurrent writes produce a single well-formed chain per site

The system SHALL serialize the assignment of chain links within a site, so that entries written
concurrently still form one unbroken sequence. Serialization MUST be per site: writes to one
site MUST NOT block writes to another.

#### Scenario: Concurrent inserts for one site do not fork the chain

- **WHEN** several entries for the same site are inserted concurrently from separate connections
- **THEN** every entry has a distinct sequence number, each `prev_hash` matches the `hash` of the
  entry immediately before it, and verification of the chain passes

### Requirement: Chain integrity is verifiable

The system SHALL provide a way to verify a site's chain end to end and report the first entry at
which it breaks, so that tampering is identified rather than merely suspected.

#### Scenario: Intact chain verifies clean

- **WHEN** verification runs over a site whose entries were all written normally
- **THEN** it reports no broken entries

#### Scenario: Out-of-band tampering is located

- **GIVEN** a site with several entries
- **WHEN** the stored `payload` of one entry is altered out of band — by a role holding
  privileges the application does not have, such as a restored backup or direct superuser access
- **AND** verification runs over that site
- **THEN** it reports that entry as the first broken link

#### Scenario: A removed entry is detected

- **GIVEN** a site with several entries
- **WHEN** an entry in the middle of the chain is removed out of band and verification runs
- **THEN** it reports the following entry as broken, because its `prev_hash` no longer matches
  its predecessor

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
