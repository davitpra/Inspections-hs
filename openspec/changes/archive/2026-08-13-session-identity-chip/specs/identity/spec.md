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

A session SHALL also carry what identifies its holder to a reader, and not only what
authorises them. The session the system returns to a client SHALL carry `email`
(`app_user.email`), and SHALL carry `first_name` and `last_name` (`person.first_name`,
`person.last_name`) whenever the person behind the account is within the account's own site
scope. A device is shared between shifts and a submission is signed; without these the
holder cannot confirm whose draft is in front of them before signing it.

The name SHALL be best-effort and the email SHALL NOT. `person` is isolated by site, so an
account whose person belongs to a site outside its own scope resolves a session with no
name. Such a session SHALL still be issued and SHALL remain fully valid: being unable to
name the holder SHALL NOT prevent signing in.

`email`, `first_name` and `last_name` SHALL be optional in the session contract, so that a
session stored by a client before these fields existed still validates. A client that
cannot revalidate its stored session is a client that must ask for a new sign-in, and the
device that stored it may have no network with which to give one.

A client SHALL render the account's role using the closed vocabulary of the role set, never
the stored identifier.

#### Scenario: The session resolves all four values

- **WHEN** a request is made with a valid session token
- **THEN** the resolved context carries the account's `user_id`, the `person_id` of the person
  behind it, the account's `role`, and the `site_id` of every active `user_site_scope` row

#### Scenario: The session names its holder

- **WHEN** an account signs in, and the person behind it is within the account's site scope
- **THEN** the returned session carries the account's `email`
- **AND** it carries the person's `first_name` and `last_name`

#### Scenario: The name is resolved again when the session is re-read

- **WHEN** the current session is requested with a valid session token
- **THEN** it carries the same `email`, `first_name` and `last_name` as at sign-in

#### Scenario: A person outside the account's scope yields a session without a name

- **WHEN** an account signs in whose person belongs to a site outside the account's `site_scope`
- **THEN** the session is issued and is valid
- **AND** it carries the account's `email` and no `first_name` or `last_name`

#### Scenario: A session stored before the identity fields existed still validates

- **WHEN** a client revalidates a stored session that carries no `email`, `first_name` or
  `last_name`
- **THEN** the session is accepted
- **AND** the client is not asked to sign in again

#### Scenario: The role is displayed in the vocabulary of the role set

- **WHEN** a client displays the role of an account whose `role` is `jhsc_member`
- **THEN** it shows `JHSC member`
- **AND** it does not show the identifier `jhsc_member`

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
