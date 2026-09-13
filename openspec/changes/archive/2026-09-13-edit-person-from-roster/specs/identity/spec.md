## MODIFIED Requirements

### Requirement: A person is identified by employee number, not by name

The system SHALL store `person.employee_number` as the identity of a roster record: mandatory and
unique across the whole organisation. Names SHALL NOT be treated as identifying: two active people
MAY carry the same `first_name` and `last_name`.

The employee number SHALL be correctable, because a number mistyped when the person was added is
otherwise only fixable by splitting one person across two records. A correction SHALL keep the same
`person.id`, so every record already referencing that person keeps referencing her, and SHALL be an
audited event carrying the previous and the new number. `person.id` and `person.created_at` SHALL
remain assigned once and SHALL NOT be changeable by any role.

A corrected employee number SHALL NOT be remembered by the roster import: a later import that still
carries the previous number SHALL treat it as a number no person carries.

#### Scenario: A duplicate employee number is rejected

- **WHEN** a second `person` row is inserted with an `employee_number` that already exists
- **THEN** the insert fails with a unique violation

#### Scenario: The employee number can be corrected

- **WHEN** a session connected as the application role updates `person.employee_number` of an
  existing person to a value no other person carries
- **THEN** the statement succeeds and the new value is readable back
- **AND** the person's `id` is unchanged
- **AND** every record already referencing that person still resolves to her

#### Scenario: Correcting to a number already in use is rejected

- **WHEN** a session updates `person.employee_number` to a value another `person` already carries
- **THEN** the statement fails with a unique violation
- **AND** both people keep the `employee_number` they carried before

#### Scenario: The identifier of a person cannot be changed

- **WHEN** any role runs `UPDATE person SET id = <another value> WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `id` is unchanged when read back

#### Scenario: An import carrying the previous number does not find the corrected person

- **WHEN** a person's `employee_number` is corrected from `E-4471` to `E-4417`
- **AND** a CSV is later imported carrying `E-4471`
- **THEN** the import creates a new `person` with `employee_number` `E-4471`
- **AND** the corrected person keeps `employee_number` `E-4417`

#### Scenario: Two people may share a name

- **WHEN** two `person` rows are inserted with the same `first_name` and `last_name` and
  different `employee_number` values
- **THEN** both inserts succeed
- **AND** the selection list distinguishes them by `employee_number`

#### Scenario: A person's name can be corrected

- **WHEN** a session connected as the application role updates `person.first_name` or
  `person.last_name`
- **THEN** the statement succeeds and the new value is readable back
- **AND** every record already referencing that person resolves to the corrected name

### Requirement: The roster of a site is readable by the coordinator

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

The listing SHALL be available only to an account whose `role` is `coordinator`, and SHALL
be able to include people whose `deactivated_at` is non-null, which is what distinguishes it
from the subject selection list.

The system SHALL NOT expose any way to transfer, reactivate or delete a single `person` through
this listing or any companion route. It SHALL expose only two writes on a single existing person,
each described separately below: the constrained deactivation of an active person with no active
account, and the correction of the name and employee number of an active person. Creating a person
that does not exist yet SHALL be available as its own act, and loading the file itself SHALL remain
available as a separate act that names no person and applies the whole file at once.

#### Scenario: The coordinator reads the roster of a site in scope

- **WHEN** an account whose `role` is `coordinator` and whose scope contains `st-thomas`
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

## ADDED Requirements

### Requirement: An active person can be corrected from the roster

The system SHALL allow an account whose `role` is `coordinator` to correct the `first_name`,
`last_name` and `employee_number` of an active `person` by naming that person's `id` and at least
one of those fields. Each supplied value SHALL be non-empty once trimmed. The operation SHALL return
the corrected person. It SHALL NOT change the person's `id`, `site_id` or `deactivated_at`, nor the
account that references her.

The target SHALL be resolved under the session's site scope through the row-level security policy.
A person outside that scope SHALL be indistinguishable from a nonexistent person. The system SHALL
refuse a person whose `deactivated_at` is non-null, and SHALL refuse an `employee_number` that
another person already carries, leaving the person exactly as she was in both cases.

The database SHALL record `person.renamed` when a name changes and `person.renumbered` when the
employee number changes, in the same transaction. A request whose values equal the stored ones
SHALL succeed without writing any audit entry.

The roster interface SHALL offer this action on every active row, prefilled with the person's
current values. When, and only when, the person is referenced by an active account that cannot yet
sign in, the same dialog SHALL also offer to correct that account's `email`, under the rule that
already governs correcting the email of such an account, and SHALL NOT issue a new invitation by
doing so. For every other row the dialog SHALL NOT offer an email. After success the roster SHALL
show the corrected values.

#### Scenario: A coordinator corrects a mistyped name

- **WHEN** a `coordinator` corrects the `last_name` of an active person in scope
- **THEN** the person carries the new `last_name`
- **AND** a `person.renamed` audit entry with the previous and the new name exists for her site

#### Scenario: A coordinator corrects a mistyped employee number

- **WHEN** a `coordinator` corrects the `employee_number` of an active person in scope to a
  value no other person carries
- **THEN** the person carries the new `employee_number` and the same `id`
- **AND** a `person.renumbered` audit entry with the previous and the new number exists for her site

#### Scenario: An employee number in use is refused

- **WHEN** a `coordinator` corrects the `employee_number` of a person to one another person
  already carries
- **THEN** the request is refused
- **AND** neither person is changed and no audit entry is written

#### Scenario: An inactive person cannot be corrected

- **WHEN** a `coordinator` attempts to correct a person whose `deactivated_at` is non-null
- **THEN** the request is refused
- **AND** the person is unchanged

#### Scenario: A person outside the site scope is not disclosed

- **WHEN** a coordinator names a person outside the session's site scope
- **THEN** the request returns the same not-found response used for a nonexistent person
- **AND** no person row is changed

#### Scenario: An inspector cannot correct a person

- **WHEN** an account whose `role` is `inspector` attempts to correct a person in its site scope
- **THEN** the request is refused
- **AND** the person is unchanged

#### Scenario: An empty correction is refused

- **WHEN** a coordinator names a person and supplies no field, or a field that is empty once trimmed
- **THEN** the request is refused
- **AND** the person is unchanged

#### Scenario: The dialog offers the email of an invitation not yet accepted

- **WHEN** a coordinator opens the correction of a person referenced by an active account that
  cannot yet sign in
- **THEN** the dialog shows that account's current `email` as correctable
- **AND** saving a different `email` updates the account's `email` without creating a
  `user_invitation` row

#### Scenario: The dialog offers no email for anyone else

- **WHEN** a coordinator opens the correction of a person with no account, with an inactive account,
  or with an account that can already sign in
- **THEN** the dialog offers `first_name`, `last_name` and `employee_number` only
