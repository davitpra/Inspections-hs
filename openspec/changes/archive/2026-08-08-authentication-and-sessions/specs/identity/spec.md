## ADDED Requirements

### Requirement: An account gains the ability to sign in only through an invitation

The system SHALL create the credential of an account only from a `user_invitation` row issued by
an account whose `role` is `hs_coordinator`. There SHALL be no self-registration, no open sign-up
form and no path by which an `app_user` row acquires a credential without an invitation having
been issued for it and accepted.

An invitation SHALL carry `user_id`, `issued_by_user_id`, `issued_at`, `expires_at`, a nullable
`accepted_at` and a nullable `revoked_at`. It SHALL be issued only for an existing `app_user` row
that has no credential yet.

#### Scenario: The coordinator invites an account that has no credential

- **WHEN** an `hs_coordinator` session issues an invitation for an `app_user` row that has no
  `app_credential`
- **THEN** a `user_invitation` row is created carrying that `user_id` and the coordinator's
  `app_user.id` as `issued_by_user_id`

#### Scenario: A non-coordinator cannot invite

- **WHEN** a session whose account `role` is `jhsc_member`, `supervisor`, `management` or
  `external_auditor` issues an invitation
- **THEN** the request is rejected and no `user_invitation` row is created

#### Scenario: There is no self-registration path

- **WHEN** the deployed API surface is inspected
- **THEN** no unauthenticated route creates an `app_user` row or an `app_credential` row

#### Scenario: An invitation for an account that already signs in is rejected

- **WHEN** an invitation is issued for an `app_user` row that already has an `app_credential`
- **THEN** the request is rejected and no second `user_invitation` row is created for it

#### Scenario: A person with no account cannot be invited

- **WHEN** an invitation is issued naming a `person` row that no `app_user` references
- **THEN** the request is rejected, and creating the account remains a separate, explicit act

### Requirement: An invitation expires, is used once, and is revocable

The system SHALL reject an invitation whose `expires_at` has passed, whose `accepted_at` is
non-null, or whose `revoked_at` is non-null. Accepting an invitation SHALL set `accepted_at` and
SHALL be the moment the account's `app_credential` row is created. An invitation SHALL NOT be
deleted: it is revoked by setting `revoked_at`.

Accepting an invitation SHALL be the only way a password is set without presenting the current
one. A coordinator MAY revoke an unused invitation and issue a new one; that SHALL be the reset
path, and the system SHALL NOT offer self-service password recovery.

#### Scenario: An expired invitation is refused

- **WHEN** an invitation whose `expires_at` has passed is accepted with a password
- **THEN** the request is rejected and no `app_credential` row is created

#### Scenario: An invitation cannot be used twice

- **WHEN** an invitation with a non-null `accepted_at` is accepted again
- **THEN** the request is rejected and the existing `app_credential` is unchanged

#### Scenario: A revoked invitation is refused

- **WHEN** `revoked_at` is set on an invitation and it is then accepted
- **THEN** the request is rejected and no `app_credential` row is created

#### Scenario: Accepting an invitation creates the credential

- **WHEN** a valid invitation is accepted with a password
- **THEN** an `app_credential` row is created for that `user_id`
- **AND** the invitation's `accepted_at` is set

#### Scenario: An invitation is never deleted

- **WHEN** any role attempts to delete a `user_invitation` row
- **THEN** the attempt fails and the row is still present when read back

#### Scenario: A forgotten password is reset by the coordinator, not by the holder

- **WHEN** the holder of an account asks to recover access
- **THEN** no route sends a reset link or accepts a self-service reset
- **AND** the only path is a coordinator revoking the credential and issuing a new invitation

### Requirement: Sign-in is by email and password, and only an active account may sign in

The system SHALL authenticate an account by its `app_user.email` and the password verified
against `app_credential.password_hash`. The password SHALL be stored only as a hash produced by a
memory-hard function, SHALL never be stored in `app_user`, and SHALL never be returned by any
route.

The system SHALL refuse to establish a session for an account whose `deactivated_at` is non-null,
whose `expires_at` has passed, or that has no `app_credential` row. A refusal SHALL NOT reveal
which of those conditions applied, nor whether the email exists.

#### Scenario: An active account with a credential signs in

- **WHEN** an account whose `deactivated_at` is null presents its `email` and correct password
- **THEN** a session is established

#### Scenario: A deactivated account cannot sign in

- **WHEN** an account whose `deactivated_at` is non-null presents its correct password
- **THEN** no session is established

#### Scenario: An expired auditor cannot sign in

- **WHEN** an `external_auditor` account whose `expires_at` has passed presents its correct
  password
- **THEN** no session is established

#### Scenario: An account created by the roster or by a seed cannot sign in

- **WHEN** an `app_user` row with no `app_credential` presents any password
- **THEN** no session is established

#### Scenario: A wrong password and an unknown email are indistinguishable

- **WHEN** a sign-in is attempted with an unknown email
- **AND** a sign-in is attempted with a known email and a wrong password
- **THEN** both responses carry the same status and the same message

#### Scenario: No route returns the password hash

- **WHEN** any route that returns an account is called
- **THEN** the response contains no `password_hash`, salt or credential field

### Requirement: Repeated failed sign-ins lock the account temporarily

The system SHALL count consecutive failed sign-in attempts per account and SHALL refuse further
attempts for a cooling-off period once a threshold is reached, without deactivating the account
and without any row being deleted. A successful sign-in SHALL reset the counter.

#### Scenario: The threshold locks the account for a period

- **WHEN** the configured number of consecutive failed attempts is reached for an account
- **THEN** a subsequent attempt with the correct password is refused until the cooling-off period
  has passed

#### Scenario: The lock is temporary, not a deactivation

- **WHEN** an account is locked by failed attempts
- **THEN** its `app_user.deactivated_at` is unchanged and remains null

#### Scenario: A success clears the counter

- **WHEN** an account with failed attempts below the threshold signs in successfully
- **THEN** the consecutive-failure count is zero

### Requirement: A second factor is mandatory for the coordinator and for management

The system SHALL require a TOTP second factor for every account whose `role` is `hs_coordinator`
or `management`, and SHALL offer it as optional for `jhsc_member`, `supervisor` and
`external_auditor`. The secret SHALL be stored in `app_two_factor` and SHALL never be returned
after enrolment is confirmed.

An account for which the second factor is mandatory and which has no confirmed `app_two_factor`
row SHALL receive a session limited to enrolling it: that session SHALL NOT be accepted by any
other route.

#### Scenario: The coordinator cannot reach the system without a second factor

- **WHEN** an `hs_coordinator` account with no confirmed `app_two_factor` row signs in
- **AND** the resulting session is presented to any route other than second-factor enrolment
- **THEN** the request is rejected

#### Scenario: The coordinator enrols and then has a full session

- **WHEN** that account completes enrolment by returning a valid code for the issued secret
- **AND** signs in again presenting email, password and a valid code
- **THEN** a full session is established

#### Scenario: A member may sign in without a second factor

- **WHEN** a `jhsc_member` account with no `app_two_factor` row presents email and correct
  password
- **THEN** a full session is established

#### Scenario: A member may enrol a second factor by choice

- **WHEN** a `supervisor` account enrols a second factor
- **THEN** subsequent sign-ins for that account require a valid code

#### Scenario: A wrong code does not establish a session

- **WHEN** an account with a confirmed `app_two_factor` row presents email, correct password and
  an invalid code
- **THEN** no session is established

#### Scenario: Promotion to a role that requires a second factor takes effect at once

- **WHEN** an account's `role` is changed to `management` while it has no confirmed
  `app_two_factor` row
- **THEN** its existing sessions are no longer accepted by any route other than enrolment

#### Scenario: The secret is not readable after enrolment

- **WHEN** any route that returns an account or its session is called after enrolment
- **THEN** the response contains no TOTP secret and no recovery material

### Requirement: A second factor is reset by the coordinator, never by its holder

The system SHALL allow only an `hs_coordinator` session to reset another account's second factor,
by revoking the `app_two_factor` row so that the holder must enrol again. The holder SHALL NOT be
able to remove or replace their own second factor when their `role` requires one.

#### Scenario: The coordinator resets a lost second factor

- **WHEN** an `hs_coordinator` session resets the second factor of another account
- **THEN** that account's `app_two_factor` row is revoked and the account must enrol again

#### Scenario: A holder cannot remove a mandatory second factor

- **WHEN** a `management` account attempts to remove its own second factor
- **THEN** the request is rejected and the `app_two_factor` row is unchanged

#### Scenario: A second factor row is revoked, not deleted

- **WHEN** a second factor is reset
- **THEN** the previous `app_two_factor` row is still present with a non-null `revoked_at`

### Requirement: A session carries the user, the person and the site scope

The system SHALL resolve every authenticated request into a session context carrying
`user_id` (`app_user.id`), `person_id` (`app_user.person_id`) and `site_scope`, the list of
`site_id` values of the account's `user_site_scope` rows whose `revoked_at` is null.

`site_scope` SHALL be resolved from `user_site_scope` at each request and SHALL NOT be frozen into
the token, so that revoking a site takes effect on the next request rather than when the token
expires.

#### Scenario: The session resolves all three values

- **WHEN** a request is made with a valid session token
- **THEN** the resolved context carries the account's `user_id`, the `person_id` of the person
  behind it, and the `site_id` of every active `user_site_scope` row

#### Scenario: A revoked site leaves the scope on the next request

- **WHEN** `revoked_at` is set on an account's `user_site_scope` row for `glencoe`
- **AND** the same unexpired session token is used for a subsequent request
- **THEN** the resolved `site_scope` no longer contains `glencoe`

#### Scenario: A newly granted site enters the scope on the next request

- **WHEN** a `user_site_scope` row is granted to an account holding a live session
- **AND** the same session token is used for a subsequent request
- **THEN** the resolved `site_scope` contains the new site

#### Scenario: An account with no active scope resolves an empty scope

- **WHEN** a request is made by an account with no active `user_site_scope` row
- **THEN** the resolved `site_scope` is empty and the request is answered without error, seeing no
  site-isolated rows

### Requirement: The site scope of a request comes from the session, never from the request

The system SHALL derive the `app.site_ids` of every transaction from the session's `site_scope`
and `app.user_id` from the session's `user_id`. No route SHALL accept a site, a scope or an acting
user as a parameter, a header or a body field, and no route SHALL widen a transaction's scope
beyond the account's effective scope.

#### Scenario: A site supplied by the caller is ignored

- **WHEN** a request carries a site identifier in its query, body or headers that is outside the
  session's `site_scope`
- **THEN** the transaction's `app.site_ids` is the session's `site_scope` unchanged
- **AND** no row of the supplied site is returned

#### Scenario: The acting user cannot be impersonated

- **WHEN** a request carries a user identifier that differs from the session's `user_id`
- **THEN** the transaction's `app.user_id` is the session's `user_id`
- **AND** any audit entry written by that request names the session's account

#### Scenario: A single-site member reaches only their own workplace

- **WHEN** a `jhsc_member` account granted only `st-thomas` reads a site-isolated table through an
  authenticated request
- **THEN** only rows of `st-thomas` are returned, and no route filtered by site to achieve it

### Requirement: An access token is short-lived and is renewed by a refresh token

The system SHALL issue, on a successful sign-in, an access token valid for minutes and a refresh
token valid for at least the synchronisation window the platform tolerates, so that a device that
captured work offline can still renew its access when it reconnects. Presenting a valid refresh
token SHALL issue a new access token without asking for the password or the second factor again.

An expired access token SHALL be answered with a distinguishable, retryable condition, separate
from the answer given to a token that names a revoked or deactivated account, so that a client can
tell "renew and retry" from "stop".

#### Scenario: An expired access token is renewed silently

- **WHEN** an access token has expired and its refresh token has not
- **THEN** presenting the refresh token issues a new access token
- **AND** neither the password nor a second-factor code is requested

#### Scenario: An expired access token is reported as retryable

- **WHEN** a request is made with an expired access token
- **THEN** the response identifies the token as expired and the condition as renewable

#### Scenario: A revoked session is reported as final

- **WHEN** a request is made with a token whose `app_session` row has a non-null `revoked_at`
- **THEN** the response identifies the condition as not renewable
- **AND** presenting the refresh token does not issue a new access token

#### Scenario: A refresh token outlives a multi-day offline stretch

- **WHEN** a device signs in, goes without connectivity for the longest synchronisation window the
  platform tolerates, and then reconnects
- **THEN** its refresh token is still valid and yields a new access token

### Requirement: A refresh token rotates on use and reuse revokes the session

The system SHALL issue a new refresh token every time one is used and SHALL mark the presented one
as spent. Presenting a spent refresh token SHALL revoke the whole session chain it belongs to,
because a token used twice means a copy exists.

Rotation SHALL NOT delete a row: a spent token is marked, not removed.

#### Scenario: Each refresh yields a new refresh token

- **WHEN** a refresh token is used
- **THEN** the response carries a new refresh token
- **AND** the presented one is marked spent

#### Scenario: Reusing a spent refresh token kills the session

- **WHEN** a refresh token that has already been used is presented again
- **THEN** no access token is issued
- **AND** the `app_session` row and every token descended from it carry a non-null `revoked_at`

#### Scenario: A spent token is retained

- **WHEN** a refresh token is rotated
- **THEN** the previous token's row is still present, marked spent, and readable

### Requirement: A deferred submission is never discarded because its token expired

The system SHALL refresh the session silently when connectivity returns and before any queued
work is sent, and SHALL treat an authentication failure on a queued submission as a reason to
renew and retry, never as a reason to drop the queued entry.

A queued entry SHALL be discarded only by an explicit act of its author or by a successful,
acknowledged submission. Loss of authentication SHALL NOT be such an act.

#### Scenario: Connectivity returns and the session is renewed first

- **WHEN** a client that holds queued work regains connectivity
- **THEN** it renews its access token before sending the first queued entry

#### Scenario: A queued entry rejected for an expired token is retried, not dropped

- **WHEN** a queued submission is answered with the expired-token condition
- **THEN** the entry stays in the queue
- **AND** it is sent again after a successful renewal

#### Scenario: A queued entry survives a failed renewal

- **WHEN** renewal itself fails because the refresh token has also expired
- **THEN** the queued entries are still present and unsent
- **AND** the client asks its holder to sign in again rather than discarding them

#### Scenario: A queued entry is discarded only on acknowledgement

- **WHEN** a queued submission is acknowledged by the server
- **THEN** the entry leaves the queue
- **AND** no other authentication outcome removes an entry

### Requirement: A session ends when the account loses the right to hold it

The system SHALL revoke every live `app_session` of an account when the account is deactivated,
when its `expires_at` passes, when its credential is revoked, or when its second factor is reset.
Revocation SHALL be expressed by setting `app_session.revoked_at`, never by deleting the row, and
a revoked session SHALL NOT be renewable.

An account SHALL also be able to end its own sessions, and an `hs_coordinator` session SHALL be
able to end another account's.

#### Scenario: Deactivating an account ends its sessions

- **WHEN** `deactivated_at` is set on an account holding a live session
- **THEN** the next request with that session token is rejected
- **AND** the `app_session` row carries a non-null `revoked_at`

#### Scenario: An auditor's session ends when the account expires

- **WHEN** the current time passes an `external_auditor` account's `expires_at` while it holds a
  live session
- **THEN** the next request with that session token is rejected

#### Scenario: The holder signs out

- **WHEN** an account signs out
- **THEN** its `app_session` row carries a non-null `revoked_at` and the token is no longer
  accepted

#### Scenario: The coordinator ends another account's session

- **WHEN** an `hs_coordinator` session revokes the sessions of another account
- **THEN** that account's live sessions are revoked and its tokens are no longer accepted

#### Scenario: A session row is never deleted

- **WHEN** any role attempts to delete an `app_session` row
- **THEN** the attempt fails and the row is still present when read back

### Requirement: An external auditor's session is bounded by its record window

The system SHALL restrict what an `external_auditor` session can read to records whose date falls
within the account's `records_from` and `records_to`, in addition to its `site_scope`. An auditor
session SHALL be read-only: it SHALL NOT be accepted by any route that creates or changes a
record.

#### Scenario: Records outside the window are not returned

- **WHEN** an `external_auditor` session reads a collection that contains records dated before
  `records_from` or after `records_to`
- **THEN** those records are absent from the result

#### Scenario: Records inside the window are returned

- **WHEN** an `external_auditor` session reads a collection containing records dated within its
  window and inside its `site_scope`
- **THEN** those records are returned

#### Scenario: An auditor cannot write

- **WHEN** an `external_auditor` session is presented to any route that creates or modifies a
  record
- **THEN** the request is rejected and nothing is written

#### Scenario: The window does not widen the site scope

- **WHEN** an `external_auditor` session whose `site_scope` is `st-thomas` reads records dated
  within its window
- **THEN** no record of `glencoe` is returned

### Requirement: A credential belongs to exactly one account and is never shared

The system SHALL store at most one active `app_credential` row per `app_user`, and SHALL NOT
provide any credential that is not attached to an `app_user` row: no service account, no shared
login, no API key that authenticates as a generic operator. Every authenticated request SHALL
therefore resolve to one real person through `app_user.person_id`.

Revoking a credential SHALL be expressed by setting `revoked_at`, never by deleting the row.

#### Scenario: A second active credential for the same account is rejected

- **WHEN** a second `app_credential` row is inserted for an `app_user` that already has one whose
  `revoked_at` is null
- **THEN** the insert fails with a unique violation

#### Scenario: A credential without an account is rejected

- **WHEN** an `app_credential` row is inserted with a `user_id` matching no `app_user` row
- **THEN** the insert fails with a foreign key violation

#### Scenario: No shared or service credential exists

- **WHEN** the deployed credential store is inspected
- **THEN** every `app_credential` row resolves through `app_user.person_id` to a `person` row

#### Scenario: A credential is revoked, not deleted

- **WHEN** a credential is revoked and a new invitation is issued
- **THEN** the previous `app_credential` row is still present with a non-null `revoked_at`
- **AND** accepting the new invitation creates a second row, active

## REMOVED Requirements

### Requirement: An account carries no credentials in this capability

**Reason**: The requirement existed to declare the intermediate state that
`identity-and-roster-import` deliberately left behind — a complete identity that cannot yet sign
in — and this change is the one that lifts it. Its first half survives unchanged and is not lost:
no password, hash, token or second-factor secret is stored on `app_user`; they live in
`app_credential`, `app_session` and `app_two_factor`, keyed by `user_id`. Its second half —
"no sign-in path exists for it" — is now false by design and is replaced by
"An account gains the ability to sign in only through an invitation", which keeps the property
that mattered: an account is not able to sign in until a coordinator says so.

**Migration**: None for stored data. Accounts created before this change, including the bootstrap
coordinator, keep exactly the rows they have and remain unable to sign in until an invitation is
issued and accepted for them.
