## ADDED Requirements

### Requirement: Administrative authority is held by the coordinator and by management

The system SHALL treat `hs_coordinator` and `management` as the two administrative roles, holding
the same permissions as each other with exactly one asymmetry: promoting an account, which is
management's alone.

Where a requirement of this or of any other capability names `hs_coordinator` as the account
permitted to perform an administrative act — or restricts such an act to `hs_coordinator` alone,
whether by naming it in the requirement text or by refusing "every other role" — that permission
SHALL be read as naming `management` equally, and the refusal SHALL be read as excluding
`jhsc_member` only. This equivalence SHALL be stated in one place so that a later decision to
separate the two roles changes one requirement rather than every requirement that names an
administrative act.

The equivalence SHALL NOT extend to anything derived from a relation to a particular record rather
than from the role: being the person assigned to a corrective action, being the account that raised
a finding, and being the inspector of an inspection SHALL continue to be resolved against the
account and the person, not against the role.

#### Scenario: A management account administers what a coordinator administers

- **WHEN** an account whose `role` is `management` and whose scope contains `st-thomas` requests
  the roster of `st-thomas`, creates a person, imports a roster file, creates an account, issues an
  invitation, saves or publishes a template, registers or renames a site, administers a location, or
  administers the annual plan of that site
- **THEN** each request is accepted on the same terms as for an `hs_coordinator` of that scope

#### Scenario: A JHSC member is still refused every administrative act

- **WHEN** an account whose `role` is `jhsc_member` requests any of those acts
- **THEN** the request is refused, and nothing is created, changed or disclosed

#### Scenario: The site scope still bounds a management account

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only requests the
  roster of `glencoe`
- **THEN** the request is refused, and the refusal does not disclose whether `glencoe` exists

### Requirement: Management can promote a JHSC member to coordinator

The system SHALL let an account whose `role` is `management` change the `role` of an active account
from `jhsc_member` to `hs_coordinator`, and SHALL refuse that request to every other role, including
`hs_coordinator`. A coordinator SHALL NOT be able to appoint another coordinator, so that the
account that holds every administrative permission is never the account that decides who else holds
them.

The promotion SHALL be the only role change the system exposes. It SHALL be refused when the target
account's current `role` is not `jhsc_member`, when the target account is inactive, when the target
account is outside the requesting account's site scope, and when the requesting account is the
target. Refusing it SHALL leave `app_user.role` unchanged.

The promotion SHALL be recorded as a `user.role_changed` entry naming the previous role, the new
role and the acting account, in the audit chain of every site in the promoted account's scope,
written by the database rather than by the endpoint.

Promoting SHALL NOT touch the account's `person_id`, `email`, site scope, credential, sessions or
invitations: the account is the same account, carrying a different role from that moment on.

A promoted account SHALL NOT carry a JHSC seat as a side effect. The seat SHALL be granted as its
own recorded act, so that a member who inspected as `jhsc_member` and continues to inspect as
`hs_coordinator` has a seat that was granted deliberately.

#### Scenario: Management promotes a JHSC member

- **WHEN** an account whose `role` is `management` and whose scope contains `st-thomas` promotes an
  active `jhsc_member` account of `st-thomas`
- **THEN** that account's `role` is `hs_coordinator`
- **AND** a `user.role_changed` entry naming both roles and the acting account exists in the chain
  of every site in the promoted account's scope
- **AND** its `person_id`, `email` and site scope are unchanged

#### Scenario: A coordinator cannot promote

- **WHEN** an account whose `role` is `hs_coordinator` promotes a `jhsc_member` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: A JHSC member cannot promote

- **WHEN** an account whose `role` is `jhsc_member` promotes another `jhsc_member` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An account that is not a JHSC member cannot be promoted

- **WHEN** an account whose `role` is `management` promotes an account whose `role` is already
  `hs_coordinator`
- **THEN** the request is refused with a reason naming the current role
- **AND** that account's `role` is unchanged

#### Scenario: An inactive account cannot be promoted

- **WHEN** an account whose `role` is `management` promotes a `jhsc_member` account whose
  `deactivated_at` is non-null
- **THEN** the request is refused
- **AND** the account stays inactive with its `role` unchanged

#### Scenario: A promotion outside the site scope is refused

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only promotes a
  `jhsc_member` account scoped to `glencoe` alone
- **THEN** the request is refused
- **AND** that account's `role` is unchanged

#### Scenario: Promotion grants no seat

- **WHEN** a `jhsc_member` account is promoted to `hs_coordinator`
- **THEN** its `jhsc_seat_granted_at` is null
- **AND** no `user.jhsc_seat_granted` entry is written

## MODIFIED Requirements

### Requirement: An account carries exactly one role from a closed set

The system SHALL store `app_user.role` as a mandatory value restricted by the database to
`hs_coordinator`, `jhsc_member` and `management`. An account SHALL carry exactly one role: the
schema SHALL NOT allow a set, a list or a second role row.

`jhsc_member` SHALL be the single term for the people who carry out inspections; `inspector` SHALL
NOT appear as a role value.

`supervisor` and `external_auditor` SHALL NOT be accepted as role values. No account SHALL be able
to be created, restored or changed into either of them.

#### Scenario: A role outside the closed set is rejected

- **WHEN** an `app_user` row is inserted with `role` set to `inspector`
- **THEN** the insert fails with a check violation

#### Scenario: A null role is rejected

- **WHEN** an `app_user` row is inserted with a null `role`
- **THEN** the insert fails with a not-null violation

#### Scenario: Each of the three roles is accepted

- **WHEN** an `app_user` row is inserted for each of `hs_coordinator`, `jhsc_member` and
  `management`
- **THEN** all three inserts succeed

#### Scenario: A withdrawn role is rejected

- **WHEN** an `app_user` row is inserted with `role` set to `supervisor` or to `external_auditor`
- **THEN** the insert fails with a check violation

#### Scenario: A role change is recorded, not silently applied

- **WHEN** a session connected as the application role changes an account's `role`
- **THEN** the statement succeeds
- **AND** an audit entry naming the previous and the new role exists for every site in the
  account's scope

### Requirement: An `hs_coordinator` account can hold a seat on the JHSC

The system SHALL record on `app_user` whether the account holds a seat on the Joint Health and
Safety Committee, as `jhsc_seat_granted_at`: null when the account holds no seat, and the moment
the seat was granted when it does.

The seat SHALL be a position an account occupies, not a role: taking or leaving a seat SHALL NOT
change `app_user.role`, and the closed set of three roles SHALL be unaffected.

The database SHALL restrict a non-null `jhsc_seat_granted_at` to accounts whose `role` is
`hs_coordinator` or `management` — the two administrative roles, which are the accounts that may sit
on the committee without already being it. A `jhsc_member` SHALL NOT carry a seat value, because
that role already IS the seat, and no other role SHALL be able to acquire one.

Granting and withdrawing a seat SHALL each be recorded in the audit log of every site in the
account's scope, as `user.jhsc_seat_granted` and `user.jhsc_seat_withdrawn`, naming the acting
account.

Holding or losing a seat SHALL NOT change what the account may sign in to: it SHALL NOT create,
revoke or expire a credential, a session or an invitation.

#### Scenario: A seat on a JHSC member's account is rejected

- **WHEN** an `app_user` row whose `role` is `jhsc_member` is written with a non-null
  `jhsc_seat_granted_at`
- **THEN** the write fails with a check violation

#### Scenario: A seat on a management account is accepted

- **WHEN** an `app_user` row whose `role` is `management` is written with a non-null
  `jhsc_seat_granted_at`
- **THEN** the write succeeds

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

### Requirement: The H&S coordinator can create an account over HTTP

The system SHALL expose a request that creates an `app_user` row and its `user_site_scope`
rows for a person who already exists on the roster, available only to a session whose `role`
is administrative. It SHALL be refused for `jhsc_member`, and refusing it SHALL create
neither the account nor any scope row.

The request SHALL name the person by `id`, the account's email, its role and the sites of its
scope. The role SHALL be one of the three of the closed set; the request SHALL NOT carry an expiry
or a record date window, because no role has one. The account and its scope rows SHALL be created in
a single transaction under the declared audit actor, so that the audit entry for the new account
exists in the chain of every site in its scope or the account is not created at all.

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
is outside the scope of the requesting account.

#### Scenario: An administrative account creates an account for a person on the roster

- **WHEN** an `hs_coordinator` or a `management` account whose scope contains `st-thomas` requests
  an account for a person of `st-thomas` with a role and that site
- **THEN** an `app_user` row and one `user_site_scope` row are created
- **AND** an audit entry naming the new account exists in the chain of `st-thomas`
- **AND** the account cannot sign in

#### Scenario: A JHSC member is refused

- **WHEN** an account whose `role` is `jhsc_member` requests the creation of an account
- **THEN** the request is refused
- **AND** no `app_user` row is created

#### Scenario: A withdrawn role is refused as the role of a new account

- **WHEN** an account is requested with `role` `supervisor` or `external_auditor`
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
  carries the role `management`
- **THEN** the request is refused
- **AND** that account stays inactive and its role is unchanged

#### Scenario: An email that belongs to another account is refused

- **WHEN** an account is requested with an email that another account already carries
- **THEN** the request is refused
- **AND** no `app_user` row is created

#### Scenario: A site outside the requesting account's own scope is refused

- **WHEN** an administrative account whose scope is `st-thomas` only requests an account scoped to
  `glencoe`
- **THEN** the request is refused
- **AND** neither the account nor its scope row is created

#### Scenario: Creating an account creates no credential

- **WHEN** an account is created
- **THEN** no `app_credential` row exists for it
- **AND** signing in with any password is refused until an invitation is accepted

## REMOVED Requirements

### Requirement: An external auditor account expires, and cannot be created without an expiry

**Reason**: The `external_auditor` role is withdrawn from the closed set, so the lifecycle it
governed has no account that can carry it. No account of that role was ever created: the only
account-creation path the product exposes issues `jhsc_member`, and no database holds one. The
columns `expires_at`, `records_from` and `records_to`, together with the `app_user_auditor_lifecycle`
check, are dropped from `app_user`.

**Migration**: None. No row carries a non-null value in any of the three columns, and the migration
aborts rather than dropping a column that holds data. An external audit is served by reading the
records with a coordinator or management account, whose reads are not date-bounded. If a bounded
read-only account is needed again, it returns as its own change with its own requirement.

### Requirement: An external auditor's session is bounded by its record window

**Reason**: Removed with the role it bounded. The `hs_apply_record_window` policy over `audit_log`
and the two settings readers it consults have no session that sets `app.records_from` or
`app.records_to` once no account carries a window, so the policy would restrict nothing while still
being evaluated on every read of the audit chain.

**Migration**: None. Every surviving role already reads its full history within its site scope, which
is what the policy resolved to for every role but the auditor. Site isolation is unchanged and
continues to be enforced by the row-level security policies of ADR-004.
