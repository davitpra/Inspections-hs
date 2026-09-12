## ADDED Requirements

### Requirement: Committee membership follows the account role

The system SHALL derive membership of the Joint Health and Safety Committee from `app_user.role`
alone. Every account of the closed set — `jhsc_member`, `hs_coordinator` and `management` — SHALL be
on the committee for as long as it holds that role and is not deactivated.

The system SHALL NOT store, expose or accept any separate record of committee membership. There
SHALL be no column, request field, endpoint or console control that grants a seat, withdraws one, or
reports whether an account holds one, because there is nothing an account can be missing.

A change of `role` SHALL NOT interrupt membership, and SHALL NOT require a second act to restore it.

Audit entries of type `user.jhsc_seat_granted` and `user.jhsc_seat_withdrawn` already written to a
site's chain SHALL remain readable and unchanged: they record acts that happened. No new entry of
either type SHALL be written.

#### Scenario: Every role is on the committee

- **WHEN** an account whose `role` is `jhsc_member`, one whose `role` is `hs_coordinator` and one
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

## MODIFIED Requirements

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

Promoting SHALL NOT interrupt the account's membership of the JHSC. A member who inspected as
`jhsc_member` SHALL continue to be eligible as `inspector_id` as `hs_coordinator`, without any
further act, because both roles are on the committee.

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

#### Scenario: A promoted member keeps inspecting

- **GIVEN** an active `jhsc_member` account listed among the accounts eligible to be assigned an
  inspection at its site
- **WHEN** that account is promoted to `hs_coordinator`
- **THEN** it is still listed among the eligible accounts of that site
- **AND** assigning it as `inspector_id` of an inspection at that site is accepted

## REMOVED Requirements

### Requirement: An `hs_coordinator` account can hold a seat on the JHSC

**Reason**: The seat existed because committee membership and the `jhsc_member` role coincided for
the seven members but not for the coordinator, and `app_user.person_id` is UNIQUE so she could not
hold a second account. Deriving membership from the role covers every account in the closed set and
removes the second path, and with it the moment the two can disagree.

**Migration**: `app_user.jhsc_seat_granted_at` and its `CHECK` are dropped. No row is converted:
every account that held a seat remains on the committee by its role, and every administrative
account that held none joins it. Audit entries already written stay in the chain.

### Requirement: A coordinator can take and leave a seat on the JHSC from the roster

**Reason**: There is no seat to take or leave. The act it describes — a solitary, audited update of
`jhsc_seat_granted_at` from the roster — has no state left to change.

**Migration**: `PATCH /accounts/:id` no longer accepts `jhsc_seat`, and a request carrying it is
rejected as malformed. The roster's Join/Leave JHSC control and its confirmation are withdrawn.

### Requirement: The roster reports whether an account holds a JHSC seat

**Reason**: The roster reported a fact that is now implied by the role it already reports, in the
same cell.

**Migration**: The account of a roster row no longer carries a seat field. A reader asking who is on
the committee reads the role.
