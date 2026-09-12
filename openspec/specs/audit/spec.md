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
The promotion of a `jhsc_member` to `hs_coordinator` SHALL be recorded as the role change it is, and
SHALL be the only role change the system produces.

Because an account is not itself a site-scoped record while every audit entry belongs to exactly
one site, an account event SHALL be written once into the chain of each site in the account's
effective scope, and a scope event SHALL be written into the chain of the site being granted or
revoked. "Who was given access to this workplace, and when" is part of that workplace's record.

#### Scenario: Creating an account with two sites writes an entry in each chain

- **WHEN** an account is created with an active scope of both sites
- **THEN** one `audit_log` entry identifying the account creation exists in the chain of
  `st-thomas` and one in the chain of `glencoe`
- **AND** both payloads carry the account identifier, the `person_id` and the `role`

#### Scenario: A promotion is recorded with both roles

- **WHEN** an account's `role` is changed from `jhsc_member` to `hs_coordinator`
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
credential created or revoked, every sign-in, every sign-out and every session revocation. The entry SHALL carry an `event_type` naming the event, the
`actor_user_id` of the account the event is about, and a `payload` describing it.

Each of these events SHALL be recorded in the chain of every site in the account's effective
scope, by the same rule that already governs account and scope changes: an account is not a fact
of one workplace, and an event about it has to be visible from either chain.

Entries already recorded for events this system no longer produces SHALL remain readable and
SHALL remain part of the chain. Removing the ability to produce an event SHALL NOT remove the
record that it once occurred.

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

#### Scenario: A sign-out and a revocation are recorded

- **WHEN** an account signs out, and a coordinator later revokes the sessions of a third account
- **THEN** an entry exists for each, naming the account whose session ended

#### Scenario: A rolled back sign-in leaves no entry

- **WHEN** a sign-in transaction is rolled back
- **THEN** no `audit_log` entry for that sign-in exists

#### Scenario: An entry for a withdrawn event type survives its removal

- **GIVEN** an `audit_log` entry recorded before the second factor was removed from the platform
- **WHEN** the chain of its site is read and verified
- **THEN** the entry is still present and the chain still verifies

### Requirement: A failed sign-in is recorded without recording the secret

The system SHALL record an audit entry for a failed sign-in against an existing account, in the
chain of every site in that account's scope, carrying the reason category — wrong password,
inactive account, or locked by repeated failures. The entry SHALL NOT contain the submitted
password or any value derived from it.

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
- **THEN** its `payload` contains no password and no password hash

#### Scenario: An unknown email produces no entry

- **WHEN** a sign-in is attempted with an email matching no `app_user` row
- **THEN** no `audit_log` entry is written
- **AND** the attempt is still counted towards the lock-out threshold

#### Scenario: A lock-out is recorded

- **WHEN** an account reaches the consecutive-failure threshold
- **THEN** an `audit_log` entry naming the lock-out exists for every site in its scope

### Requirement: An accepted submission is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `inspection.submitted` for every
`inspection` row that is created, written by a database trigger rather than by application code,
in the same transaction as the insert. Its `payload` SHALL name `inspection_id`,
`scheduled_inspection_id`, `site_id`, `template_version_id`, `client_submission_id`,
`submitted_by` and `answer_count`. Its `occurred_at` SHALL be the `signed_at` reported by the
device and its `recorded_at` SHALL be the server clock, so that an inspection captured offline
days earlier is not recorded as having happened when the network returned.

#### Scenario: Accepting a submission appends one entry

- **WHEN** a submission is accepted
- **THEN** one new `audit_log` entry exists for the inspection's site with `event_type`
  `inspection.submitted`
- **AND** its `payload` names the created `inspection_id` and its `client_submission_id`
- **AND** its `actor_user_id` is the account that submitted

#### Scenario: The entry keeps the device clock apart from the server clock

- **GIVEN** a submission signed on the device at `2026-08-03T14:20:00-04:00` and received on
  2026-08-09
- **WHEN** it is accepted
- **THEN** the entry's `occurred_at` is `2026-08-03T14:20:00-04:00`
- **AND** its `recorded_at` is the server time of the accepting transaction

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** an `inspection` row is inserted directly, without going through the endpoint
- **THEN** the `inspection.submitted` entry is still appended

### Requirement: Answers add no entries of their own

The system SHALL NOT write an audit entry per answer. One inspection of two hundred items SHALL
add one link to the chain of its site, not two hundred. The answers themselves are already
protected: they live in a table no role can modify.

#### Scenario: An inspection with many answers adds one link

- **GIVEN** a site whose chain has `seq` `120` as its last entry
- **WHEN** a submission with 200 answers is accepted
- **THEN** the last entry of that site's chain is `seq` `121`
- **AND** it is the `inspection.submitted` entry of that inspection

### Requirement: A replayed submission adds no link to the chain

The system SHALL NOT append an audit entry when a submission is recognised as a replay of an
already accepted `client_submission_id`. The chain records what happened, and nothing happened.

#### Scenario: Replaying leaves the chain unchanged

- **GIVEN** a submission already accepted, whose site's chain ends at `seq` `121`
- **WHEN** the identical payload is posted five more times, each returning `created` `false`
- **THEN** the site's chain still ends at `seq` `121`
- **AND** the chain verifies as intact

### Requirement: A rejected submission leaves no entry

The system SHALL leave the chain untouched when a submission is rejected for any reason —
validation, a version mismatch, an inspection already submitted, or an account that is not the
assigned inspector. The audit log records accepted records, and a rejected submission produced
none.

#### Scenario: A validation failure appends nothing

- **GIVEN** a site whose chain ends at `seq` `121`
- **WHEN** a submission missing a required answer is rejected
- **THEN** the site's chain still ends at `seq` `121`

#### Scenario: The chain still verifies after a run of rejections

- **WHEN** twenty invalid submissions are rejected in a row
- **THEN** verifying the site's chain reports no broken link

### Requirement: A derived finding is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `finding.derived` for every
`finding` row created with origin `inspection`, written by a database trigger rather than by
application code, in the same transaction as the insert. Its `payload` SHALL name `finding_id`,
`inspection_id`, `site_id`, `template_version_item_id`, `item_key`, `location_id` and the number
of photos. Its `occurred_at` SHALL be the `signed_at` reported by the device and its `recorded_at`
SHALL be the server clock, so that a finding captured offline days earlier is not recorded as
having happened when the network returned.

#### Scenario: Each derived finding appends one entry

- **WHEN** a submission with 3 negative answers is accepted
- **THEN** 3 new `audit_log` entries of type `finding.derived` exist for that site, one per
  finding
- **AND** each `payload` names its `finding_id` and its `item_key`

#### Scenario: The entry keeps the device clock apart from the server clock

- **GIVEN** a submission signed on the device at `2026-08-03T14:20:00-04:00` and received on
  2026-08-09
- **WHEN** it is accepted
- **THEN** each `finding.derived` entry carries `occurred_at` `2026-08-03T14:20:00-04:00`
- **AND** its `recorded_at` is the server time of the accepting transaction

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** a `finding` row with origin `inspection` is inserted directly, without going through
  the endpoint
- **THEN** the `finding.derived` entry is still appended

#### Scenario: A replayed submission adds no finding entry

- **GIVEN** a submission with negative answers already accepted
- **WHEN** the identical payload is posted again and returns `created` `false`
- **THEN** no new `finding.derived` entry is appended
- **AND** the site's chain verifies as intact

### Requirement: A manually reported finding is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `finding.reported` for every
`finding` row created with origin `manual`, written by the same trigger mechanism. Its `payload`
SHALL name `finding_id`, `site_id`, `location_id` and the number of photos, and SHALL state that
the finding has no `item_key`. Its `actor_user_id` SHALL be the account that reported it.

#### Scenario: Reporting a hazard appends one entry

- **WHEN** a management account reports a manual finding
- **THEN** one `audit_log` entry of type `finding.reported` exists for that site
- **AND** its `actor_user_id` is the management account
- **AND** its `payload` reports a null `item_key`

#### Scenario: Photos of a finding add no entries of their own

- **WHEN** a finding with four photos is created
- **THEN** the site's chain gains one link for the finding, not five

### Requirement: Every classification and reclassification is recorded in the chain

The system SHALL append one `audit_log` entry of type `finding.classified` per
`finding_risk_assessment` row inserted. Its `payload` SHALL name `finding_id`,
`assessment_id`, `probability`, `severity`, the engine-computed `risk_level`, `control_level`,
`supersedes_id` and `reason`, so that the chain records what the risk was said to be, by whom and
why it changed.

#### Scenario: Classifying appends one entry

- **WHEN** the coordinator classifies a finding as `possible` × `moderate` with `control_level`
  `engineering`
- **THEN** one `finding.classified` entry is appended for that site
- **AND** its `payload` carries `risk_level` `medium` and `control_level` `engineering`
- **AND** its `supersedes_id` and `reason` are null

#### Scenario: Reclassifying appends a second entry that names the reason

- **GIVEN** a finding already classified
- **WHEN** the coordinator reclassifies it with a reason
- **THEN** a second `finding.classified` entry is appended
- **AND** its `payload` names the superseded assessment and the reason given
- **AND** the first entry is unchanged

#### Scenario: A rejected classification leaves no entry

- **WHEN** a classification is rejected because the account is not the HS coordinator
- **THEN** the site's chain is unchanged

### Requirement: The creation of a corrective action is recorded in the chain by the database

The system SHALL append exactly one `audit_log` entry of type `action.created` for every
`corrective_action` row, written by a database trigger rather than by application code, in the
same transaction as the insert. Its `payload` SHALL name `action_id`, parent identifier and
`site_id`, and its `actor_user_id` SHALL identify the creator. The payload SHALL NOT include
provisional `assignee_person_id`, `description` or `due_at`, and replacing those fields before
closure SHALL NOT append audit entries.

#### Scenario: Creating an action appends one entry

- **WHEN** the HS coordinator creates a corrective action
- **THEN** one new `audit_log` entry of type `action.created` exists for that site
- **AND** its payload omits `assignee_person_id`, `description` and `due_at`

#### Scenario: An entry is written even when the insert bypasses the endpoint

- **WHEN** a `corrective_action` row is inserted directly, without going through the endpoint
- **THEN** the `action.created` entry is still appended
- **AND** the site's chain verifies as intact

### Requirement: Every transition of a corrective action is recorded in the chain

The system SHALL append one database-triggered `action.transitioned` entry for every
`corrective_action_event`. Every payload SHALL identify the transition and actor as before. When
`to_state` is `closed`, the same entry SHALL additionally include the final
`assignee_person_id`, `description` and `due_at` read from the action in that transaction. No
earlier transition SHALL include an assignment snapshot.

#### Scenario: An action that runs its full course leaves four entries

- **GIVEN** an action created, started, completed and closed
- **WHEN** the site's chain is read
- **THEN** four `action.transitioned` entries exist for it, with `to_state` `open`,
  `in_progress`, `awaiting_verification` and `closed` in that order
- **AND** the chain verifies as intact

#### Scenario: The closing entry names the verifier

- **WHEN** an action is closed by an account other than the one that completed it
- **THEN** the `action.transitioned` entry with `to_state` `closed` carries that verifier as
  `actor_user_id`

#### Scenario: Closure records the final assignment once

- **GIVEN** an action assignment changed while the action was active
- **WHEN** a verifier closes the action
- **THEN** the `action.transitioned` entry for `closed` contains the current `assignee_person_id`,
  `description` and `due_at`
- **AND** no audit entry contains an intermediate assignment version

#### Scenario: A refused verification records its reason

- **WHEN** a verifier refuses the work and the action returns to `in_progress`
- **THEN** the `action.transitioned` entry carries `from_state` `awaiting_verification`,
  `to_state` `in_progress` and the `reason` given

#### Scenario: A rejected transition leaves no entry

- **GIVEN** an action whose current state is `open`
- **WHEN** a transition to `closed` is rejected
- **THEN** no new `audit_log` entry exists for that site
- **AND** the chain verifies as intact

### Requirement: Evidence added to a corrective action is recorded in the chain

The system SHALL append one `audit_log` entry of type `action.evidence_added` for every
`corrective_action_evidence` row, naming `action_id`, `site_id`, `event_id`, `kind` and
`object_key`. The entry SHALL record the object key and SHALL NEVER carry the file's bytes.

#### Scenario: Completing with three files appends three entries

- **WHEN** the assignee declares the work done with one `before` and two `after` object keys
- **THEN** three `action.evidence_added` entries exist for that site
- **AND** each names its `kind` and its `object_key`

#### Scenario: The entry carries no image bytes

- **WHEN** an `action.evidence_added` entry is read back
- **THEN** its `payload` contains the `object_key` and no encoded file content

### Requirement: Every escalation of an overdue action is recorded in the chain

The system SHALL append exactly one `audit_log` entry of type `action.escalated` for every
`corrective_action_escalation` row, naming `action_id`, `site_id`, `level`, `due_at` and the
number of days the action was overdue when it escalated. Its `actor_user_id` SHALL be null,
because the escalation is the scheduler's act and not a person's, and the entry SHALL still be
linked into the site's chain like any other.

#### Scenario: Escalating to the coordinator appends one entry

- **GIVEN** an action overdue by four days
- **WHEN** the escalation job runs
- **THEN** one `audit_log` entry of type `action.escalated` exists with `level` `hs_coordinator`
- **AND** its `actor_user_id` is null

#### Scenario: Repeated runs append nothing further

- **GIVEN** an action already escalated to both levels
- **WHEN** the escalation job runs on each of the next ten days
- **THEN** no new `action.escalated` entry is appended
- **AND** the site's chain verifies as intact

#### Scenario: Both levels are distinguishable in the record

- **GIVEN** an action overdue by eight days that escalated to both levels
- **WHEN** its escalation entries are read
- **THEN** one carries `level` `hs_coordinator` and the other `level` `management`
- **AND** each names the `due_at` it passed and how many days late it was

### Requirement: A reported incident is recorded in the chain by the database

The system SHALL record an audit entry for every `incident` row, written by the database as part
of the same transaction that reports it. A committed incident with no corresponding audit entry
MUST be an impossible state, and producing the entry SHALL NOT depend on the endpoint remembering
to write it. The entry SHALL carry the incident's `site_id`, an `event_type` identifying a
reported incident, and a `payload` containing the incident's identifier, its `classification`, its
`form_version`, its `location_id`, its `occurred_at`, its `reported_at` and the number of
witnesses recorded. The payload SHALL NOT contain any narrative field nor the subject's name or
employee number: it SHALL identify the subject by `subject_person_id` alone, because the audit log
is read under a different visibility rule than the incident and the narrative MUST NOT reach it.
The acting user SHALL be taken from the scope declared by the transaction.

#### Scenario: Reporting an incident writes an entry

- **WHEN** a management account reports an incident
- **THEN** an `audit_log` entry exists with that incident's `site_id` and an `event_type`
  identifying a reported incident
- **AND** its `payload` contains the incident's identifier and `classification`
- **AND** its `actor_user_id` is the reporting account

#### Scenario: The entry carries no narrative

- **WHEN** the audit entry of a reported incident is read
- **THEN** its `payload` contains no value of `what_happened`, `task_performed`,
  `equipment_involved` or `immediate_action`
- **AND** it identifies the subject by `subject_person_id` and by nothing else

#### Scenario: A rejected report leaves no entry

- **WHEN** a report is rejected and the transaction rolls back
- **THEN** no `audit_log` entry for it exists

#### Scenario: Witnesses add no entries of their own

- **WHEN** an incident is reported naming three witnesses
- **THEN** exactly one entry is written for the report
- **AND** its `payload` states that three witnesses were recorded

### Requirement: Every transition of an incident is recorded in the chain

The system SHALL record an audit entry for every `incident_event` row, written by the database in
the same transaction as the transition. The entry SHALL carry the incident's `site_id`, an
`event_type` identifying an incident transition, and a `payload` containing the incident's
identifier, the event's `position`, its `from_state`, its `to_state` and its `reason` where the
transition demanded one. A reopening SHALL produce an entry like any other transition and SHALL
NOT be distinguishable from an edit, because there are no edits.

#### Scenario: Moving to investigation writes an entry

- **WHEN** the coordinator moves a reported incident to `under_investigation`
- **THEN** an entry exists whose `payload` carries `from_state` `reported` and `to_state`
  `under_investigation`
- **AND** its `actor_user_id` is the coordinator

#### Scenario: Closing writes an entry

- **WHEN** an incident is closed
- **THEN** an entry exists whose `payload` carries `to_state` `closed`

#### Scenario: Reopening writes an entry carrying its reason

- **WHEN** a closed incident is reopened
- **THEN** an entry exists whose `payload` carries `from_state` `closed`, `to_state`
  `under_investigation` and the stated reason

#### Scenario: A refused transition leaves no entry

- **WHEN** a transition is refused by the state machine guard, by the open-actions guard or by the
  mandatory-investigation guard
- **THEN** no `audit_log` entry for that attempt exists

### Requirement: Opening an investigation and recording a cause are recorded in the chain

The system SHALL record an audit entry for every `investigation` row and for every
`investigation_cause` row, written by the database in the same transaction as the insert. The
investigation entry SHALL carry the incident's `site_id`, an `event_type` identifying an opened
investigation, and a `payload` containing the investigation's identifier, its `incident_id` and
its `method`. The cause entry SHALL carry an `event_type` identifying a recorded cause and a
`payload` containing the investigation's identifier, the cause's `position` and its `is_root`
flag, and SHALL NOT contain the cause `statement`, for the same reason the narrative stays out of
the log.

#### Scenario: Opening an investigation writes an entry

- **WHEN** an investigation is opened with the method `five_whys`
- **THEN** an entry exists whose `payload` carries the `incident_id` and the method

#### Scenario: Each cause writes its own entry

- **WHEN** four causes are recorded, the last of them the root
- **THEN** four entries exist
- **AND** the entry of the last one states `is_root` true

#### Scenario: The cause statement stays out of the log

- **WHEN** the entry of a recorded cause is read
- **THEN** it carries no `statement`

#### Scenario: Every incident entry chains within its own site

- **WHEN** incidents are reported and advanced in both sites concurrently
- **THEN** each entry's `prev_hash` links it to the previous entry of the same site
- **AND** the chain of each site verifies

### Requirement: Inspection requirement archive changes are auditable

The system SHALL append `inspection_schedule.archived` when `inspection_schedule.archived_at`
changes from null to non-null and SHALL append `inspection_schedule.restored` when it changes
from non-null to null. Each event SHALL belong to the requirement's site chain and SHALL identify
the `inspection_schedule_id`, `site_id`, `template_id`, and resulting `archived_at`.

#### Scenario: Archiving appends an audit entry

- **WHEN** an inspection requirement's `archived_at` changes from null to non-null
- **THEN** an `inspection_schedule.archived` entry is appended to that site's audit chain
- **AND** its payload carries the resulting `archived_at`

#### Scenario: Restoring appends an audit entry

- **WHEN** an inspection requirement's `archived_at` changes from non-null to null
- **THEN** an `inspection_schedule.restored` entry is appended to that site's audit chain
- **AND** its payload carries a null `archived_at`

### Requirement: Advancing scheduled inspection visibility is audited

The system SHALL append one `inspection.visibility_advanced` entry when
`scheduled_inspection.visible_early` advances from `false` to `true`. The entry SHALL identify
the `scheduled_inspection_id`, `site_id`, `period_start`, `period_end`, `template_id`,
`template_version_id`, and the acting account resolved by the audit mechanism.

#### Scenario: Making a future period visible appends one audit entry

- **WHEN** an `hs_coordinator` advances `visible_early` from `false` to `true`
- **THEN** exactly one `inspection.visibility_advanced` entry is appended for that
  `scheduled_inspection_id`
- **AND** its actor is the requesting account

#### Scenario: A rejected visibility request is not audited

- **WHEN** an early-visibility request is rejected without changing `visible_early`
- **THEN** no `inspection.visibility_advanced` entry is appended
