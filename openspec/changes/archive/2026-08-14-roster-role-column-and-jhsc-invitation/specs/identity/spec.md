## MODIFIED Requirements

### Requirement: The roster of a site is readable by the H&S coordinator

The system SHALL expose the roster of one site as a list of `person` rows carrying `id`,
`site_id`, `employee_number`, `first_name`, `last_name` and `deactivated_at`, ordered by
`last_name` then `first_name`. The site SHALL be named by the request, and the rows returned
SHALL be limited to the sites of the session's scope by the row-level security policy on
`person`, never by a filter written into the endpoint.

Each row SHALL also carry the account that references that person, or `null` when no
`app_user` row does. The account SHALL be reduced to what tells the coordinator whether this
person can reach the system and as what: its `id`, its `role`, whether it is active, and
whether it can already sign in. It SHALL NOT carry the account's email, its scope, its
credential or any invitation token; reading the roster SHALL NOT become a way to read the
account table.

The listing SHALL be available only to an account whose `role` is `hs_coordinator`, and SHALL
be able to include people whose `deactivated_at` is non-null, which is what distinguishes it
from the subject selection list.

The system SHALL NOT expose any way to create, modify or delete a `person` through this
listing or any companion route: the roster is maintained by the CSV import, and reading it
SHALL NOT become a way to write it.

#### Scenario: The coordinator reads the roster of a site in scope

- **WHEN** an account whose `role` is `hs_coordinator` and whose scope contains `st-thomas`
  requests the roster of `st-thomas`
- **THEN** every `person` whose `site_id` is `st-thomas` is returned, ordered by `last_name`
  then `first_name`
- **AND** each row carries `employee_number`, `first_name`, `last_name` and `deactivated_at`

#### Scenario: Each site is read separately

- **WHEN** the same coordinator requests the roster of `glencoe`
- **THEN** the people of `glencoe` are returned
- **AND** no `person` whose `site_id` is `st-thomas` appears in the result

#### Scenario: A site outside the scope returns nothing, not an error

- **WHEN** a coordinator whose scope is `st-thomas` only requests the roster of `glencoe`
- **THEN** the result is an empty list and no error is raised
- **AND** no `person` of `glencoe` is disclosed, not even their `employee_number`

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` requests the roster of a site within its own scope
- **THEN** the request is refused
- **AND** no `person` row is returned

#### Scenario: Deactivated people can be listed, and are marked

- **WHEN** the coordinator requests the roster of a site including inactive people
- **THEN** the result contains the people whose `deactivated_at` is non-null, carrying that
  value
- **AND** requesting only the active people excludes them

#### Scenario: Listing a deactivated person does not return them to any selector

- **WHEN** a deactivated person appears in the roster listing
- **THEN** the subject selection list for their site still does not offer them

#### Scenario: A person who holds an account is returned with its role

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by an `app_user` row whose `role` is `jhsc_member`
- **THEN** that row carries an account whose `role` is `jhsc_member`

#### Scenario: A person without an account is returned with none

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by no `app_user` row
- **THEN** that row carries a null account
- **AND** no error is raised

#### Scenario: The roster does not disclose the account's email or scope

- **WHEN** the roster of a site is read
- **THEN** no account in the result carries an `email`, a site scope, a credential or an
  invitation token

#### Scenario: An account that cannot yet sign in is distinguishable from one that can

- **WHEN** the roster is read after an account has been created for a person and before its
  invitation has been accepted
- **THEN** that account is reported as unable to sign in
- **AND** once the invitation is accepted, the same account is reported as able to sign in

## ADDED Requirements

### Requirement: The H&S coordinator can create an account over HTTP

The system SHALL expose a request that creates an `app_user` row and its `user_site_scope`
rows for a person who already exists on the roster, available only to a session whose `role`
is `hs_coordinator`. It SHALL be refused for every other role, and refusing it SHALL create
neither the account nor any scope row.

The request SHALL name the person by `id`, the account's email, its role and the sites of its
scope. The account and its scope rows SHALL be created in a single transaction under the
declared audit actor, so that the audit entry for the new account exists in the chain of every
site in its scope or the account is not created at all.

Creating an account SHALL NOT create a person, SHALL NOT create a credential, and SHALL NOT
create an invitation: the account is born unable to sign in.

The request SHALL be refused when the person does not exist, when the person already holds an
account, when the email belongs to another account, or when a site of the requested scope is
outside the scope of the requesting coordinator.

#### Scenario: The coordinator creates an account for a person on the roster

- **WHEN** an `hs_coordinator` whose scope contains `st-thomas` requests an account for a
  person of `st-thomas` with a role and that site
- **THEN** an `app_user` row and one `user_site_scope` row are created
- **AND** an audit entry naming the new account exists in the chain of `st-thomas`
- **AND** the account cannot sign in

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `jhsc_member`, `supervisor`, `management` or
  `external_auditor` requests the creation of an account
- **THEN** the request is refused
- **AND** no `app_user` row is created

#### Scenario: A second account for the same person is refused

- **WHEN** an account is requested for a person that an `app_user` row already references
- **THEN** the request is refused with an error naming that cause
- **AND** the existing account is unchanged

#### Scenario: An email that belongs to another account is refused

- **WHEN** an account is requested with an email that another account already carries
- **THEN** the request is refused
- **AND** no `app_user` row is created

#### Scenario: A site outside the coordinator's own scope is refused

- **WHEN** an `hs_coordinator` whose scope is `st-thomas` only requests an account scoped to
  `glencoe`
- **THEN** the request is refused
- **AND** neither the account nor its scope row is created

#### Scenario: Creating an account creates no credential

- **WHEN** an account is created
- **THEN** no `app_credential` row exists for it
- **AND** signing in with any password is refused until an invitation is accepted

### Requirement: A person on the roster can be invited as a JHSC member in one act

The system SHALL let the H&S coordinator turn a person of the roster who holds no account
into an invited `jhsc_member` in a single act: the account is created with role
`jhsc_member`, scoped to the site whose roster is being read, and an invitation is issued for
it. The one-time invitation token SHALL be returned to the coordinator exactly once and SHALL
NOT be readable afterwards, which is the same rule the invitation already carries.

The act SHALL be atomic: the account, its scope and the invitation SHALL all exist or none of
them SHALL. A failure SHALL leave the person without an account, so that pressing the button
again is a valid retry and not a request the system refuses for a state it created itself.

Only `jhsc_member` SHALL be reachable this way. Every other role SHALL remain outside this act,
because the scope and the validity window they need are not expressible in it.

#### Scenario: Inviting a person without an account

- **WHEN** an `hs_coordinator` invites a person of `st-thomas` who holds no account
- **THEN** an account with role `jhsc_member` scoped to `st-thomas` is created for that person
- **AND** an invitation is issued for it and its one-time token is returned once
- **AND** reading the roster again reports that person as holding a `jhsc_member` account that
  cannot yet sign in

#### Scenario: Inviting a person who already holds an account is refused

- **WHEN** an `hs_coordinator` invites a person that an `app_user` row already references
- **THEN** the request is refused
- **AND** no second account and no invitation are created

#### Scenario: A failure leaves nothing behind

- **WHEN** the invitation cannot be issued while inviting a person who held no account
- **THEN** no `app_user`, no `user_site_scope` and no `user_invitation` row exists for that
  person
- **AND** inviting the same person again is accepted

#### Scenario: A retry after the response was lost is refused, naming the account

- **WHEN** the invitation succeeded but its response never reached the coordinator
- **AND** the same person is invited again
- **THEN** the request is refused because that person already holds an account
- **AND** no second account and no second invitation are created

#### Scenario: The token is shown once

- **WHEN** the invitation has been issued and its token returned
- **THEN** no later request returns that token again
