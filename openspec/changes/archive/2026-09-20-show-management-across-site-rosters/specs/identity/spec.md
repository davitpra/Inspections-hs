## MODIFIED Requirements

### Requirement: A person belongs to one site and is isolated by it

The system SHALL store a mandatory `person.site_id` referencing an existing `site`, and SHALL
restrict every read and write of `person` to the sites declared as the transaction's scope
through a row-level security policy rather than a `WHERE` clause in the endpoint. A transaction
that declares no scope SHALL see no person at all.

As the single exception, the system SHALL also let a transaction READ a person whose `site_id` is
outside its declared scope when that person is referenced by an `app_user` row whose `role` is
`management`, which is active (`deactivated_at IS NULL`), and which holds a `user_site_scope` row with a null
`revoked_at` for a site within the transaction's declared scope. This exception SHALL be expressed
as a row-level security policy that applies to `SELECT` only. It SHALL NOT allow the transaction to
update or lock that person: every write and every row lock over `person` SHALL remain restricted
to the person's own `site_id` being within the declared scope.

A transfer between workplaces SHALL be expressible by updating `person.site_id`, and SHALL be
subject to the same policy: a transaction can only move a person between sites that are both
within its declared scope.

#### Scenario: A person without a site is rejected

- **WHEN** a `person` row is inserted with a null `site_id`
- **THEN** the insert is rejected

#### Scenario: A single-site scope sees only its own roster

- **WHEN** a transaction declares a scope of `st-thomas` only
- **THEN** selecting from `person` returns only people whose `site_id` is `st-thomas`
- **AND** the people of `glencoe` are absent from the result, except those covered by the
  management exception

#### Scenario: A two-site scope sees both rosters

- **WHEN** a transaction declares a scope of both sites, as the coordinator's scope does
- **THEN** selecting from `person` returns the people of both sites

#### Scenario: No declared scope means no rows

- **WHEN** a transaction selects from `person` without declaring any scope
- **THEN** the result is empty, and no error is raised

#### Scenario: The isolation applies to the owner role as well

- **WHEN** the migration role — which owns the table — selects from `person` in a transaction
  declaring a scope of `st-thomas` only
- **THEN** the people of `glencoe` are absent from the result, except those covered by the
  management exception

#### Scenario: A transfer within the declared scope is accepted

- **WHEN** a transaction declaring a scope of both sites updates a person's `site_id` from
  `st-thomas` to `glencoe`
- **THEN** the statement succeeds and the person appears in the roster of `glencoe`

#### Scenario: A transfer out of the declared scope is rejected

- **WHEN** a transaction declaring a scope of `st-thomas` only updates a person's `site_id` to
  `glencoe`
- **THEN** the update is rejected by the row-level security policy

#### Scenario: A management person with scope over the site is readable from it

- **GIVEN** a person whose `site_id` is `st-thomas`, referenced by an active `app_user` whose
  `role` is `management` and who holds an unrevoked `user_site_scope` row for `glencoe`
- **WHEN** a transaction declaring a scope of `glencoe` only selects from `person`
- **THEN** that person is returned, carrying `site_id` `st-thomas`
- **AND** no other person of `st-thomas` is returned

#### Scenario: A management person from another site cannot be written or locked

- **GIVEN** the same management person and a transaction declaring a scope of `glencoe` only
- **WHEN** the transaction updates that person, or selects them `FOR UPDATE` or `FOR KEY SHARE`
- **THEN** no row is updated or locked

#### Scenario: The exception follows the role, the account and the scope

- **WHEN** the account of that person is deactivated, or its `glencoe` scope row is revoked, or
  its `role` is anything other than `management`
- **THEN** a transaction declaring a scope of `glencoe` only no longer sees that person

### Requirement: The roster of a site is readable by the coordinator

The system SHALL expose the roster of one site as a list of `person` rows carrying `id`,
`site_id`, `employee_number`, `first_name`, `last_name` and `deactivated_at`, ordered by
`last_name` then `first_name`. The site SHALL be named by the request, and the rows returned
SHALL be limited to the sites of the session's scope by the row-level security policy on
`person`, never by a filter written into the endpoint.

The roster of a site SHALL contain the people whose `site_id` is that site, and SHALL also contain
every person whose account has `role` `management`, is active, and holds an unrevoked
`user_site_scope` row for that site, whatever that person's own `site_id` is. Such a row SHALL carry
the person's real `site_id`, so that a reader can tell that the person is based at another site. A
site that is not within the session's scope SHALL return an empty list.

Each row SHALL also carry the account that references that person, or `null` when no
`app_user` row does. The account SHALL be reduced to what tells the coordinator whether this
person can reach the system, as what and through which work address: its `id`, its `role`,
whether it is active, whether it can already sign in and its `email`. It SHALL NOT carry the
account's scope, credential or any invitation token; reading the roster SHALL NOT become a
way to read the account table.

The listing SHALL be available only to an account whose `role` is `coordinator`, and SHALL
be able to include people whose `deactivated_at` is non-null, which is what distinguishes it
from the subject selection list.

The system SHALL NOT expose any way to transfer, reactivate or delete a single `person` through
this listing or any companion route. It SHALL expose only two writes on a single existing person,
each described separately below: the constrained deactivation of an active person with no active
account, and the correction of the name and employee number of an active person. Creating a person
that does not exist yet SHALL be available as its own act, and loading the file itself SHALL remain
available as a separate act that names no person and applies the whole file at once.

The People console SHALL present a row whose `site_id` differs from the selected site as read-only:
it SHALL offer no row action, and it SHALL name the site the person is based at.

#### Scenario: The coordinator reads the roster of a site in scope

- **WHEN** an account whose `role` is `coordinator` and whose scope contains `st-thomas`
  requests the roster of `st-thomas`
- **THEN** every `person` whose `site_id` is `st-thomas` is returned, ordered by `last_name`
  then `first_name`
- **AND** each row carries `employee_number`, `first_name`, `last_name` and `deactivated_at`

#### Scenario: Each site is read separately

- **WHEN** the same coordinator requests the roster of `glencoe`
- **THEN** the people of `glencoe` are returned
- **AND** no `person` whose `site_id` is `st-thomas` appears in the result, except those whose
  active `management` account holds unrevoked scope over `glencoe`

#### Scenario: A management account with scope over the site is listed there

- **GIVEN** a person whose `site_id` is `st-thomas`, whose active account has `role` `management`
  and holds unrevoked scope over both `st-thomas` and `glencoe`
- **WHEN** a coordinator whose scope is `glencoe` only requests the roster of `glencoe`
- **THEN** that person is returned with `site_id` `st-thomas` and an account whose `role` is
  `management`
- **AND** the same person is returned once, not twice, in the roster of `st-thomas`

#### Scenario: A management account without scope over the site is not listed there

- **WHEN** the scope row of that account for `glencoe` is revoked
- **AND** the roster of `glencoe` is requested
- **THEN** that person is absent from the result

#### Scenario: A management person based elsewhere is read-only in the console

- **WHEN** the People console shows the roster of `glencoe`
- **AND** one of its rows carries `site_id` `st-thomas`
- **THEN** that row offers no actions menu
- **AND** it states that the person is based at St. Thomas

#### Scenario: A site outside the scope returns nothing, not an error

- **WHEN** a coordinator whose scope is `st-thomas` only requests the roster of `glencoe`
- **THEN** the result is an empty list and no error is raised
- **AND** no `person` of `glencoe` is disclosed, not even their `employee_number`

#### Scenario: An inspector is refused

- **WHEN** an account whose `role` is `inspector` requests the roster of a site within its own scope
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
- **AND** one of its people is referenced by an `app_user` row whose `role` is `inspector`
- **THEN** that row carries an account whose `role` is `inspector`

#### Scenario: A person without an account is returned with none

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by no `app_user` row
- **THEN** that row carries a null account
- **AND** no error is raised

#### Scenario: The roster carries the work email but not account security data

- **WHEN** the roster of a site is read
- **THEN** an account in the result carries its `email`
- **AND** no account carries a site scope, a credential or an invitation token

#### Scenario: An account that cannot yet sign in is distinguishable from one that can

- **WHEN** the roster is read after an account has been created for a person and before its
  invitation has been accepted
- **THEN** that account is reported as unable to sign in
- **AND** once the invitation is accepted, the same account is reported as able to sign in

#### Scenario: The listing offers only constrained single-person deactivation

- **WHEN** the roster of a site is read
- **THEN** no route accepts the `id` of one `person` to rename, transfer, reactivate or delete them
- **AND** a companion route accepts the `id` only to deactivate an active person with no account
- **AND** the other writes available over the roster remain the import of a whole CSV file and the
  creation of a person who does not exist yet

#### Scenario: The listing offers only constrained single-person writes

- **WHEN** the roster of a site is read
- **THEN** no route accepts the `id` of one `person` to transfer, reactivate or delete them
- **AND** a companion route accepts the `id` only to deactivate an active person with no active
  account, or to correct the `first_name`, `last_name` and `employee_number` of an active person
- **AND** the other writes available over the roster remain the import of a whole CSV file and the
  creation of a person who does not exist yet
