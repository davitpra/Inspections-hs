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

The system SHALL NOT expose any way to rename, transfer, reactivate or delete a single `person`
through this listing or any companion route. It SHALL expose only the constrained deactivation of
an active person with no account described separately below. Creating a person that does not exist
yet SHALL be available as its own act, and loading the file itself SHALL remain available as a
separate act that names no person and applies the whole file at once.
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

#### Scenario: The listing offers only constrained single-person deactivation

- **WHEN** the roster of a site is read
- **THEN** no route accepts the `id` of one `person` to rename, transfer, reactivate or delete them
- **AND** a companion route accepts the `id` only to deactivate an active person with no account
- **AND** the other writes available over the roster remain the import of a whole CSV file and the
  creation of a person who does not exist yet

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

### Requirement: An `hs_coordinator` account can hold a seat on the JHSC

The system SHALL record on `app_user` whether the account holds a seat on the Joint Health and
Safety Committee, as `jhsc_seat_granted_at`: null when the account holds no seat, and the moment
the seat was granted when it does.

The seat SHALL be a position an account occupies, not a role: taking or leaving a seat SHALL NOT
change `app_user.role`, and the closed set of five roles SHALL be unaffected.

The database SHALL restrict a non-null `jhsc_seat_granted_at` to accounts whose `role` is
`hs_coordinator`. A `jhsc_member` SHALL NOT carry a seat value, because that role already IS the
seat, and no other role SHALL be able to acquire one — the seat SHALL NOT become a second way to
grant a `supervisor`, `management` or `external_auditor` account the ability to be assigned an
inspection.

Granting and withdrawing a seat SHALL each be recorded in the audit log of every site in the
account's scope, as `user.jhsc_seat_granted` and `user.jhsc_seat_withdrawn`, naming the acting
account.

Holding or losing a seat SHALL NOT change what the account may sign in to: it SHALL NOT create,
revoke or expire a credential, a session or an invitation.

#### Scenario: A seat on an account that is not the coordinator's is rejected

- **WHEN** an `app_user` row whose `role` is `jhsc_member`, `supervisor`, `management` or
  `external_auditor` is written with a non-null `jhsc_seat_granted_at`
- **THEN** the write fails with a check violation

#### Scenario: An account without a seat carries none

- **WHEN** an `hs_coordinator` account is created
- **THEN** its `jhsc_seat_granted_at` is null

#### Scenario: Taking a seat is audited in every site of the scope

- **WHEN** a seat is granted on an `hs_coordinator` account scoped to `st-thomas` and `glencoe`
- **THEN** its `jhsc_seat_granted_at` is non-null
- **AND** a `user.jhsc_seat_granted` entry naming the acting account exists in the audit chain of
  both sites

#### Scenario: Leaving a seat is audited as its own event

- **WHEN** the seat of an account that holds one is withdrawn
- **THEN** its `jhsc_seat_granted_at` is null
- **AND** a `user.jhsc_seat_withdrawn` entry exists in the audit chain of every site in the
  account's scope

#### Scenario: The role is untouched by either act

- **WHEN** a seat is granted on an `hs_coordinator` account and then withdrawn
- **THEN** the account's `role` is `hs_coordinator` throughout
- **AND** no `user.role_changed` entry is written

#### Scenario: A seat does not touch access

- **WHEN** the seat of an account that holds an active credential and a live session is granted
  and then withdrawn
- **THEN** the credential and the `app_session` row both still carry a null `revoked_at`

### Requirement: A coordinator can take and leave a seat on the JHSC from the roster

The system SHALL let an `hs_coordinator` grant and withdraw a JHSC seat on an `hs_coordinator`
account from the roster of the site the account is scoped to, including **their own** account: the
roster already administers who sits on the committee, and there is no other role to ask.

The seat SHALL be a solitary act. A request SHALL NOT combine it with withdrawing the account's
access, with correcting the account's email or with issuing an invitation link, because those
either contradict it or belong to a different decision.

The request SHALL be refused, leaving `jhsc_seat_granted_at` unchanged, when the target account's
role is not `hs_coordinator`, and when the target account is inactive.

Granting a seat to an account that already holds one, and withdrawing the seat of an account that
holds none, SHALL leave the recorded moment unchanged, so that `jhsc_seat_granted_at` stays the
moment the seat was actually taken.

Both acts SHALL be confirmed before they are executed. Withdrawing SHALL state that inspections
already assigned to that account stay assigned to it.

Neither act SHALL deactivate the account, revoke its scope, or touch the referenced `person` row.

#### Scenario: The coordinator seats herself

- **WHEN** an `hs_coordinator` grants the JHSC seat on their own account
- **THEN** the request succeeds and the account is reported as holding a seat
- **AND** the audit entry names that same account as the actor

#### Scenario: The seat is given up

- **WHEN** an `hs_coordinator` withdraws the JHSC seat of an account that holds one
- **THEN** the account is reported as holding no seat
- **AND** the account stays active and can still sign in

#### Scenario: A role that cannot hold a seat is refused

- **WHEN** an `hs_coordinator` grants a JHSC seat on an account whose role is `jhsc_member`,
  `supervisor`, `management` or `external_auditor`
- **THEN** the request is refused and names the role
- **AND** that account's `jhsc_seat_granted_at` is still null

#### Scenario: An inactive account is refused

- **WHEN** an `hs_coordinator` grants a JHSC seat on an account whose access has been withdrawn
- **THEN** the request is refused

#### Scenario: The seat is not combined with another act

- **WHEN** a request asks for a JHSC seat together with withdrawing the account's access,
  correcting its email or issuing an invitation link
- **THEN** the request is rejected before it reaches the account
- **AND** neither the seat nor the email nor the invitation changes

#### Scenario: Someone who is not the coordinator cannot grant a seat

- **WHEN** an account whose role is `jhsc_member`, `supervisor`, `management` or
  `external_auditor` requests a JHSC seat on any account
- **THEN** the request is rejected as forbidden

### Requirement: The roster reports whether an account holds a JHSC seat

The system SHALL report, for every account the roster returns, whether it holds a seat on the
JHSC, so that the console can name who sits on the committee today without a second read.

The roster SHALL report the seat as a fact — held or not held — and SHALL NOT disclose the moment
it was granted: the console asks who is on the committee, not since when. The moment stays in the
audit chain.

An account whose role is not `hs_coordinator` SHALL be reported as holding no seat, whatever its
role: for a `jhsc_member` the committee membership is already its role.

#### Scenario: A coordinator with a seat is reported as holding one

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by an `hs_coordinator` account whose
  `jhsc_seat_granted_at` is non-null
- **THEN** that row carries an account reported as holding a JHSC seat

#### Scenario: A JHSC member is reported as holding no seat

- **WHEN** the roster of `st-thomas` is read
- **AND** one of its people is referenced by an account whose `role` is `jhsc_member`
- **THEN** that row carries an account reported as holding no seat

#### Scenario: The roster does not disclose when the seat was taken

- **WHEN** the roster of a site is read
- **THEN** no account in the result carries the moment its seat was granted

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

**When the person's existing account is inactive and carries the same role, the request SHALL
restore that account instead of being refused**: it SHALL clear its `deactivated_at`, register
the supplied `email`, grant any requested site its scope does not already reach, and issue the
invitation if one was asked for — all within the one act that creating an account already is.
The restored account SHALL be the same one, never a new one, keeping its identifier, its site
scope and everything the record already says about it.

This is what makes a withdrawal undoable. A person holds at most one account for as long as
they exist, so the account they lost is the only one they will ever have; without restoring it
here, a mistaken withdrawal would put someone beyond the reach of every screen. The caller
SHALL NOT have to distinguish the two cases: there is one way to give a person access, and
which of the two happens is the system's to decide.

The request SHALL be refused when the person does not exist, when the person already holds an
**active** account, when their inactive account carries a role different from the requested one
— changing the role of an account is its own recorded act and SHALL NOT be a side effect of
creating one — when the email belongs to another account, or when a site of the requested scope
is outside the scope of the requesting coordinator.

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

#### Scenario: A second account for a person who holds an active one is refused

- **WHEN** an account is requested for a person that an active `app_user` row already
  references
- **THEN** the request is refused with an error naming that cause
- **AND** the existing account is unchanged

#### Scenario: An account for a person whose account is inactive restores it

- **WHEN** an account of the same role is requested for a person whose existing `app_user` row
  is inactive
- **THEN** the returned account is the one that already existed, carrying its identifier
- **AND** it carries a null `deactivated_at`, is reported as active and cannot yet sign in
- **AND** its live site scope is unchanged
- **AND** the chain of every site in that scope carries a `user.reactivated` entry for it

#### Scenario: The supplied email replaces the one the inactive account carried

- **WHEN** an account is requested for a person whose inactive account carries a different
  `email`
- **THEN** the account's `email` is the supplied one

#### Scenario: The inactive account can be restored with its existing email

- **WHEN** an account is requested for a person whose inactive account already carries the
  supplied `email`
- **THEN** that same account is restored
- **AND** the request is not refused as an email conflict

#### Scenario: An inactive account of another role is not restored

- **WHEN** a `jhsc_member` account is requested for a person whose existing inactive account
  carries the role `supervisor`
- **THEN** the request is refused
- **AND** that account stays inactive and its role is unchanged

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

The system SHALL let the H&S coordinator turn a person of the roster who has no access into an
invited `jhsc_member` in a single act: the account is created with role `jhsc_member`, scoped
to the site whose roster is being read, and an invitation is issued for it. The one-time
invitation token SHALL be returned to the coordinator exactly once and SHALL NOT be readable
afterwards, which is the same rule the invitation already carries.

A person whose `jhsc_member` account was withdrawn SHALL be invitable through this same act,
which restores the account they already had. The coordinator SHALL NOT be asked to tell the
two cases apart, and the roster SHALL NOT present them differently.

The act SHALL be atomic: the account, its scope and the invitation SHALL all exist or none of
them SHALL. A failure SHALL leave the person without access, so that pressing the button
again is a valid retry and not a request the system refuses for a state it created itself.

Only `jhsc_member` SHALL be reachable this way. Every other role SHALL remain outside this act,
because the scope and the validity window they need are not expressible in it.

#### Scenario: Inviting a person without an account

- **WHEN** an `hs_coordinator` invites a person of `st-thomas` who holds no account
- **THEN** an account with role `jhsc_member` scoped to `st-thomas` is created for that person
- **AND** an invitation is issued for it and its one-time token is returned once
- **AND** reading the roster again reports that person as holding a `jhsc_member` account that
  cannot yet sign in

#### Scenario: Inviting a person whose access was withdrawn

- **WHEN** an `hs_coordinator` invites a person whose `jhsc_member` account is inactive
- **THEN** that same account is restored and an invitation is issued for it
- **AND** accepting that invitation creates a credential and the account can sign in

#### Scenario: Inviting a person who already holds an active account is refused

- **WHEN** an `hs_coordinator` invites a person that an active `app_user` row already
  references
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
- **THEN** the request is refused because that person already holds an active account
- **AND** no second account and no second invitation are created

#### Scenario: The token is shown once

- **WHEN** the invitation has been issued and its token returned
- **THEN** no later request returns that token again

### Requirement: A coordinator can withdraw the JHSC access they granted

The system SHALL let the H&S coordinator withdraw, from the roster of the site the account is
scoped to, the access of an active `jhsc_member` account. Withdrawing SHALL revoke the
account's pending invitation, revoke its credential, and set its `deactivated_at`, as one act
that either happens whole or not at all.

The same act SHALL serve an account that never signed in and one that signs in every day: an
invitation nobody accepted and a member leaving the committee are the same fact — this account
no longer grants access — and the system SHALL NOT offer two different withdrawals for it.
What SHALL differ is how the act is named and confirmed, because cancelling an invitation
makes a link stop working while removing a member ends a session that may be open.

Withdrawing SHALL be confirmed before it is executed, and SHALL be refused for an account
whose role is not `jhsc_member`: the roster administers the access the roster grants, and
removing a supervisor or another coordinator is not a press away in a list of two hundred
rows.

Withdrawing an account that is already inactive SHALL be refused, so that the recorded
`deactivated_at` stays the moment the access actually ended.

Withdrawing SHALL NOT deactivate the person: losing access is not leaving the company, and the
roster is maintained by the CSV import.

#### Scenario: A pending invitation is cancelled

- **WHEN** an `hs_coordinator` withdraws the access of a `jhsc_member` account that holds a
  pending invitation and no credential
- **THEN** the invitation carries a non-null `revoked_at` and its token is no longer accepted
- **AND** the account carries a non-null `deactivated_at` and is reported as inactive

#### Scenario: A member who signs in loses access

- **WHEN** an `hs_coordinator` withdraws the access of a `jhsc_member` account that holds an
  active credential and a live session
- **THEN** the credential carries a non-null `revoked_at` and the account cannot sign in again
- **AND** the `app_session` row carries a non-null `revoked_at`

#### Scenario: The person stays on the roster

- **WHEN** an `hs_coordinator` withdraws the access of a `jhsc_member` account
- **THEN** the referenced `person` row's `deactivated_at` is unchanged

#### Scenario: A role the roster does not administer is refused

- **WHEN** an `hs_coordinator` withdraws the access of an account whose role is `supervisor`,
  `management`, `hs_coordinator` or `external_auditor`
- **THEN** the request is refused and the account stays active

#### Scenario: Withdrawing twice is refused

- **WHEN** an `hs_coordinator` withdraws the access of an account that is already inactive
- **THEN** the request is refused and the recorded `deactivated_at` is unchanged

#### Scenario: An account outside the coordinator's scope cannot be withdrawn

- **WHEN** an `hs_coordinator` withdraws the access of an account of a person outside every
  site of their scope
- **THEN** the request is refused and the account stays active

#### Scenario: Only the coordinator can withdraw access

- **WHEN** an account whose role is not `hs_coordinator` withdraws another account's access
- **THEN** the request is refused

### Requirement: Withdrawing access keeps the account's site scope

The system SHALL leave the `user_site_scope` rows of a withdrawn account exactly as they were,
and SHALL NOT revoke them as part of withdrawing.

This is what makes the withdrawal legible in the record. The audit entry of an account event is
written into the chain of every site the account's live scope reaches, and it is written when
the transaction commits: an act that revoked the scope in that same transaction would reach no
site and would leave the withdrawal unrecorded — and when the access of a person ended is
exactly what the regulatory record is asked for.

The kept scope SHALL NOT grant anything, because an account whose `deactivated_at` is set is
inactive regardless of what it reaches, and no session of it is accepted.

#### Scenario: The withdrawal is recorded in the chain of every site the account reached

- **WHEN** an `hs_coordinator` withdraws the access of an account scoped to two sites
- **THEN** each of the two sites' chains carries one `user.deactivated` entry for that account
- **AND** each entry names the coordinator as the acting account, not the withdrawn one

#### Scenario: The scope survives the withdrawal

- **WHEN** an `hs_coordinator` withdraws the access of an account scoped to two sites
- **THEN** both `user_site_scope` rows still carry a null `revoked_at`

#### Scenario: The kept scope grants nothing

- **WHEN** a withdrawn account whose `user_site_scope` rows are live presents its credentials
- **THEN** no session is established

### Requirement: A person whose access was withdrawn reads as a person with no account

The system SHALL present a person whose only account is inactive exactly as it presents a
person who never held one: the roster SHALL report no role for that row, and the row SHALL
offer inviting them.

That an account row still exists for them is a fact of the store, not of the work. A person
holds at most one account for as long as they exist, so a withdrawn account can neither be
deleted nor replaced — but that constraint SHALL NOT reach the screen, which shows who has
access today. That they once had access, and when it ended, is what the audit chain is for.

#### Scenario: The row of a withdrawn account shows no role

- **WHEN** the roster reports a person who is active and whose account is inactive
- **THEN** the row reports no role
- **AND** the row offers inviting that person, and offers neither reissuing nor withdrawing

#### Scenario: A person who left the company is offered nothing

- **WHEN** the roster reports a person whose own `deactivated_at` is non-null and whose
  account is inactive
- **THEN** the row offers no act

### Requirement: A coordinator can read the administrable detail of an account in their scope

The system SHALL let the H&S coordinator read one account of a person in their site scope,
reduced to what administering it requires: its `id`, `role`, whether it is active, whether it
can sign in, and its `email`. This SHALL NOT be the roster listing: the roster SHALL continue
to omit every account's `email`, scope and credential, and this reading exists precisely
because correcting an email needs to show the coordinator what is registered today.

#### Scenario: The coordinator reads an account in scope

- **WHEN** an `hs_coordinator` reads the account of a person in a site of their scope
- **THEN** the account is returned with its `id`, `role`, `active`, `can_sign_in` and `email`

#### Scenario: An account outside the coordinator's scope is not readable

- **WHEN** an `hs_coordinator` reads an account of a person outside every site of their scope
- **THEN** no account is returned

#### Scenario: Only the coordinator can read this detail

- **WHEN** an account whose role is not `hs_coordinator` reads another account's detail
- **THEN** the request is refused

### Requirement: A coordinator can reissue the invitation of an account that never signed in

The system SHALL let the H&S coordinator issue a new invitation, from the roster of the site
the account is scoped to, for an account that is active and holds no credential — the state
the roster reports as holding a role it cannot yet sign in with. The new one-time token SHALL
be returned exactly once, under the same rule as the first one.

This SHALL be the recovery path for a token that was lost, never delivered, or expired: no
route SHALL return a token that was already issued, so a link that was not copied is
unrecoverable and a replacement is the only remedy.

Reissuing MAY correct the account's `email` in the same act, because the most common reason to
reissue is that the email was mistyped and the first link never arrived. When it does, the
change SHALL be an audited event under the same rule that already governs correcting an
account's email, and the new invitation SHALL be sent to the corrected address. A corrected
email that already belongs to another account SHALL be refused, and refusing it SHALL leave
the account's `email` and its invitations exactly as they were before the request.

The system SHALL refuse to reissue — and to correct the email in that same act — for an
account that already holds a credential. Restoring access to an account that can already sign
in is the credential reset, a separate act, and merging them would let a mistaken press take
away the access of someone who is working, or change the address that controls their account
without their own credential in the loop. This refusal SHALL NOT extend to withdrawing that
account's access, which is precisely the act meant for a member who signs in today.

An account that is deactivated or expired SHALL NOT be reissued an invitation; the act its
state admits is being invited again.

The roster SHALL offer, on each row, the act that its state admits and no other: inviting the
person when they have no access — whether they never held an account or theirs was withdrawn
— reissuing and cancelling when they hold an account that is active and cannot yet sign in,
and withdrawing when the account can already sign in. Every act that takes something away
SHALL be confirmed before it is executed, because each of them makes a link or a session stop
working.

#### Scenario: The coordinator reissues a link that was never copied

- **WHEN** an `hs_coordinator` reissues the invitation of an account that holds no
  `app_credential` and whose `deactivated_at` is null
- **THEN** a new `user_invitation` row is created for that account and its one-time token is
  returned once
- **AND** the account still reports that it cannot sign in until the new invitation is accepted

#### Scenario: Reissuing corrects a mistyped email in the same act

- **WHEN** an `hs_coordinator` reissues the invitation of an account that holds no
  `app_credential`, supplying an `email` different from the one on file and not used by any
  other account
- **THEN** the account's `email` is updated to the supplied value
- **AND** a new invitation is issued for that account
- **AND** an audit entry carrying the previous and the new `email` exists for every site in
  the account's scope

#### Scenario: Correcting the email to one already taken is refused

- **WHEN** an `hs_coordinator` reissues the invitation of an account, supplying an `email`
  that already belongs to another account
- **THEN** the request is refused
- **AND** the account's `email` is unchanged
- **AND** no new `user_invitation` row is created and the existing one, if any, is unchanged

#### Scenario: Reissuing for an account that can already sign in is refused

- **WHEN** an `hs_coordinator` reissues the invitation of an account that holds an
  `app_credential` whose `revoked_at` is null
- **THEN** the request is refused and no `user_invitation` row is created
- **AND** the existing `app_credential` is unchanged

#### Scenario: Correcting the email of an account that can already sign in is refused

- **WHEN** an `hs_coordinator` attempts to reissue and correct the `email` of an account that
  holds an `app_credential` whose `revoked_at` is null
- **THEN** the request is refused and the account's `email` is unchanged

#### Scenario: Withdrawing an account that can already sign in is allowed

- **WHEN** an `hs_coordinator` withdraws the access of a `jhsc_member` account that holds an
  `app_credential` whose `revoked_at` is null
- **THEN** the act is carried out and the account is reported as inactive

#### Scenario: Reissuing for a deactivated account is refused

- **WHEN** an `hs_coordinator` reissues the invitation of an account whose `deactivated_at` is
  set
- **THEN** the request is refused and no `user_invitation` row is created

#### Scenario: Only the coordinator can reissue

- **WHEN** an account whose role is not `hs_coordinator` reissues an invitation
- **THEN** the request is refused and no `user_invitation` row is created

#### Scenario: The reissued token is shown once

- **WHEN** the new invitation has been issued and its token returned
- **THEN** no later request returns that token again

#### Scenario: A row of an invited account offers a new link and a cancellation

- **WHEN** the roster reports a person whose account is active and cannot sign in
- **THEN** the row offers reissuing the invitation and cancelling it
- **AND** the row does not offer inviting that person again

#### Scenario: A row of an account in use offers withdrawing it

- **WHEN** the roster reports a person whose account can sign in
- **THEN** the row offers withdrawing that account's access
- **AND** the row offers neither inviting nor reissuing

#### Scenario: A row of a withdrawn account offers inviting again

- **WHEN** the roster reports a person who is active and whose account is inactive
- **THEN** the row offers inviting that person
- **AND** the row offers neither reissuing nor withdrawing

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

### Requirement: Registering a site grants its scope to the account that registered it

The system SHALL, in the same transaction that registers a `site`, store an active
`user_site_scope` row whose `user_id` is the registering account and whose `site_id` is the
registered site. The registration and the grant SHALL be atomic: neither SHALL be stored without
the other.

The system SHALL grant that scope to the registering account only. It SHALL NOT alter the scope of
any other account as a consequence of a site registration.

#### Scenario: The registrant reaches the site it registered

- **WHEN** an HS coordinator registers a site
- **THEN** a `user_site_scope` row exists whose `user_id` is that account and whose `site_id` is the
  registered site
- **AND** its `revoked_at` is null
- **AND** its `granted_at` is set

#### Scenario: The registrant's next request carries the new site

- **GIVEN** an HS coordinator has registered a site
- **WHEN** that account's session scope is resolved for its next request
- **THEN** the registered site is among the sites the session reaches

#### Scenario: A failed grant leaves no site behind

- **WHEN** the `user_site_scope` insert cannot complete after the `site` row has been inserted
- **THEN** the transaction rolls back
- **AND** no `site` row with the submitted `code` is stored
- **AND** no `user_site_scope` row for the submitted site is stored

#### Scenario: No other account gains the new site

- **GIVEN** a second account whose role is `hs_coordinator` and whose scope covers St. Thomas only
- **WHEN** another HS coordinator registers a site
- **THEN** the second account's active `user_site_scope` rows are unchanged
- **AND** the registered site is absent from the second account's site list

#### Scenario: The grant is recorded on the new site's chain

- **WHEN** an HS coordinator registers a site
- **THEN** an `audit_log` entry whose `event_type` is `user.scope_granted` exists
- **AND** its `site_id` is the registered site
- **AND** its payload carries the registering account as its `account_id`

### Requirement: Site deactivation preserves historical account scope

The system SHALL NOT delete or revoke `user_site_scope` rows when a site is deactivated. Existing
scope rows SHALL remain available for resolving historical records, while active Locations views
SHALL rely on the site's non-null `deactivated_at` to omit the site from active management.

#### Scenario: Deactivation does not revoke an account's site scope

- **GIVEN** an account has an active `user_site_scope` row for a site
- **WHEN** the site is deactivated
- **THEN** the `user_site_scope` row remains present
- **AND** its `revoked_at` remains null

#### Scenario: Historical access still resolves the deactivated site

- **GIVEN** an account has an active scope for a deactivated site
- **WHEN** a historical record references that site
- **THEN** the site can still be resolved by its `id`, `code`, `name` and `deactivated_at`

#### Scenario: Deactivation changes no other account scopes

- **WHEN** an HS coordinator deactivates a site
- **THEN** no `user_site_scope` row for any account is inserted, deleted or revoked as a side effect

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
SHALL be operator-initiated: it SHALL run only when an operator submits a file, whether from a
server command or from the console, and SHALL NOT run on a schedule. The system SHALL NOT connect
to, poll or receive data from any payroll system.

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

#### Scenario: No import runs without a file somebody submitted

- **WHEN** the deployed system is inspected for scheduled work
- **THEN** no job imports the roster on its own
- **AND** every import record corresponds to a file an operator submitted

### Requirement: The H&S coordinator can import the roster over HTTP

The system SHALL let an account whose `role` is `hs_coordinator` import a roster CSV over HTTP by
submitting exactly one file in the multipart field `file`, and SHALL apply it through the same
importer as the server command: the same header columns, the same per-row validation, the same
upsert by `employee_number`, and the same single transaction that writes the import record together
with the rows it applied.

The sites the import may write SHALL come from the session's scope resolved at that request, and
the account recorded as having run the import SHALL be the session's account. The request SHALL
NOT be able to name the scope it runs under, and a row naming a `site_code` outside that scope
SHALL be rejected with the same reason as a `site_code` that matches no site, so that the response
does not disclose the existence of a site the account does not administer.

Any other `role` SHALL be refused, and the refusal SHALL leave no `person` row and no import record
behind.

The system SHALL reject with `roster_file_unusable` a submission that carries no `file`, more than
one `file`, an unexpected multipart field or an unusable file name. The system SHALL reject with
`roster_file_too_large` a file larger than 2 MiB, and SHALL apply nothing in those cases.

#### Scenario: The coordinator imports a file from the console

- **WHEN** an account whose `role` is `hs_coordinator` and whose scope contains `st-thomas`
  submits a CSV whose rows all name `site_code` `st-thomas`
- **THEN** every row is applied to the roster of `st-thomas`
- **AND** the response reports the counts of rows read, applied and rejected
- **AND** an import record exists naming that account and the submitted file name

#### Scenario: A row outside the session's scope is rejected, not applied

- **WHEN** a coordinator whose scope is `st-thomas` only submits a file containing rows for
  `st-thomas` and rows for `glencoe`
- **THEN** the rows for `st-thomas` are applied
- **AND** the rows for `glencoe` are rejected, each with its row number
- **AND** the reason given does not distinguish a site outside the scope from a site that does not
  exist

#### Scenario: The request cannot widen its own scope

- **WHEN** a coordinator whose scope is `st-thomas` only submits a file together with a site or a
  scope named in the request
- **THEN** the named scope is ignored
- **AND** no `person` of `glencoe` is created or changed

#### Scenario: Any other role is refused

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or
  `external_auditor` submits a roster CSV
- **THEN** the request is refused
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: A submission without a file is refused

- **WHEN** a coordinator submits a request that carries no file
- **THEN** the request is refused with `roster_file_unusable`
- **AND** no import record is written

#### Scenario: A submission with more than one file is refused

- **WHEN** a coordinator submits more than one `file` or submits a file in another multipart field
- **THEN** the request is refused with `roster_file_unusable`
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: A file above the accepted maximum is refused

- **WHEN** a coordinator submits a file larger than the accepted maximum size
- **THEN** the request is refused with `roster_file_too_large`
- **AND** no row of it is applied

#### Scenario: An employee number outside the scope does not abort the file

- **WHEN** a coordinator whose scope is `st-thomas` submits a row for `st-thomas` whose
  `employee_number` already belongs to a person of `glencoe`
- **THEN** that row is rejected without disclosing the site of the existing person
- **AND** the other valid rows are applied in the same import
- **AND** the person of `glencoe` is not changed

### Requirement: Rejected rows are a result, not a failed request

The system SHALL answer an import that could be read as a success carrying the report, however many
rows it rejected: rejected rows are the expected outcome of a real payroll export and SHALL NOT
turn the response into an error. The report SHALL carry the number of rows read, applied and
rejected, and one entry per rejected row with its 1-based row number in the file and its reason.

The system SHALL answer with `roster_file_unusable`, applying nothing, when the submission cannot
be read as a roster file at all: its CSV syntax is invalid or its header omits a required column.
The response SHALL name what made the file unusable.

#### Scenario: A file with some bad rows is a success

- **WHEN** a coordinator submits a file of 200 rows of which 3 are rejected
- **THEN** the response is a success
- **AND** it reports 200 read, 197 applied and 3 rejected, with the row number and reason of each
  rejected row

#### Scenario: A file whose every row is rejected is still a success

- **WHEN** a coordinator submits a readable file whose every row is rejected
- **THEN** the response is a success reporting zero rows applied and one entry per rejected row
- **AND** an import record exists carrying those counts

#### Scenario: An unreadable file is an error and applies nothing

- **WHEN** a coordinator submits a file whose header omits `employee_number`, or a file that is not
  CSV at all
- **THEN** the response is an error with `roster_file_unusable` naming what made the file unusable
- **AND** no `person` row is created or changed and no import record is written

#### Scenario: The report is the same report the server command produces

- **WHEN** the same file is imported over HTTP and by the server command under the same scope
- **THEN** both report the same counts of rows read, applied and rejected
- **AND** both list the same rejected rows with the same row numbers and reasons

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

Issuing an invitation for an account SHALL revoke, in the same act, every invitation of that
account that is neither accepted nor already revoked. An account SHALL therefore have at most
one usable invitation at a time: the last one issued. A token that was replaced SHALL stop
being accepted from the moment its replacement exists, and SHALL remain readable as a revoked
row, because who tried to give access to whom is part of the record.

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

#### Scenario: Issuing a new invitation revokes the pending one

- **WHEN** an invitation is issued for an account that already has a `user_invitation` row
  whose `accepted_at` and `revoked_at` are both null
- **THEN** the earlier row has its `revoked_at` set
- **AND** accepting the earlier token is rejected and no `app_credential` row is created
- **AND** accepting the newly issued token creates the credential

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
when its `expires_at` passes, or when its credential is revoked.
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

### Requirement: People administration uses clear user-facing terminology

The system SHALL label the site people administration destination as “People” in navigation and “People & Access” in its page heading. User-facing actions, summaries, dialogs, empty states and account-management messages in that destination SHALL refer to people rather than a roster, while preserving the distinction between a person and an account.

#### Scenario: Coordinator opens people administration

- **WHEN** an H&S coordinator opens the site people administration destination
- **THEN** the navigation item is labeled “People”
- **AND** the page heading is “People & Access”

#### Scenario: Coordinator manages the people list

- **WHEN** an H&S coordinator imports, adds, searches or manages access for people at a site
- **THEN** the visible action and status text refers to people and access without using “roster” as the name of the destination or list

#### Scenario: Internal roster identifiers remain compatible

- **WHEN** the people administration terminology is displayed
- **THEN** the existing `/roster` route and roster API contracts remain unchanged

### Requirement: An active worker can be deactivated from the roster

The system SHALL allow an account whose `role` is `hs_coordinator` to deactivate an active
`person` with no active associated `app_user` by naming that person's `id`. This includes a person
with no account and one whose associated account is inactive. The operation SHALL set
`person.deactivated_at` to the server time and SHALL return the deactivated person. It SHALL never
delete the row.

The target SHALL be resolved under the session's site scope through the row-level security policy.
A person outside that scope SHALL be indistinguishable from a nonexistent person. The system
SHALL refuse a person who is already inactive or who has an active associated account, without
changing either row.

The roster interface SHALL offer this action only for an active row presented as `Worker`, whose
account is either `null` or inactive. It SHALL identify the action as destructive and SHALL require
explicit confirmation. After success, the default active roster SHALL no longer include the
person. The database SHALL record the existing `person.deactivated` audit event in the same
transaction.

#### Scenario: A coordinator deactivates an active worker in scope

- **WHEN** an `hs_coordinator` confirms deactivation of an active `person` in scope whose account is `null` or inactive
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

- **WHEN** a coordinator attempts to deactivate a person whose `deactivated_at` is already non-null
- **THEN** the request is refused
- **AND** the original `deactivated_at` remains unchanged

#### Scenario: A person outside the site scope is not disclosed

- **WHEN** a coordinator names a person outside the session's site scope
- **THEN** the request returns the same not-found response used for a nonexistent person
- **AND** no person row is changed

#### Scenario: Other roles cannot deactivate a worker

- **WHEN** an account whose `role` is `supervisor`, `jhsc_member`, `management` or `external_auditor` attempts to deactivate an active worker in its site scope
- **THEN** the request is refused
- **AND** the person remains active
