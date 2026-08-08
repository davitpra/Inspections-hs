## ADDED Requirements

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
