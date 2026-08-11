## MODIFIED Requirements

### Requirement: Authentication events are recorded in the chain

The system SHALL record an audit entry for every invitation issued, revoked or accepted, every
credential created or revoked, every sign-in, every sign-out and every session revocation. The
entry SHALL carry an `event_type` naming the event, the `actor_user_id` of the account the event
is about, and a `payload` describing it.

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
