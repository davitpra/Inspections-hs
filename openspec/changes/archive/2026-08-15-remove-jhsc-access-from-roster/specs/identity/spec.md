## ADDED Requirements

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

## MODIFIED Requirements

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
