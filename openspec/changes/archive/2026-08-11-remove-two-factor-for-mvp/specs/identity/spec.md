## REMOVED Requirements

### Requirement: A second factor is mandatory for the coordinator and for management

**Reason**: The requirement was implemented on the server and never on the client. The limited
session it mandates — issued to an `hs_coordinator` or `management` account with no confirmed
`app_two_factor` row, and accepted by no route other than enrolment — works exactly as specified,
but the enrolment route it points at has no interface in `apps/web` and never had one. The
practical effect was that the bootstrap coordinator, the first account of the system and the one
that creates every other account, could not use the system at all.

Completing the requirement costs an enrolment screen, a confirmation flow, a coordinator-driven
reset and the tests for all three, on a surface v1 did not ask for. The MVP drops the second
factor instead. This is a scope decision, not a security conclusion: if the second factor returns,
it returns with both halves and with its own proposal.

**Migration**: `app_two_factor` is dropped, with its partial unique index, its four immutability
and audit triggers, and the `hs_two_factor_audit()` function. `app_session.purpose` and its
`CHECK` constraint are dropped, so every resolved session is a full session. Any `audit_log`
entries already emitted for `two_factor.enrolled` or `two_factor.reset` are **kept**: they live in
another table, chained per site, and the chain is not rewritten because the product changed its
mind. Sign-in no longer accepts a `code`, and the error codes `two_factor_required` and
`two_factor_enrolment_required` leave the contract.

### Requirement: A second factor is reset by the coordinator, never by its holder

**Reason**: The requirement exists only to govern a second factor. With no second factor there is
nothing to reset, and `POST /auth/two-factor/reset` is removed along with the other two routes of
its group.

The property it protected — that an account cannot unilaterally weaken its own authentication,
and that only an `hs_coordinator` can act on another account's credentials — is **not lost**. It
survives in the requirements that govern credential revocation and session revocation, which are
unchanged and remain coordinator-only.

**Migration**: None for stored data beyond the `app_two_factor` drop already described. No account
loses any other credential: passwords, sessions and refresh tokens are untouched.

## MODIFIED Requirements

### Requirement: An access token is short-lived and is renewed by a refresh token

The system SHALL issue, on a successful sign-in, an access token valid for minutes and a refresh
token valid for at least the synchronisation window the platform tolerates, so that a device that
captured work offline can still renew its access when it reconnects. Presenting a valid refresh
token SHALL issue a new access token without asking for the password again.

An expired access token SHALL be answered with a distinguishable, retryable condition, separate
from the answer given to a token that names a revoked or deactivated account, so that a client can
tell "renew and retry" from "stop".

#### Scenario: An expired access token is renewed silently

- **WHEN** an access token has expired and its refresh token has not
- **THEN** presenting the refresh token issues a new access token
- **AND** the password is not requested

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

### Requirement: A session ends when the account loses the right to hold it

The system SHALL revoke every live `app_session` of an account when the account is deactivated,
when its `expires_at` passes, or when its credential is revoked. Revocation SHALL be expressed by
setting `app_session.revoked_at`, never by deleting the row, and a revoked session SHALL NOT be
renewable.

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
