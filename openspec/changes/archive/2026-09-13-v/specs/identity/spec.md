## RENAMED Requirements

- FROM: `### Requirement: Management can demote a coordinator to JHSC member`
- TO: `### Requirement: Management can demote a coordinator to inspector`

- FROM: `### Requirement: Management can promote a JHSC member to coordinator`
- TO: `### Requirement: Management can promote an inspector to coordinator`

- FROM: `### Requirement: The roster of a site is readable by the H&S coordinator`
- TO: `### Requirement: The roster of a site is readable by the coordinator`

- FROM: `### Requirement: The H&S coordinator can create an account over HTTP`
- TO: `### Requirement: The coordinator can create an account over HTTP`

- FROM: `### Requirement: A person on the roster can be invited as a JHSC member in one act`
- TO: `### Requirement: A person on the roster can be invited as an inspector in one act`

- FROM: `### Requirement: A coordinator can withdraw the JHSC access they granted`
- TO: `### Requirement: A coordinator can withdraw the inspector access they granted`

- FROM: `### Requirement: The H&S coordinator can import the roster over HTTP`
- TO: `### Requirement: The coordinator can import the roster over HTTP`


## MODIFIED Requirements

### Requirement: Administrative authority is held by the coordinator and by management

The system SHALL treat `coordinator` and `management` as the two administrative roles, holding
the same permissions as each other with exactly one asymmetry: deciding who holds the coordinator
role — promoting an account to it and demoting an account from it — which is management's alone.

Where a requirement of this or of any other capability names `coordinator` as the account
permitted to perform an administrative act — or restricts such an act to `coordinator` alone,
whether by naming it in the requirement text or by refusing "every other role" — that permission
SHALL be read as naming `management` equally, and the refusal SHALL be read as excluding
`inspector` only. This equivalence SHALL be stated in one place so that a later decision to
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
- **THEN** each request is accepted on the same terms as for a `coordinator` of that scope

#### Scenario: An inspector is still refused every administrative act

- **WHEN** an account whose `role` is `inspector` requests any of those acts
- **THEN** the request is refused, and nothing is created, changed or disclosed

#### Scenario: The site scope still bounds a management account

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only requests the
  roster of `glencoe`
- **THEN** the request is refused, and the refusal does not disclose whether `glencoe` exists

#### Scenario: A coordinator does not decide who holds the coordinator role

- **WHEN** an account whose `role` is `coordinator` promotes an `inspector` account or demotes
  a `coordinator` account
- **THEN** the request is refused, and the target account's `role` is unchanged

### Requirement: Management can demote a coordinator to inspector

The system SHALL let an account whose `role` is `management` change the `role` of an active account
from `coordinator` to `inspector`, and SHALL refuse that request to every other role, including
`coordinator`. A coordinator SHALL NOT be able to remove another coordinator, for the same reason
it cannot appoint one: the account that holds every administrative permission is never the account
that decides who else holds them.

The demotion SHALL be refused when the target account's current `role` is not `coordinator`,
when the target account is inactive, when the target account is outside the requesting account's
site scope, and when the requesting account is the target. A `management` account SHALL NOT be
demotable. Refusing it SHALL leave `app_user.role` unchanged.

The demotion SHALL be recorded as a `user.role_changed` entry naming the previous role, the new role
and the acting account, in the audit chain of every site in the demoted account's scope, written by
the database rather than by the endpoint.

Demoting SHALL NOT touch the account's `person_id`, `email`, site scope, credential, sessions or
invitations: the account is the same account, carrying a different role from that moment on. The
account SHALL lose its administrative authority on its next request, because the role of a session
is resolved from `app_user` at each request.

Demoting SHALL NOT interrupt the account's membership of the JHSC. A coordinator who was eligible as
`inspector_id` SHALL continue to be eligible once its role is `inspector`, without any further act, because both
roles are on the committee.

Demoting SHALL NOT alter any record related to the account rather than to its role: an action
assigned to its person, a finding it raised and an inspection it holds as `inspector_id` SHALL remain
as they were.

The roster SHALL offer the demotion to a `management` account on the row of an active
`coordinator` account, and SHALL confirm it before it is executed.

#### Scenario: Management demotes a coordinator

- **WHEN** an account whose `role` is `management` and whose scope contains `st-thomas` demotes an
  active `coordinator` account of `st-thomas`
- **THEN** that account's `role` is `inspector`
- **AND** a `user.role_changed` entry naming both roles and the acting account exists in the chain
  of every site in the demoted account's scope
- **AND** its `person_id`, `email` and site scope are unchanged

#### Scenario: A demoted coordinator keeps signing in

- **GIVEN** an active `coordinator` account holding an active credential and a live session
- **WHEN** an account whose `role` is `management` demotes it
- **THEN** its credential carries a null `revoked_at` and its `app_session` row carries a null
  `revoked_at`
- **AND** its next request with that session token is accepted

#### Scenario: A demoted coordinator loses administration on the next request

- **GIVEN** an active `coordinator` account whose scope contains `st-thomas`, holding a live
  session
- **WHEN** an account whose `role` is `management` demotes it
- **AND** that session requests the roster of `st-thomas`
- **THEN** the request is refused
- **AND** no `person` row is returned

#### Scenario: A coordinator cannot demote

- **WHEN** an account whose `role` is `coordinator` demotes another `coordinator` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An inspector cannot demote

- **WHEN** an account whose `role` is `inspector` demotes a `coordinator` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An account that is not a coordinator cannot be demoted

- **WHEN** an account whose `role` is `management` demotes an account whose `role` is `inspector`
  or `management`
- **THEN** the request is refused with a reason naming the current role
- **AND** that account's `role` is unchanged

#### Scenario: An inactive account cannot be demoted

- **WHEN** an account whose `role` is `management` demotes a `coordinator` account whose
  `deactivated_at` is non-null
- **THEN** the request is refused
- **AND** the account stays inactive with its `role` unchanged

#### Scenario: A demotion outside the site scope is refused

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only demotes a
  `coordinator` account scoped to `glencoe` alone
- **THEN** the request is refused
- **AND** that account's `role` is unchanged

#### Scenario: An account cannot demote itself

- **WHEN** an account whose `role` is `management` demotes its own account
- **THEN** the request is refused
- **AND** its `role` is unchanged

#### Scenario: A demoted coordinator keeps inspecting

- **GIVEN** an active `coordinator` account listed among the accounts eligible to be assigned an
  inspection at its site
- **WHEN** that account is demoted to `inspector`
- **THEN** it is still listed among the eligible accounts of that site
- **AND** assigning it as `inspector_id` of an inspection at that site is accepted

#### Scenario: The roster offers the demotion to management only

- **WHEN** the roster of a site is shown to an account whose `role` is `management`
- **THEN** the row of an active `coordinator` account offers the demotion, and no row of an
  `inspector` or `management` account does
- **AND** when the same roster is shown to an account whose `role` is `coordinator`, no row
  offers it

### Requirement: Committee membership follows the account role

The system SHALL derive membership of the Joint Health and Safety Committee from `app_user.role`
alone. Every account of the closed set — `inspector`, `coordinator` and `management` — SHALL be
on the committee for as long as it holds that role and is not deactivated.

The system SHALL NOT store, expose or accept any separate record of committee membership. There
SHALL be no column, request field, endpoint or console control that grants a seat, withdraws one, or
reports whether an account holds one, because there is nothing an account can be missing.

A change of `role` SHALL NOT interrupt membership, and SHALL NOT require a second act to restore it.

Audit entries of type `user.jhsc_seat_granted` and `user.jhsc_seat_withdrawn` already written to a
site's chain SHALL remain readable and unchanged: they record acts that happened. No new entry of
either type SHALL be written.

#### Scenario: Every role is on the committee

- **WHEN** an account whose `role` is `inspector`, one whose `role` is `coordinator` and one
  whose `role` is `management` are each considered for committee membership
- **THEN** all three are on the committee, with no further condition than an active account

#### Scenario: No account carries a seat value

- **WHEN** the accounts of a site are read
- **THEN** no account carries a record of a JHSC seat, held or not held, nor the moment one was
  granted

#### Scenario: A request to grant a seat is rejected

- **WHEN** a request to update an account asks to grant or withdraw a JHSC seat
- **THEN** the request is rejected as malformed before it reaches the account
- **AND** nothing about the account changes

#### Scenario: Past seat entries stay in the chain

- **GIVEN** a site whose audit chain contains a `user.jhsc_seat_granted` entry written before this
  change
- **WHEN** that chain is read
- **THEN** the entry is present and unchanged
- **AND** the chain verifies

### Requirement: Management can promote an inspector to coordinator

The system SHALL let an account whose `role` is `management` change the `role` of an active account
from `inspector` to `coordinator`, and SHALL refuse that request to every other role, including
`coordinator`. A coordinator SHALL NOT be able to appoint another coordinator, so that the
account that holds every administrative permission is never the account that decides who else holds
them.

The promotion and its inverse, the demotion of a coordinator to `inspector`, SHALL be the only
role changes the system exposes. The promotion SHALL be refused when the target
account's current `role` is not `inspector`, when the target account is inactive, when the target
account is outside the requesting account's site scope, and when the requesting account is the
target. Refusing it SHALL leave `app_user.role` unchanged.

The promotion SHALL be recorded as a `user.role_changed` entry naming the previous role, the new
role and the acting account, in the audit chain of every site in the promoted account's scope,
written by the database rather than by the endpoint.

Promoting SHALL NOT touch the account's `person_id`, `email`, site scope, credential, sessions or
invitations: the account is the same account, carrying a different role from that moment on.

Promoting SHALL NOT interrupt the account's membership of the JHSC. A member who inspected as
`inspector` SHALL continue to be eligible as `inspector_id` once its role is `coordinator`, without any
further act, because both roles are on the committee.

#### Scenario: Management promotes an inspector

- **WHEN** an account whose `role` is `management` and whose scope contains `st-thomas` promotes an
  active `inspector` account of `st-thomas`
- **THEN** that account's `role` is `coordinator`
- **AND** a `user.role_changed` entry naming both roles and the acting account exists in the chain
  of every site in the promoted account's scope
- **AND** its `person_id`, `email` and site scope are unchanged

#### Scenario: A coordinator cannot promote

- **WHEN** an account whose `role` is `coordinator` promotes an `inspector` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An inspector cannot promote

- **WHEN** an account whose `role` is `inspector` promotes another `inspector` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An account that is not an inspector cannot be promoted

- **WHEN** an account whose `role` is `management` promotes an account whose `role` is already
  `coordinator`
- **THEN** the request is refused with a reason naming the current role
- **AND** that account's `role` is unchanged

#### Scenario: An inactive account cannot be promoted

- **WHEN** an account whose `role` is `management` promotes an `inspector` account whose
  `deactivated_at` is non-null
- **THEN** the request is refused
- **AND** the account stays inactive with its `role` unchanged

#### Scenario: A promotion outside the site scope is refused

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only promotes an
  `inspector` account scoped to `glencoe` alone
- **THEN** the request is refused
- **AND** that account's `role` is unchanged

#### Scenario: A promoted member keeps inspecting

- **GIVEN** an active `inspector` account listed among the accounts eligible to be assigned an
  inspection at its site
- **WHEN** that account is promoted to `coordinator`
- **THEN** it is still listed among the eligible accounts of that site
- **AND** assigning it as `inspector_id` of an inspection at that site is accepted

#### Scenario: A promoted member can be demoted back

- **GIVEN** an `inspector` account that management promoted to `coordinator`
- **WHEN** an account whose `role` is `management` demotes it
- **THEN** its `role` is `inspector` again
- **AND** two `user.role_changed` entries, one per change, exist in the chain of every site in its
  scope

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

The system SHALL NOT expose any way to rename, transfer, reactivate or delete a single `person`
through this listing or any companion route. It SHALL expose only the constrained deactivation of
an active person with no account described separately below. Creating a person that does not exist
yet SHALL be available as its own act, and loading the file itself SHALL remain available as a
separate act that names no person and applies the whole file at once.
Creating a person that does not exist yet SHALL be available as its own act, and loading the
file itself SHALL remain available, as a separate act that names no person and applies the
whole file at once.

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

### Requirement: A person can be added to the roster one at a time

The system SHALL allow an account whose `role` is `coordinator` to create a single `person`
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

- **WHEN** an account whose `role` is `coordinator` and whose scope contains `st-thomas`
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

#### Scenario: An inspector is refused

- **WHEN** an account whose `role` is `inspector` creates a person on a site within its own scope
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

### Requirement: The coordinator can create an account over HTTP

The system SHALL expose a request that creates an `app_user` row and its `user_site_scope`
rows for a person who already exists on the roster, available only to a session whose `role`
is administrative. It SHALL be refused for `inspector`, and refusing it SHALL create neither
the account nor any scope row.

The request SHALL name the person by `id`, the account's email, its role and the sites of its
scope. The role SHALL be one of the three of the closed set; the request SHALL NOT carry an expiry
or a record date window, because no role has one. The account and its scope rows SHALL be created in a single transaction under the
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
is outside the scope of the requesting account.

#### Scenario: An administrative account creates an account for a person on the roster

- **WHEN** a `coordinator` or a `management` account whose scope contains `st-thomas` requests
  an account for a person of `st-thomas` with a role and that site
- **THEN** an `app_user` row and one `user_site_scope` row are created
- **AND** an audit entry naming the new account exists in the chain of `st-thomas`
- **AND** the account cannot sign in

#### Scenario: An inspector is refused

- **WHEN** an account whose `role` is `inspector` requests the creation of an account
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

- **WHEN** an `inspector` account is requested for a person whose existing inactive account
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

### Requirement: A person on the roster can be invited as an inspector in one act

The system SHALL let an administrative account turn a person of the roster who has no access into an
invited `inspector` in a single act: the account is created with role `inspector`, scoped
to the site whose roster is being read, and an invitation is issued for it. The one-time
invitation token SHALL be returned to the coordinator exactly once and SHALL NOT be readable
afterwards, which is the same rule the invitation already carries.

A person whose `inspector` account was withdrawn SHALL be invitable through this same act,
which restores the account they already had. The coordinator SHALL NOT be asked to tell the
two cases apart, and the roster SHALL NOT present them differently.

The act SHALL be atomic: the account, its scope and the invitation SHALL all exist or none of
them SHALL. A failure SHALL leave the person without access, so that pressing the button
again is a valid retry and not a request the system refuses for a state it created itself.

Only `inspector` SHALL be reachable this way. Every other role SHALL remain outside this act,
because the scope and the validity window they need are not expressible in it.

#### Scenario: Inviting a person without an account

- **WHEN** a `coordinator` invites a person of `st-thomas` who holds no account
- **THEN** an account with role `inspector` scoped to `st-thomas` is created for that person
- **AND** an invitation is issued for it and its one-time token is returned once
- **AND** reading the roster again reports that person as holding an `inspector` account that
  cannot yet sign in

#### Scenario: Inviting a person whose access was withdrawn

- **WHEN** a `coordinator` invites a person whose `inspector` account is inactive
- **THEN** that same account is restored and an invitation is issued for it
- **AND** accepting that invitation creates a credential and the account can sign in

#### Scenario: Inviting a person who already holds an active account is refused

- **WHEN** a `coordinator` invites a person that an active `app_user` row already
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

### Requirement: A coordinator can withdraw the inspector access they granted

The system SHALL let an administrative account withdraw, from the roster of the site the account is
scoped to, the access of an active `inspector` account. Withdrawing SHALL revoke the
account's pending invitation, revoke its credential, and set its `deactivated_at`, as one act
that either happens whole or not at all.

The same act SHALL serve an account that never signed in and one that signs in every day: an
invitation nobody accepted and a member leaving the committee are the same fact — this account
no longer grants access — and the system SHALL NOT offer two different withdrawals for it.
What SHALL differ is how the act is named and confirmed, because cancelling an invitation
makes a link stop working while removing a member ends a session that may be open.

Withdrawing SHALL be confirmed before it is executed, and SHALL be refused for an account
whose role is not `inspector`: the roster administers the access the roster grants, and
removing another administrative account is not a press away in a list of two hundred rows.

Withdrawing an account that is already inactive SHALL be refused, so that the recorded
`deactivated_at` stays the moment the access actually ended.

Withdrawing SHALL NOT deactivate the person: losing access is not leaving the company, and the
roster is maintained by the CSV import.

#### Scenario: A pending invitation is cancelled

- **WHEN** a `coordinator` withdraws the access of an `inspector` account that holds a
  pending invitation and no credential
- **THEN** the invitation carries a non-null `revoked_at` and its token is no longer accepted
- **AND** the account carries a non-null `deactivated_at` and is reported as inactive

#### Scenario: A member who signs in loses access

- **WHEN** a `coordinator` withdraws the access of an `inspector` account that holds an
  active credential and a live session
- **THEN** the credential carries a non-null `revoked_at` and the account cannot sign in again
- **AND** the `app_session` row carries a non-null `revoked_at`

#### Scenario: The person stays on the roster

- **WHEN** a `coordinator` withdraws the access of an `inspector` account
- **THEN** the referenced `person` row's `deactivated_at` is unchanged

#### Scenario: An inspector cannot withdraw access

- **WHEN** an `inspector` withdraws the access of another account
- **THEN** the request is refused and the account stays active

#### Scenario: Withdrawing twice is refused

- **WHEN** a `coordinator` withdraws the access of an account that is already inactive
- **THEN** the request is refused and the recorded `deactivated_at` is unchanged

#### Scenario: An account outside the coordinator's scope cannot be withdrawn

- **WHEN** a `coordinator` withdraws the access of an account of a person outside every
  site of their scope
- **THEN** the request is refused and the account stays active

#### Scenario: Only an administrative account can withdraw access

- **WHEN** an account whose role is `inspector` withdraws another account's access
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

- **WHEN** a `coordinator` withdraws the access of an account scoped to two sites
- **THEN** each of the two sites' chains carries one `user.deactivated` entry for that account
- **AND** each entry names the coordinator as the acting account, not the withdrawn one

#### Scenario: The scope survives the withdrawal

- **WHEN** a `coordinator` withdraws the access of an account scoped to two sites
- **THEN** both `user_site_scope` rows still carry a null `revoked_at`

#### Scenario: The kept scope grants nothing

- **WHEN** a withdrawn account whose `user_site_scope` rows are live presents its credentials
- **THEN** no session is established

### Requirement: A coordinator can read the administrable detail of an account in their scope

The system SHALL let the coordinator read one account of a person in their site scope,
reduced to what administering it requires: its `id`, `role`, whether it is active, whether it
can sign in, and its `email`. This SHALL NOT be the roster listing: the roster SHALL continue
to omit every account's `email`, scope and credential, and this reading exists precisely
because correcting an email needs to show the coordinator what is registered today.

#### Scenario: The coordinator reads an account in scope

- **WHEN** a `coordinator` reads the account of a person in a site of their scope
- **THEN** the account is returned with its `id`, `role`, `active`, `can_sign_in` and `email`

#### Scenario: An account outside the coordinator's scope is not readable

- **WHEN** a `coordinator` reads an account of a person outside every site of their scope
- **THEN** no account is returned

#### Scenario: Only the coordinator can read this detail

- **WHEN** an account whose role is not `coordinator` reads another account's detail
- **THEN** the request is refused

### Requirement: A coordinator can reissue the invitation of an account that never signed in

The system SHALL let the coordinator issue a new invitation, from the roster of the site
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

- **WHEN** a `coordinator` reissues the invitation of an account that holds no
  `app_credential` and whose `deactivated_at` is null
- **THEN** a new `user_invitation` row is created for that account and its one-time token is
  returned once
- **AND** the account still reports that it cannot sign in until the new invitation is accepted

#### Scenario: Reissuing corrects a mistyped email in the same act

- **WHEN** a `coordinator` reissues the invitation of an account that holds no
  `app_credential`, supplying an `email` different from the one on file and not used by any
  other account
- **THEN** the account's `email` is updated to the supplied value
- **AND** a new invitation is issued for that account
- **AND** an audit entry carrying the previous and the new `email` exists for every site in
  the account's scope

#### Scenario: Correcting the email to one already taken is refused

- **WHEN** a `coordinator` reissues the invitation of an account, supplying an `email`
  that already belongs to another account
- **THEN** the request is refused
- **AND** the account's `email` is unchanged
- **AND** no new `user_invitation` row is created and the existing one, if any, is unchanged

#### Scenario: Reissuing for an account that can already sign in is refused

- **WHEN** a `coordinator` reissues the invitation of an account that holds an
  `app_credential` whose `revoked_at` is null
- **THEN** the request is refused and no `user_invitation` row is created
- **AND** the existing `app_credential` is unchanged

#### Scenario: Correcting the email of an account that can already sign in is refused

- **WHEN** a `coordinator` attempts to reissue and correct the `email` of an account that
  holds an `app_credential` whose `revoked_at` is null
- **THEN** the request is refused and the account's `email` is unchanged

#### Scenario: Withdrawing an account that can already sign in is allowed

- **WHEN** a `coordinator` withdraws the access of an `inspector` account that holds an
  `app_credential` whose `revoked_at` is null
- **THEN** the act is carried out and the account is reported as inactive

#### Scenario: Reissuing for a deactivated account is refused

- **WHEN** a `coordinator` reissues the invitation of an account whose `deactivated_at` is
  set
- **THEN** the request is refused and no `user_invitation` row is created

#### Scenario: Only the coordinator can reissue

- **WHEN** an account whose role is not `coordinator` reissues an invitation
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

### Requirement: An account carries exactly one role from a closed set

The system SHALL store `app_user.role` as a mandatory value restricted by the database to
`coordinator`, `inspector` and `management`. An account
SHALL carry exactly one role: the schema SHALL NOT allow a set, a list or a second role row.

`inspector` SHALL be the single role of the committee members who hold no administrative
authority. The account assigned to carry out an inspection SHALL continue to be referenced by
`inspection.inspector_id`, which is a field and not a permission: an account of any of the three
roles MAY be assigned, and being assigned SHALL NOT change its role.

`hs_coordinator` and `jhsc_member` SHALL NOT be accepted as role values. No account SHALL be able to
be created, restored or changed into either of them. Every account that carried one of them SHALL
carry `coordinator` or `inspector` respectively, with its scope, credentials, sessions and history
otherwise unchanged.

`supervisor` and `external_auditor` SHALL NOT be accepted as role values. No account SHALL be able
to be created, restored or changed into either of them.

#### Scenario: A role outside the closed set is rejected

- **WHEN** an `app_user` row is inserted with `role` set to `jhsc_member`
- **THEN** the insert fails with a check violation

#### Scenario: A retired role name is rejected

- **WHEN** an `app_user` row is inserted with `role` set to `hs_coordinator`
- **THEN** the insert fails with a check violation

#### Scenario: Existing accounts carry the renamed roles

- **GIVEN** an account whose `role` was `hs_coordinator` and one whose `role` was `jhsc_member`
  before this change, each holding an active credential and a site scope
- **WHEN** their accounts are read after the change
- **THEN** the first carries `role` `coordinator` and the second `role` `inspector`
- **AND** both keep their credential, their site scope and their `id`

#### Scenario: A null role is rejected

- **WHEN** an `app_user` row is inserted with a null `role`
- **THEN** the insert fails with a not-null violation

#### Scenario: Each of the three roles is accepted

- **WHEN** an `app_user` row is inserted for each of `coordinator`, `inspector`,
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

### Requirement: Registering a site grants its scope to the account that registered it

The system SHALL, in the same transaction that registers a `site`, store an active
`user_site_scope` row whose `user_id` is the registering account and whose `site_id` is the
registered site. The registration and the grant SHALL be atomic: neither SHALL be stored without
the other.

The system SHALL grant that scope to the registering account only. It SHALL NOT alter the scope of
any other account as a consequence of a site registration.

#### Scenario: The registrant reaches the site it registered

- **WHEN** a coordinator registers a site
- **THEN** a `user_site_scope` row exists whose `user_id` is that account and whose `site_id` is the
  registered site
- **AND** its `revoked_at` is null
- **AND** its `granted_at` is set

#### Scenario: The registrant's next request carries the new site

- **GIVEN** a coordinator has registered a site
- **WHEN** that account's session scope is resolved for its next request
- **THEN** the registered site is among the sites the session reaches

#### Scenario: A failed grant leaves no site behind

- **WHEN** the `user_site_scope` insert cannot complete after the `site` row has been inserted
- **THEN** the transaction rolls back
- **AND** no `site` row with the submitted `code` is stored
- **AND** no `user_site_scope` row for the submitted site is stored

#### Scenario: No other account gains the new site

- **GIVEN** a second account whose role is `coordinator` and whose scope covers St. Thomas only
- **WHEN** another coordinator registers a site
- **THEN** the second account's active `user_site_scope` rows are unchanged
- **AND** the registered site is absent from the second account's site list

#### Scenario: The grant is recorded on the new site's chain

- **WHEN** a coordinator registers a site
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

- **WHEN** a coordinator deactivates a site
- **THEN** no `user_site_scope` row for any account is inserted, deleted or revoked as a side effect

### Requirement: Site scope decides what an account can see, without any endpoint filtering

The system SHALL derive the `app.site_ids` of a transaction from the acting account's effective
scope, and SHALL rely on the row-level security policies of the site-isolated tables for the
resulting visibility. No endpoint SHALL filter by site in its query.

An `inspector` SHALL normally hold one site; `coordinator` and `management`
SHALL be the roles that hold both. This SHALL be a property of the scope rows granted to the
account, not of the role value: the role does not by itself widen or narrow what is visible.

#### Scenario: A single-site member does not see the other workplace

- **WHEN** a transaction runs with the scope of an `inspector` account granted only `st-thomas`
- **THEN** reads of `person`, `location` and every other site-isolated table return only rows of
  `st-thomas`

#### Scenario: The coordinator sees both workplaces

- **WHEN** a transaction runs with the scope of a `coordinator` account granted both sites
- **THEN** reads of site-isolated tables return rows of both sites

#### Scenario: The role alone grants nothing

- **WHEN** an account with role `coordinator` has no active `user_site_scope` row
- **THEN** its effective scope is empty and reads of site-isolated tables return no rows

### Requirement: The coordinator can import the roster over HTTP

The system SHALL let an account whose `role` is `coordinator` import a roster CSV over HTTP by
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

- **WHEN** an account whose `role` is `coordinator` and whose scope contains `st-thomas`
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

#### Scenario: An inspector is refused

- **WHEN** an account whose `role` is `inspector` submits a roster CSV
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

### Requirement: An account gains the ability to sign in only through an invitation

The system SHALL create the credential of an account only from a `user_invitation` row issued by
an administrative account. There SHALL be no self-registration, no open sign-up
form and no path by which an `app_user` row acquires a credential without an invitation having
been issued for it and accepted.

An invitation SHALL carry `user_id`, `issued_by_user_id`, `issued_at`, `expires_at`, a nullable
`accepted_at` and a nullable `revoked_at`. It SHALL be issued only for an existing `app_user` row
that has no credential yet.

#### Scenario: The coordinator invites an account that has no credential

- **WHEN** a `coordinator` session issues an invitation for an `app_user` row that has no
  `app_credential`
- **THEN** a `user_invitation` row is created carrying that `user_id` and the coordinator's
  `app_user.id` as `issued_by_user_id`

#### Scenario: An inspector cannot invite

- **WHEN** a session whose account `role` is `inspector` issues an invitation
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

- **WHEN** a client displays the role of an account whose `role` is `inspector`
- **THEN** it shows `Inspector`
- **AND** an account whose `role` is `coordinator` shows `Coordinator`, and one whose `role` is
  `management` shows `Management`
- **AND** no client shows `JHSC member` or `H&S coordinator` as the name of a role

#### Scenario: A changed role takes effect on the next request

- **WHEN** an account's `role` is changed from `inspector` to `coordinator`
- **AND** the same unexpired session token is used for a subsequent request
- **THEN** the resolved `role` is `coordinator`

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

- **WHEN** a request carries a role in its query, body or headers claiming `coordinator` for an
  `inspector` account
- **THEN** the transaction's `app.role` is `inspector`
- **AND** no row the elevated role would have unlocked is returned

#### Scenario: The role does not survive the transaction

- **WHEN** a transaction that declared `app.role` completes and its connection is reused by a
  request that declares none
- **THEN** the second transaction reads no `app.role`
- **AND** it sees no row that depends on one

#### Scenario: A single-site member reaches only their own workplace

- **WHEN** an `inspector` account granted only `st-thomas` reads a site-isolated table through an
  authenticated request
- **THEN** only rows of `st-thomas` are returned, and no route filtered by site to achieve it

### Requirement: A session ends when the account loses the right to hold it

The system SHALL revoke every live `app_session` of an account when the account is deactivated or
when its credential is revoked.
Revocation SHALL be expressed by setting `app_session.revoked_at`, never by deleting the row, and
a revoked session SHALL NOT be renewable.

An account SHALL also be able to end its own sessions, and a `coordinator` session SHALL be
able to end another account's.

#### Scenario: Deactivating an account ends its sessions

- **WHEN** `deactivated_at` is set on an account holding a live session
- **THEN** the next request with that session token is rejected
- **AND** the `app_session` row carries a non-null `revoked_at`

#### Scenario: The holder signs out

- **WHEN** an account signs out
- **THEN** its `app_session` row carries a non-null `revoked_at` and the token is no longer
  accepted

#### Scenario: The coordinator ends another account's session

- **WHEN** a `coordinator` session revokes the sessions of another account
- **THEN** that account's live sessions are revoked and its tokens are no longer accepted

#### Scenario: A session row is never deleted

- **WHEN** any role attempts to delete an `app_session` row
- **THEN** the attempt fails and the row is still present when read back

### Requirement: People administration uses clear user-facing terminology

The system SHALL label the site people administration destination as “People” in navigation and “People & Access” in its page heading. User-facing actions, summaries, dialogs, empty states and account-management messages in that destination SHALL refer to people rather than a roster, while preserving the distinction between a person and an account.

#### Scenario: Coordinator opens people administration

- **WHEN** a coordinator opens the site people administration destination
- **THEN** the navigation item is labeled “People”
- **AND** the page heading is “People & Access”

#### Scenario: Coordinator manages the people list

- **WHEN** a coordinator imports, adds, searches or manages access for people at a site
- **THEN** the visible action and status text refers to people and access without using “roster” as the name of the destination or list

#### Scenario: Internal roster identifiers remain compatible

- **WHEN** the people administration terminology is displayed
- **THEN** the existing `/roster` route and roster API contracts remain unchanged

### Requirement: An active worker can be deactivated from the roster

The system SHALL allow an account whose `role` is `coordinator` to deactivate an active
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

- **WHEN** a `coordinator` confirms deactivation of an active `person` in scope whose account is `null` or inactive
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

#### Scenario: An inspector cannot deactivate a worker

- **WHEN** an account whose `role` is `inspector` attempts to deactivate an active worker in its site scope
- **THEN** the request is refused
- **AND** the person remains active
