## Purpose

Separates the roster from the account list: every worker exists as a person who can be named in
an incident or made responsible for a corrective action without ever being given access, while
the small set of people who do sign in carry a single role and an explicit list of sites, so that
"who may see this workplace" is a fact the database enforces rather than a convention the
endpoints agree on.

## Requirements

### Requirement: A person is a roster record, not an account

The system SHALL store every member of staff as a `person` row that exists independently of any
ability to sign in. A `person` SHALL be storable, selectable and referenceable by other records
with no account attached, and creating one SHALL NOT create, imply or require credentials of any
kind.

#### Scenario: A person exists with no account

- **WHEN** a `person` row is created and no `app_user` row references it
- **THEN** the person is readable, and is offered by the subject selection list for their site
- **AND** no credential, invitation or sign-in capability exists for that person

#### Scenario: Most of the roster has no account

- **WHEN** the roster of a site is read together with the accounts
- **THEN** the number of `person` rows may exceed the number of `app_user` rows by any amount
- **AND** no constraint requires a `person` to have an `app_user`

### Requirement: A person is identified by employee number, not by name

The system SHALL store `person.employee_number` as the identity of a roster record: mandatory,
unique across the whole organisation, and immutable once assigned. Names SHALL NOT be treated as
identifying: two active people MAY carry the same `first_name` and `last_name`.

#### Scenario: A duplicate employee number is rejected

- **WHEN** a second `person` row is inserted with an `employee_number` that already exists
- **THEN** the insert fails with a unique violation

#### Scenario: The employee number cannot be changed

- **WHEN** any role runs `UPDATE person SET employee_number = <another value> WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `employee_number` is unchanged when read back

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

### Requirement: A person belongs to one site and is isolated by it

The system SHALL store a mandatory `person.site_id` referencing an existing `site`, and SHALL
restrict every read and write of `person` to the sites declared as the transaction's scope
through a row-level security policy rather than a `WHERE` clause in the endpoint. A transaction
that declares no scope SHALL see no person at all.

A transfer between workplaces SHALL be expressible by updating `person.site_id`, and SHALL be
subject to the same policy: a transaction can only move a person between sites that are both
within its declared scope.

#### Scenario: A person without a site is rejected

- **WHEN** a `person` row is inserted with a null `site_id`
- **THEN** the insert is rejected

#### Scenario: A single-site scope sees only its own roster

- **WHEN** a transaction declares a scope of `st-thomas` only
- **THEN** selecting from `person` returns only people whose `site_id` is `st-thomas`
- **AND** the people of `glencoe` are absent from the result

#### Scenario: A two-site scope sees both rosters

- **WHEN** a transaction declares a scope of both sites, as the coordinator's scope does
- **THEN** selecting from `person` returns the people of both sites

#### Scenario: No declared scope means no rows

- **WHEN** a transaction selects from `person` without declaring any scope
- **THEN** the result is empty, and no error is raised

#### Scenario: The isolation applies to the owner role as well

- **WHEN** the migration role — which owns the table — selects from `person` in a transaction
  declaring a scope of `st-thomas` only
- **THEN** the people of `glencoe` are absent from the result

#### Scenario: A transfer within the declared scope is accepted

- **WHEN** a transaction declaring a scope of both sites updates a person's `site_id` from
  `st-thomas` to `glencoe`
- **THEN** the statement succeeds and the person appears in the roster of `glencoe`

#### Scenario: A transfer out of the declared scope is rejected

- **WHEN** a transaction declaring a scope of `st-thomas` only updates a person's `site_id` to
  `glencoe`
- **THEN** the update is rejected by the row-level security policy

### Requirement: People are deactivated, never deleted

The system SHALL retire a person by setting `person.deactivated_at` and SHALL NOT provide any way
to delete one. A deactivated person SHALL be absent from every selection list offered for new
records and SHALL still resolve as a reference from records that already point at them, so that
an incident from three years ago still names who it was about.

Reactivation SHALL be possible by setting `deactivated_at` back to null.

#### Scenario: Deleting a person is rejected for the application role

- **WHEN** a session connected as the application role runs `DELETE FROM person WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: Deleting a person is rejected for the owner role too

- **WHEN** a session connected as the migration role runs `DELETE FROM person WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`

#### Scenario: A deactivated person is not offered for selection

- **WHEN** the subject selection list for a site is read
- **THEN** it contains every `person` of that site whose `deactivated_at` is null
- **AND** it contains no `person` whose `deactivated_at` is non-null

#### Scenario: A deactivated person still resolves from a historical record

- **WHEN** a record referencing a person exists
- **AND** `deactivated_at` is then set on that `person` row
- **THEN** reading the record back still resolves the person's `employee_number`,
  `first_name` and `last_name`

### Requirement: An account always belongs to a person, and a person has at most one account

The system SHALL store every account as an `app_user` row carrying a mandatory `person_id` that
references an existing `person`. `person_id` SHALL be unique across `app_user`, and SHALL be
immutable: an account cannot be reassigned from one person to another.

Shared accounts SHALL NOT be representable. The acting user recorded in the audit log must
identify one real person, or the immutability of the record proves nothing.

#### Scenario: An account without a person is rejected

- **WHEN** an `app_user` row is inserted with a null `person_id`
- **THEN** the insert fails with a not-null violation

#### Scenario: An account for an unknown person is rejected

- **WHEN** an `app_user` row is inserted with a `person_id` matching no `person` row
- **THEN** the insert fails with a foreign key violation

#### Scenario: A second account for the same person is rejected

- **WHEN** an `app_user` row is inserted with a `person_id` that another `app_user` already
  references
- **THEN** the insert fails with a unique violation

#### Scenario: An account cannot be reassigned to another person

- **WHEN** any role runs `UPDATE app_user SET person_id = <another person's id> WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`
- **AND** the stored `person_id` is unchanged when read back

#### Scenario: An account resolves to the person's roster identity

- **WHEN** an account is read together with its person
- **THEN** the `employee_number`, `first_name` and `last_name` come from the `person` row and
  are not duplicated on `app_user`

### Requirement: An account carries exactly one role from a closed set

The system SHALL store `app_user.role` as a mandatory value restricted by the database to
`hs_coordinator`, `jhsc_member`, `supervisor`, `management` and `external_auditor`. An account
SHALL carry exactly one role: the schema SHALL NOT allow a set, a list or a second role row.

`jhsc_member` SHALL be the single term for the people who carry out inspections; `inspector` SHALL
NOT appear as a role value.

#### Scenario: A role outside the closed set is rejected

- **WHEN** an `app_user` row is inserted with `role` set to `inspector`
- **THEN** the insert fails with a check violation

#### Scenario: A null role is rejected

- **WHEN** an `app_user` row is inserted with a null `role`
- **THEN** the insert fails with a not-null violation

#### Scenario: Each of the five roles is accepted

- **WHEN** an `app_user` row is inserted for each of `hs_coordinator`, `jhsc_member`,
  `supervisor`, `management` and `external_auditor`
- **THEN** all five inserts succeed

#### Scenario: A role change is recorded, not silently applied

- **WHEN** a session connected as the application role changes an account's `role`
- **THEN** the statement succeeds
- **AND** an audit entry naming the previous and the new role exists for every site in the
  account's scope

### Requirement: An account is addressed by a single work email

The system SHALL store `app_user.email` as mandatory, unique across all accounts including
deactivated ones, and normalised to lower case by the database rather than by the caller. It is
how the coordinator invites an account and how its holder will later be recognised at sign-in;
storing it once here SHALL be the only copy in the system.

A correction to an email SHALL be possible and SHALL be a recorded event, because it changes who
can take over an account.

#### Scenario: A duplicate email is rejected

- **WHEN** an `app_user` row is inserted with an `email` that already exists on another account
- **THEN** the insert fails with a unique violation

#### Scenario: Case does not create a second account

- **WHEN** an account exists with `email` `sam.reid@example.com`
- **AND** an `app_user` row is inserted with `email` `Sam.Reid@Example.com`
- **THEN** the insert fails with a unique violation

#### Scenario: An email freed by deactivation is still taken

- **WHEN** an account carrying an `email` is deactivated
- **AND** a new account is created with the same `email`
- **THEN** the insert fails with a unique violation

#### Scenario: A malformed email is rejected

- **WHEN** an `app_user` row is inserted with an `email` that contains no `@`
- **THEN** the insert fails with a check violation

#### Scenario: Changing an email is recorded

- **WHEN** an account's `email` is updated
- **THEN** the statement succeeds
- **AND** an audit entry carrying the previous and the new value exists for every site in the
  account's scope

### Requirement: An account's site scope is explicit, granted and revocable

The system SHALL store the sites an account may reach as `user_site_scope` rows, one per site,
each carrying `granted_at` and a nullable `revoked_at`. The effective scope of an account SHALL be
the set of its rows whose `revoked_at` is null. Revoking a site SHALL be expressed by setting
`revoked_at`, never by deleting the row.

An account SHALL NOT hold two active rows for the same site. An account with no active row SHALL
have an empty scope and SHALL therefore see no site-isolated data at all, which is the correct
default rather than an error.

#### Scenario: A scope row is granted and read back

- **WHEN** a `user_site_scope` row is inserted for an account and the site `st-thomas`
- **THEN** the account's effective scope is exactly `st-thomas`

#### Scenario: A duplicate active grant is rejected

- **WHEN** a second `user_site_scope` row is inserted for the same account and the same site
  while the first has a null `revoked_at`
- **THEN** the insert fails with a unique violation

#### Scenario: Revoking removes the site from the effective scope

- **WHEN** `revoked_at` is set on an account's `user_site_scope` row for `glencoe`
- **THEN** the account's effective scope no longer contains `glencoe`
- **AND** the row is still present, carrying both `granted_at` and `revoked_at`

#### Scenario: A revoked site can be granted again

- **WHEN** an account whose grant for `glencoe` was revoked is granted `glencoe` again
- **THEN** the insert succeeds and the effective scope contains `glencoe`
- **AND** both the revoked row and the new row are present

#### Scenario: Deleting a scope row is rejected

- **WHEN** any role attempts to delete a `user_site_scope` row
- **THEN** the attempt fails and the row is still present when read back

#### Scenario: An account with no active scope sees nothing

- **WHEN** a transaction declares the scope of an account that has no active `user_site_scope` row
- **THEN** reads of site-isolated tables return no rows, and no error is raised

#### Scenario: A scope grant for an unknown site is rejected

- **WHEN** a `user_site_scope` row is inserted with a `site_id` matching no `site` row
- **THEN** the insert fails with a foreign key violation

### Requirement: Site scope decides what an account can see, without any endpoint filtering

The system SHALL derive the `app.site_ids` of a transaction from the acting account's effective
scope, and SHALL rely on the row-level security policies of the site-isolated tables for the
resulting visibility. No endpoint SHALL filter by site in its query.

A `jhsc_member` or a `supervisor` SHALL normally hold one site; `hs_coordinator` and `management`
SHALL be the roles that hold both. This SHALL be a property of the scope rows granted to the
account, not of the role value: the role does not by itself widen or narrow what is visible.

#### Scenario: A single-site member does not see the other workplace

- **WHEN** a transaction runs with the scope of a `jhsc_member` account granted only `st-thomas`
- **THEN** reads of `person`, `location` and every other site-isolated table return only rows of
  `st-thomas`

#### Scenario: The coordinator sees both workplaces

- **WHEN** a transaction runs with the scope of an `hs_coordinator` account granted both sites
- **THEN** reads of site-isolated tables return rows of both sites

#### Scenario: The role alone grants nothing

- **WHEN** an account with role `hs_coordinator` has no active `user_site_scope` row
- **THEN** its effective scope is empty and reads of site-isolated tables return no rows

### Requirement: An external auditor account expires, and cannot be created without an expiry

The system SHALL require `app_user.expires_at` to be non-null when `role` is `external_auditor`,
and SHALL require it to be null for every other role. The database SHALL reject an
`external_auditor` account whose `expires_at` is more than 90 days after its `created_at`. The
system SHALL NOT renew an expiry automatically.

The system SHALL also store the record date window an auditor's access is bounded by, as
`records_from` and `records_to`, mandatory for `external_auditor` and null for every other role,
with `records_from` not after `records_to`.

An account whose `expires_at` has passed SHALL be treated as inactive for every purpose, without
any row being deleted.

#### Scenario: An external auditor without an expiry is rejected

- **WHEN** an `app_user` row is inserted with `role` `external_auditor` and a null `expires_at`
- **THEN** the insert fails with a check violation

#### Scenario: An expiry beyond 90 days is rejected

- **WHEN** an `app_user` row is inserted with `role` `external_auditor` and an `expires_at` 91
  days after `created_at`
- **THEN** the insert fails with a check violation

#### Scenario: An expiry within 90 days is accepted

- **WHEN** an `app_user` row is inserted with `role` `external_auditor` and an `expires_at` 30
  days after `created_at`
- **THEN** the insert succeeds

#### Scenario: An expiry on a non-auditor role is rejected

- **WHEN** an `app_user` row is inserted with `role` `supervisor` and a non-null `expires_at`
- **THEN** the insert fails with a check violation

#### Scenario: An auditor without a record window is rejected

- **WHEN** an `app_user` row is inserted with `role` `external_auditor`, a valid `expires_at` and
  a null `records_from` or a null `records_to`
- **THEN** the insert fails with a check violation

#### Scenario: An inverted record window is rejected

- **WHEN** an `app_user` row is inserted with `role` `external_auditor` and a `records_from`
  later than its `records_to`
- **THEN** the insert fails with a check violation

#### Scenario: An expired auditor account is inactive

- **WHEN** the current time is after an account's `expires_at`
- **THEN** the account is reported as inactive
- **AND** its row is still present, with its scope rows intact

#### Scenario: An auditor account is revocable before it expires

- **WHEN** `deactivated_at` is set on an `external_auditor` account before its `expires_at`
- **THEN** the account is reported as inactive from that moment

### Requirement: Accounts are deactivated, never deleted

The system SHALL retire an account by setting `app_user.deactivated_at` and SHALL NOT provide any
way to delete one. A deactivated account SHALL still resolve as the `actor_user_id` of every audit
entry it wrote, so that the record keeps naming who acted.

Deactivating an account SHALL NOT deactivate the underlying person: losing access is not leaving
the company.

#### Scenario: Deleting an account is rejected for the application role

- **WHEN** a session connected as the application role runs `DELETE FROM app_user WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `42501` (`insufficient_privilege`)
- **AND** the row is still present when read back

#### Scenario: Deleting an account is rejected for the owner role too

- **WHEN** a session connected as the migration role runs `DELETE FROM app_user WHERE id = <existing id>`
- **THEN** the statement fails with SQLSTATE `HS001`

#### Scenario: A deactivated account still resolves from the audit log

- **WHEN** `deactivated_at` is set on an account that wrote audit entries
- **THEN** those entries still resolve the account and its person

#### Scenario: Deactivating an account leaves the person active

- **WHEN** `deactivated_at` is set on an `app_user` row
- **THEN** the referenced `person` row's `deactivated_at` is unchanged
- **AND** the person is still offered by the subject selection list

### Requirement: The roster is loaded from a CSV file, never synchronised

The system SHALL provide a roster import that reads a UTF-8 CSV file with a mandatory header row
and the columns `employee_number`, `first_name`, `last_name`, `site_code` and `status`. The import
SHALL be operator-initiated. The system SHALL NOT connect to, poll or receive data from any
payroll system.

A row whose `employee_number` is not yet known SHALL create a person. A row whose
`employee_number` is known SHALL update that person's `first_name`, `last_name`, `site_id` and
active status, and SHALL NOT create a second person.

#### Scenario: A new employee number creates a person

- **WHEN** a file containing a row with an `employee_number` that matches no `person` is imported
- **THEN** a `person` row is created with the file's `first_name`, `last_name` and the site named
  by `site_code`

#### Scenario: A known employee number updates the existing person

- **WHEN** a file containing a row whose `employee_number` matches an existing `person` is
  imported with a different `last_name`
- **THEN** that person's `last_name` is updated
- **AND** no second `person` row with that `employee_number` exists
- **AND** every record already referencing that person still resolves to them

#### Scenario: A file with a different column order is accepted

- **WHEN** a file whose header names the five required columns in a different order is imported
- **THEN** the columns are matched by header name and the import proceeds

#### Scenario: A file missing a required column is rejected as a whole

- **WHEN** a file whose header omits `employee_number` is imported
- **THEN** no `person` row is created or changed
- **AND** the import reports the missing column as the reason it could not run

#### Scenario: No payroll connection exists

- **WHEN** the deployed system is inspected for outbound integrations
- **THEN** no scheduled job, client or credential targets a payroll system

### Requirement: An import reports every rejected row with its reason

The system SHALL validate each data row independently and SHALL reject, without applying, a row
that has a missing or malformed `employee_number`, a missing `first_name` or `last_name`, a
`site_code` matching no site, a `status` outside the accepted values, or an `employee_number` that
appears more than once in the same file. A row that would move a person to a site outside the
importing scope SHALL also be rejected.

The import SHALL report the total number of rows read, applied and rejected, and for each rejected
row its 1-based row number in the file, the offending value and a reason. Valid rows SHALL still be
applied: one bad row SHALL NOT discard the file.

#### Scenario: A row with no employee number is rejected and reported

- **WHEN** a file whose third data row has an empty `employee_number` is imported
- **THEN** that row is not applied
- **AND** the report contains an entry for row 3 naming the missing `employee_number` as the reason

#### Scenario: An unknown site code is rejected and reported

- **WHEN** a row names a `site_code` that matches no `site`
- **THEN** that row is not applied and the report names the unknown `site_code`

#### Scenario: A duplicate employee number within the file is rejected

- **WHEN** a file contains two rows with the same `employee_number`
- **THEN** the first is applied and the second is rejected
- **AND** the report names the duplicate and both row numbers

#### Scenario: An invalid status value is rejected

- **WHEN** a row's `status` is neither `active` nor `inactive`
- **THEN** that row is not applied and the report names the invalid `status`

#### Scenario: Good rows still apply when other rows fail

- **WHEN** a file of 200 rows is imported and 3 rows are rejected
- **THEN** 197 rows are applied
- **AND** the report states 200 read, 197 applied and 3 rejected

#### Scenario: A clean file reports no rejections

- **WHEN** a file whose every row is valid is imported
- **THEN** the report states zero rejected rows and lists none

### Requirement: An import is a single transaction and leaves a permanent record

The system SHALL apply the accepted rows of an import and write the import's record in one
transaction: a committed import SHALL NOT exist without its report, and a failed import SHALL
leave no person created or changed. The import record SHALL carry who ran it, when, the source
file name, and the counts of rows read, applied and rejected, together with one row per rejected
row. Both SHALL be append-only.

Re-running the same file SHALL be safe: it SHALL produce the same roster and a second import
record, not duplicated people.

#### Scenario: A failure part-way through applies nothing

- **WHEN** an import fails after applying some rows
- **THEN** no `person` row was created or changed by that import
- **AND** no import record exists for it

#### Scenario: A successful import is recorded with its counts

- **WHEN** a file of 200 rows with 3 rejections is imported successfully
- **THEN** an import record exists carrying the file name, the acting account, and the counts
  200 read, 197 applied and 3 rejected
- **AND** three rejection rows are attached to it

#### Scenario: The import record cannot be altered

- **WHEN** any role attempts to update or delete an import record or one of its rejection rows
- **THEN** the attempt fails and the rows are unchanged when read back

#### Scenario: Importing the same file twice changes nothing the second time

- **WHEN** a file is imported and then imported again unchanged
- **THEN** the roster after the second import is identical to the roster after the first
- **AND** two import records exist

### Requirement: Absence from the file never deactivates anybody

The system SHALL change a person's active status only from an explicit `status` value in an
imported row. A person who does not appear in the file SHALL be left exactly as they were. A
partial file SHALL NOT be able to empty the roster.

#### Scenario: A person missing from the file is untouched

- **WHEN** a file containing 5 of the 200 people is imported
- **THEN** the other 195 people keep their `deactivated_at`, their names and their `site_id`

#### Scenario: An explicit inactive status deactivates

- **WHEN** a row for an active person carries `status` `inactive`
- **THEN** that person's `deactivated_at` is set
- **AND** they disappear from the subject selection list while still resolving from existing
  records

#### Scenario: An explicit active status reactivates

- **WHEN** a row for a deactivated person carries `status` `active`
- **THEN** that person's `deactivated_at` is set back to null

#### Scenario: An empty file deactivates nobody

- **WHEN** a file with a valid header and no data rows is imported
- **THEN** the import succeeds with 0 rows read and 0 applied
- **AND** every existing person is unchanged

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
