## MODIFIED Requirements

### Requirement: A session carries the user, the person and the site scope

The system SHALL resolve every authenticated request into a session context carrying
`user_id` (`app_user.id`), `person_id` (`app_user.person_id`), `role` (`app_user.role`) and
`site_scope`, the list of `site_id` values of the account's `user_site_scope` rows whose
`revoked_at` is null.

`site_scope` SHALL be resolved from `user_site_scope` at each request and SHALL NOT be frozen into
the token, so that revoking a site takes effect on the next request rather than when the token
expires. `role` SHALL be resolved from `app_user` at each request and SHALL NOT be frozen into the
token either, so that a role changed by the coordinator takes effect on the next request; a role
carried in the token would keep a demoted account reading incidents until the token expired.

#### Scenario: The session resolves all four values

- **WHEN** a request is made with a valid session token
- **THEN** the resolved context carries the account's `user_id`, the `person_id` of the person
  behind it, the account's `role`, and the `site_id` of every active `user_site_scope` row

#### Scenario: A changed role takes effect on the next request

- **WHEN** an account's `role` is changed from `hs_coordinator` to `supervisor`
- **AND** the same unexpired session token is used for a subsequent request
- **THEN** the resolved `role` is `supervisor`

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

The system SHALL derive the `app.site_ids` of every transaction from the session's `site_scope`,
`app.user_id` from the session's `user_id` and `app.role` from the session's `role`. No route
SHALL accept a site, a scope, an acting user or a role as a parameter, a header or a body field,
and no route SHALL widen a transaction's scope or elevate its role beyond the account's effective
ones. The three session variables SHALL be set with transaction-local scope, so that a pooled
connection returned and handed to another request carries none of them.

#### Scenario: A site supplied by the caller is ignored

- **WHEN** a request carries a site identifier in its query, body or headers that is outside the
  session's `site_scope`
- **THEN** the transaction's `app.site_ids` is the session's `site_scope` unchanged
- **AND** no row of the supplied site is returned

#### Scenario: The acting user cannot be impersonated

- **WHEN** a request carries a user identifier that differs from the session's `user_id`
- **THEN** the transaction's `app.user_id` is the session's `user_id`
- **AND** any audit entry written by that request names the session's account

#### Scenario: A role supplied by the caller is ignored

- **WHEN** a request carries a role in its query, body or headers claiming `hs_coordinator` for a
  `supervisor` account
- **THEN** the transaction's `app.role` is `supervisor`
- **AND** no row the elevated role would have unlocked is returned

#### Scenario: The role does not survive the transaction

- **WHEN** a transaction that declared `app.role` completes and its connection is reused by a
  request that declares none
- **THEN** the second transaction reads no `app.role`
- **AND** it sees no row that depends on one

#### Scenario: A single-site member reaches only their own workplace

- **WHEN** a `jhsc_member` account granted only `st-thomas` reads a site-isolated table through an
  authenticated request
- **THEN** only rows of `st-thomas` are returned, and no route filtered by site to achieve it
