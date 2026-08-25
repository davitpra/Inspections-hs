## ADDED Requirements

### Requirement: A person can be added to the roster one at a time

The system SHALL allow an account whose `role` is `hs_coordinator` to create a single `person`
by naming its `employee_number`, `first_name`, `last_name` and the `site_id` it belongs to. The
created row SHALL be returned carrying the same six fields the roster listing returns, with
`deactivated_at` null: a person added by hand is active from the moment she exists.

The `site_id` SHALL be one of the sites in the session's scope, and the request SHALL be
refused when it is not. This SHALL be checked explicitly by the endpoint before the write, and
SHALL NOT be left to the row-level security policy alone: a write that violates the policy is a
failure of the engine, and a request that names a site the caller does not administer is a
failure of the request.

The `employee_number` SHALL remain globally unique, and a request naming one that already
exists SHALL be refused without creating, updating or reviving anything. The refusal SHALL NOT
disclose whether the existing person belongs to a site the caller administers, nor any of her
data — not her name, not her site, not whether she is active. The caller SHALL receive the same
answer in both cases.

Creating a person SHALL NOT create, revive or alter any `app_user`: adding someone to the
roster SHALL NOT be a way to grant access to the system.

The creation SHALL be recorded in the audit chain as the creation of that `person`, by the same
mechanism that records a person created by the CSV import.

#### Scenario: The coordinator adds a person to a site in scope

- **WHEN** an account whose `role` is `hs_coordinator` and whose scope contains `st-thomas`
  creates a person with an unused `employee_number` and `site_id` of `st-thomas`
- **THEN** the person is created with `deactivated_at` null
- **AND** the created row is returned carrying `id`, `site_id`, `employee_number`,
  `first_name`, `last_name` and `deactivated_at`
- **AND** reading the roster of `st-thomas` afterwards returns that person

#### Scenario: An employee number already in use is refused

- **WHEN** the coordinator creates a person whose `employee_number` already belongs to another
  person of a site within his own scope
- **THEN** the request is refused
- **AND** the existing person is neither renamed, moved, reactivated nor otherwise changed
- **AND** no second `person` row carrying that `employee_number` exists

#### Scenario: A collision outside the scope answers the same as one inside it

- **WHEN** a coordinator whose scope is `st-thomas` only creates a person whose
  `employee_number` already belongs to a person of `glencoe`
- **THEN** the request is refused with the same answer as a collision within `st-thomas`
- **AND** nothing about the existing person is disclosed: not her `first_name`, her
  `last_name`, her `site_id` nor her `deactivated_at`

#### Scenario: A site outside the scope is refused

- **WHEN** a coordinator whose scope is `st-thomas` only creates a person whose `site_id` is
  `glencoe`
- **THEN** the request is refused
- **AND** no `person` row is created

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` creates a person on a site within its own scope
- **THEN** the request is refused
- **AND** no `person` row is created

#### Scenario: Adding a person grants no access

- **WHEN** a person is added to the roster by hand
- **THEN** no `app_user` row references her
- **AND** the roster reports her account as null
- **AND** she cannot sign in until an account is created for her as a separate act

#### Scenario: A person added by hand is auditable as created

- **WHEN** a person is added to the roster by hand
- **THEN** the audit chain of that site records the creation of that `person`, the same way it
  records a person created by the CSV import

### Requirement: The CSV import takes precedence over a person added by hand

The system SHALL treat a person added by hand as a row the file has not delivered yet, never as
an exception to the file. When a later import carries the same `employee_number`, the imported
row SHALL be applied over the existing one — its `first_name`, `last_name`, `site_id` and
active status SHALL become those of the file — with no special case, no rejection and no
warning distinguishing it from any other row the import updates.

Adding a person by hand SHALL therefore only CREATE: it SHALL NOT be a second way to rename,
move or deactivate a person that already exists, whether that person was created by an import
or by hand.

#### Scenario: A later import overwrites a person added by hand

- **WHEN** a person is added by hand with `employee_number` `E-4417`
- **AND** a CSV is later imported carrying `E-4417` with a different `last_name` and a
  different `site_code`
- **THEN** that person carries the `last_name` and the site of the file
- **AND** the row counts as applied, not as rejected

#### Scenario: Adding by hand is not a way to correct an existing person

- **WHEN** the coordinator names the `employee_number` of a person who already exists
- **THEN** the request is refused
- **AND** the existing person keeps her `first_name`, `last_name`, `site_id` and
  `deactivated_at`

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

The system SHALL NOT expose any way to modify or delete a single `person` through this listing
or any companion route: a person that already exists is maintained by the CSV import, and
reading the roster SHALL NOT become a way to rename, move or deactivate someone row by row.
Creating a person that does not exist yet SHALL be available as its own act, and loading the
file itself SHALL remain available, as a separate act that names no person and applies the
whole file at once.

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

#### Scenario: The listing offers no way to change a single person

- **WHEN** the roster of a site is read
- **THEN** no route accepts the `id` of one `person` to rename, move or deactivate them
- **AND** the only writes available over the roster are the import of a whole CSV file and the
  creation of a person who does not exist yet
