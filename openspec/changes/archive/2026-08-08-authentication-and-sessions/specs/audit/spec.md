## ADDED Requirements

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
