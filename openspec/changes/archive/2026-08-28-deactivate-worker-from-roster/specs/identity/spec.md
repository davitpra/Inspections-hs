## MODIFIED Requirements

### Requirement: The roster of a site is readable by the H&S coordinator

The system SHALL expose the roster of one site as a list of `person` rows carrying `id`,
`site_id`, `employee_number`, `first_name`, `last_name` and `deactivated_at`, ordered by
`last_name` then `first_name`. The site SHALL be named by the request, and the rows returned
SHALL be limited to the sites of the session's scope by the row-level security policy on
`person`, never by a filter written into the endpoint.

Each row SHALL also carry the account that references that person, or `null` when no
`app_user` row does. The account SHALL be reduced to what tells the coordinator whether this
person can reach the system, as what and through which work address: its `id`, its `role`,
whether it is active, whether it can already sign in and its `email`. It SHALL NOT carry the
account's scope, credential or any invitation token; reading the roster SHALL NOT become a
way to read the account table.

The listing SHALL be available only to an account whose `role` is `hs_coordinator`, and SHALL
be able to include people whose `deactivated_at` is non-null, which is what distinguishes it
from the subject selection list.

The system SHALL NOT expose any way to rename, transfer, reactivate or delete a single
`person` through this listing or any companion route. It SHALL expose only the constrained
deactivation of an active person with no account described separately below. Creating a
person that does not exist yet SHALL be available as its own act, and loading the file itself
SHALL remain available as a separate act that names no person and applies the whole file at
once.

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
- **THEN** no route accepts the `id` of one `person` to rename, transfer, reactivate or delete
  them
- **AND** a companion route accepts the `id` only to deactivate an active person with no
  account
- **AND** the other writes available over the roster remain the import of a whole CSV file
  and the creation of a person who does not exist yet

## ADDED Requirements

### Requirement: An active worker can be deactivated from the roster

The system SHALL allow an account whose `role` is `hs_coordinator` to deactivate an active
`person` with no active associated `app_user` by naming that person's `id`. This includes a
person with no account and one whose associated account is inactive. The operation SHALL set
`person.deactivated_at` to the server time and SHALL return the deactivated person. It SHALL
never delete the row.

The target SHALL be resolved under the session's site scope through the row-level security
policy. A person outside that scope SHALL be indistinguishable from a nonexistent person. The
system SHALL refuse a person who is already inactive or who has an active associated account,
without changing either row.

The roster interface SHALL offer this action only for an active row presented as `Worker`,
whose account is either `null` or inactive. It SHALL identify the action as destructive and
SHALL require explicit confirmation. After success,
the default active roster SHALL no longer include the person. The database SHALL record the
existing `person.deactivated` audit event in the same transaction.

#### Scenario: A coordinator deactivates an active worker in scope

- **WHEN** an `hs_coordinator` confirms deactivation of an active `person` in scope whose
  account is `null` or inactive
- **THEN** the person's `deactivated_at` is set to the server time
- **AND** the person row is returned with a non-null `deactivated_at`
- **AND** the default active roster no longer includes that person
- **AND** a `person.deactivated` audit event is recorded for the person's site

#### Scenario: A worker is never physically deleted

- **WHEN** a worker is deactivated from the roster
- **THEN** the `person` row remains present
- **AND** historical records can still resolve that person

#### Scenario: A person with an inactive account can be deactivated from the row

- **WHEN** a coordinator deactivates an active person referenced by an inactive `app_user` row
- **THEN** the person's `deactivated_at` is set
- **AND** the inactive account remains unchanged

#### Scenario: A person with an active account cannot be deactivated from the row

- **WHEN** a coordinator attempts to deactivate a person referenced by an active `app_user` row
- **THEN** the request is refused
- **AND** both `person.deactivated_at` and the account remain unchanged

#### Scenario: An inactive person cannot be deactivated again

- **WHEN** a coordinator attempts to deactivate a person whose `deactivated_at` is already
  non-null
- **THEN** the request is refused
- **AND** the original `deactivated_at` remains unchanged

#### Scenario: A person outside the site scope is not disclosed

- **WHEN** a coordinator names a person outside the session's site scope
- **THEN** the request returns the same not-found response used for a nonexistent person
- **AND** no person row is changed

#### Scenario: Other roles cannot deactivate a worker

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` attempts to deactivate an active worker in its site scope
- **THEN** the request is refused
- **AND** the person remains active
