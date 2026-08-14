## ADDED Requirements

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
without their own credential in the loop.

An account that is deactivated or expired SHALL NOT be reissued an invitation.

The roster SHALL offer, on each row, the act that its state admits and no other: inviting the
person when they hold no account, reissuing when they hold an account that is active and
cannot yet sign in, and neither when the account can already sign in. The reissue SHALL be
confirmed before it is issued, because it makes the previous link stop working.

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

#### Scenario: A row of an invited account offers a new link

- **WHEN** the roster reports a person whose account is active and cannot sign in
- **THEN** the row offers reissuing the invitation
- **AND** the row does not offer inviting that person again

#### Scenario: A row of an account in use offers nothing

- **WHEN** the roster reports a person whose account can sign in
- **THEN** the row offers neither inviting nor reissuing

## MODIFIED Requirements

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
