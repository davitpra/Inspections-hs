## ADDED Requirements

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
