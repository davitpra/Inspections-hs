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

### Requirement: An audit entry names a real account or nobody

The system SHALL enforce that `audit_log.actor_user_id` references an existing `app_user` row.
Until the account table existed the column was an unconstrained `uuid` by order of construction;
from now on an entry SHALL NOT be recorded against an account that does not exist. The column
SHALL remain nullable, because seeds, migrations and database-side events have no user behind
them, and an entry SHALL NOT be attributable to a shared or generic account.

#### Scenario: An entry for an unknown account is rejected

- **WHEN** an `audit_log` row is inserted with an `actor_user_id` that matches no `app_user` row
- **THEN** the insert fails with a foreign key violation

#### Scenario: An entry for a real account is accepted and chained

- **WHEN** an `audit_log` row is inserted with the `actor_user_id` of a seeded account
- **THEN** the insert succeeds
- **AND** the entry carries a non-null `hash`, as every chained entry does

#### Scenario: A system event has no actor

- **WHEN** a seed or a migration produces an audit entry
- **THEN** the entry's `actor_user_id` is null and the entry is chained normally

#### Scenario: An account with audit entries cannot be removed

- **WHEN** any role attempts to delete an `app_user` row that has `audit_log` entries
- **THEN** the attempt fails and both the account and its entries are still present when read back

#### Scenario: A deactivated account still resolves as an actor

- **WHEN** `deactivated_at` is set on an account that wrote audit entries
- **THEN** those entries still resolve the account, its role and the person behind it

### Requirement: Roster changes are audited by the database, not by the caller

The system SHALL record an audit entry for every creation, rename, transfer, deactivation and
reactivation of a `person`, written by the database as part of the same transaction as the change
itself. A committed roster change with no corresponding audit entry MUST be an impossible state,
and producing the entry SHALL NOT depend on the endpoint or the importer remembering to write it.

Each entry SHALL carry the `site_id` of the person, an `event_type` naming the operation, and a
`payload` containing the person's identifier and `employee_number` together with the values that
changed. A transfer SHALL be recorded in the chains of both the site left and the site joined,
because each workplace's record must show who its people are.

#### Scenario: Creating a person writes an entry

- **WHEN** a `person` is inserted for a site
- **THEN** an `audit_log` entry exists with that person's `site_id` and an `event_type`
  identifying a roster creation
- **AND** its `payload` contains the person's identifier and `employee_number`

#### Scenario: Renaming a person writes an entry carrying both names

- **WHEN** a `person` row's `last_name` is updated
- **THEN** an `audit_log` entry exists with an `event_type` identifying a rename
- **AND** its `payload` contains both the previous and the new name

#### Scenario: A transfer is recorded in both sites

- **WHEN** a person's `site_id` is updated from `st-thomas` to `glencoe`
- **THEN** an `audit_log` entry exists in the chain of `st-thomas` and another in the chain of
  `glencoe`
- **AND** both payloads name the site left and the site joined

#### Scenario: Deactivating and reactivating are distinct events

- **WHEN** `deactivated_at` is set on a `person` row and later set back to null
- **THEN** two further `audit_log` entries exist for that person
- **AND** their `event_type` values distinguish the deactivation from the reactivation

#### Scenario: An import writes one entry per applied row

- **WHEN** an import applies 197 rows, of which 12 create a person and 185 change one
- **THEN** 197 roster audit entries exist for that transaction
- **AND** they carry the `actor_user_id` of the account that ran the import

#### Scenario: A rolled-back roster change leaves no entry

- **WHEN** a transaction changes a person and is then rolled back
- **THEN** no `audit_log` entry for that change exists

### Requirement: Account and scope changes are audited in the chain of every site they reach

The system SHALL record an audit entry for the creation of an account, for a change of its `role`
or its `email`, for its deactivation and reactivation, and for every grant and revocation of a
site scope, written by the database in the same transaction as the change.

Because an account is not itself a site-scoped record while every audit entry belongs to exactly
one site, an account event SHALL be written once into the chain of each site in the account's
effective scope, and a scope event SHALL be written into the chain of the site being granted or
revoked. "Who was given access to this workplace, and when" is part of that workplace's record.

#### Scenario: Creating an account with two sites writes an entry in each chain

- **WHEN** an account is created with an active scope of both sites
- **THEN** one `audit_log` entry identifying the account creation exists in the chain of
  `st-thomas` and one in the chain of `glencoe`
- **AND** both payloads carry the account identifier, the `person_id` and the `role`

#### Scenario: A role change is recorded with both roles

- **WHEN** an account's `role` is changed from `supervisor` to `hs_coordinator`
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `role`

#### Scenario: An email change is recorded with both values

- **WHEN** an account's `email` is updated
- **THEN** an entry exists in the chain of every site in the account's scope
- **AND** its `payload` contains the previous and the new `email`

#### Scenario: A scope grant is recorded in the site being granted

- **WHEN** an account is granted the site `glencoe`
- **THEN** an `audit_log` entry identifying the grant exists in the chain of `glencoe`
- **AND** no entry for that grant exists in the chain of `st-thomas`

#### Scenario: A scope revocation is recorded in the site being revoked

- **WHEN** `revoked_at` is set on an account's scope row for `glencoe`
- **THEN** an `audit_log` entry identifying the revocation exists in the chain of `glencoe`

#### Scenario: Deactivating an account is recorded in every site it reached

- **WHEN** `deactivated_at` is set on an account whose active scope is both sites
- **THEN** an entry identifying the deactivation exists in both chains

#### Scenario: An account with an empty scope writes no account entry

- **WHEN** an account is created with no active scope row
- **THEN** the creation succeeds
- **AND** no `audit_log` entry is written for it, because it reaches no workplace

### Requirement: A roster import is auditable as one operation per site

The system SHALL record, for each site whose roster an import touched, one audit entry naming the
import, the source file and the counts of rows read, applied and rejected for that site, in
addition to the per-person entries the import produces. The entry SHALL carry the
`actor_user_id` of the account that ran the import.

#### Scenario: An import touching both sites writes one summary entry per site

- **WHEN** an import applies rows for people of both `st-thomas` and `glencoe`
- **THEN** one import summary entry exists in each site's chain
- **AND** each carries the source file name and the counts for that site

#### Scenario: An import touching one site writes one summary entry

- **WHEN** an import applies rows for people of `st-thomas` only
- **THEN** exactly one import summary entry exists, in the chain of `st-thomas`

#### Scenario: The summary entry names the acting account

- **WHEN** an import is run by an `hs_coordinator` account
- **THEN** every entry it produced carries that account's identifier as `actor_user_id`

### Requirement: Authentication events are recorded in the chain

The system SHALL record an audit entry for every invitation issued, revoked or accepted, every
credential created or revoked, every second factor enrolled or reset, every sign-in, every
sign-out and every session revocation. The entry SHALL carry an `event_type` naming the event, the
`actor_user_id` of the account the event is about, and a `payload` describing it.

Each of these events SHALL be recorded in the chain of every site in the account's effective
scope, by the same rule that already governs account and scope changes: an account is not a fact
of one workplace, and an event about it has to be visible from either chain.

#### Scenario: A sign-in is recorded in both chains of a two-site account

- **WHEN** an account whose active `user_site_scope` rows name both sites signs in
- **THEN** one `audit_log` entry naming the sign-in exists in the chain of `st-thomas`
- **AND** one exists in the chain of `glencoe`

#### Scenario: A sign-in is recorded once for a single-site account

- **WHEN** an account granted only `st-thomas` signs in
- **THEN** exactly one `audit_log` entry naming the sign-in exists, in the chain of `st-thomas`

#### Scenario: An invitation is recorded with who issued it

- **WHEN** an `hs_coordinator` session issues an invitation for another account
- **THEN** an `audit_log` entry exists whose `payload` names the invited `user_id` and whose
  `actor_user_id` is the coordinator's account

#### Scenario: Accepting an invitation is recorded

- **WHEN** an invitation is accepted and a credential is created
- **THEN** an `audit_log` entry naming the credential creation exists for every site in the
  account's scope

#### Scenario: Enrolling and resetting a second factor are recorded

- **WHEN** an account enrols a second factor, and a coordinator later resets it
- **THEN** two `audit_log` entries exist, one naming the enrolment and one naming the reset
- **AND** the reset entry's `actor_user_id` is the coordinator's account

#### Scenario: A sign-out and a revocation are recorded

- **WHEN** an account signs out, and a coordinator later revokes the sessions of a third account
- **THEN** an entry exists for each, naming the account whose session ended

#### Scenario: A rolled back sign-in leaves no entry

- **WHEN** a sign-in transaction is rolled back
- **THEN** no `audit_log` entry for that sign-in exists

### Requirement: A failed sign-in is recorded without recording the secret

The system SHALL record an audit entry for a failed sign-in against an existing account, in the
chain of every site in that account's scope, carrying the reason category — wrong password,
invalid second-factor code, inactive account, or locked by repeated failures. The entry SHALL NOT
contain the submitted password, the second-factor code, or any value derived from either.

A failed sign-in against an email that matches no account SHALL NOT produce an audit entry,
because there is no site to chain it to and no account to attribute it to, and a mistyped address
written into an immutable record cannot be taken back. Such attempts SHALL still be counted for
the lock-out threshold.

#### Scenario: A wrong password against a real account is recorded

- **WHEN** a sign-in is attempted with a known `app_user.email` and a wrong password
- **THEN** an `audit_log` entry naming the failure and its reason category exists for every site
  in that account's scope

#### Scenario: The submitted secret is not in the payload

- **WHEN** a failed sign-in entry is read back
- **THEN** its `payload` contains no password, no password hash and no second-factor code

#### Scenario: An unknown email produces no entry

- **WHEN** a sign-in is attempted with an email matching no `app_user` row
- **THEN** no `audit_log` entry is written
- **AND** the attempt is still counted towards the lock-out threshold

#### Scenario: A lock-out is recorded

- **WHEN** an account reaches the consecutive-failure threshold
- **THEN** an `audit_log` entry naming the lock-out exists for every site in its scope

### Requirement: The reads of an external auditor are recorded, and only those

The system SHALL record an audit entry for every read performed by a session whose account `role`
is `external_auditor`, carrying the `site_id` of the records reached, the auditor's
`actor_user_id`, an `event_type` naming an auditor read, and a `payload` identifying what was read
— the kind of record and the identifiers returned — together with the record window the session
was bounded by.

This SHALL be the only case in which a read produces an audit entry. No read by any other role
SHALL produce one.

#### Scenario: An auditor read is recorded

- **WHEN** an `external_auditor` session reads a collection of records of `st-thomas`
- **THEN** an `audit_log` entry exists in the chain of `st-thomas` whose `actor_user_id` is the
  auditor's account and whose `payload` identifies the records returned

#### Scenario: A read that returns nothing is still recorded

- **WHEN** an `external_auditor` session performs a read that returns no record
- **THEN** an `audit_log` entry still exists, recording that the read happened and returned
  nothing

#### Scenario: An auditor read spanning two sites is recorded in both chains

- **WHEN** an `external_auditor` session whose scope is both sites performs one read that returns
  records of both
- **THEN** an entry exists in the chain of each site, each naming the records of that site

#### Scenario: A coordinator's read is not recorded

- **WHEN** an `hs_coordinator` session reads the same records
- **THEN** no `audit_log` entry is written for that read

#### Scenario: A member's read is not recorded

- **WHEN** a `jhsc_member` session reads its site's records
- **THEN** no `audit_log` entry is written for that read

#### Scenario: The auditor cannot read without leaving the entry

- **WHEN** an `external_auditor` session's read succeeds
- **AND** the transaction that produced it is inspected
- **THEN** the entry was written in the same transaction as the read, and a committed read with no
  entry is not a reachable state

#### Scenario: The recorded window matches the account

- **WHEN** an auditor read entry is read back
- **THEN** its `payload` carries the `records_from` and `records_to` of the account at the time of
  the read
