## ADDED Requirements

### Requirement: Management can demote a coordinator to JHSC member

The system SHALL let an account whose `role` is `management` change the `role` of an active account
from `hs_coordinator` to `jhsc_member`, and SHALL refuse that request to every other role, including
`hs_coordinator`. A coordinator SHALL NOT be able to remove another coordinator, for the same reason
it cannot appoint one: the account that holds every administrative permission is never the account
that decides who else holds them.

The demotion SHALL be refused when the target account's current `role` is not `hs_coordinator`,
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
`inspector_id` SHALL continue to be eligible as `jhsc_member`, without any further act, because both
roles are on the committee.

Demoting SHALL NOT alter any record related to the account rather than to its role: an action
assigned to its person, a finding it raised and an inspection it holds as `inspector_id` SHALL remain
as they were.

The roster SHALL offer the demotion to a `management` account on the row of an active
`hs_coordinator` account, and SHALL confirm it before it is executed.

#### Scenario: Management demotes a coordinator

- **WHEN** an account whose `role` is `management` and whose scope contains `st-thomas` demotes an
  active `hs_coordinator` account of `st-thomas`
- **THEN** that account's `role` is `jhsc_member`
- **AND** a `user.role_changed` entry naming both roles and the acting account exists in the chain
  of every site in the demoted account's scope
- **AND** its `person_id`, `email` and site scope are unchanged

#### Scenario: A demoted coordinator keeps signing in

- **GIVEN** an active `hs_coordinator` account holding an active credential and a live session
- **WHEN** an account whose `role` is `management` demotes it
- **THEN** its credential carries a null `revoked_at` and its `app_session` row carries a null
  `revoked_at`
- **AND** its next request with that session token is accepted

#### Scenario: A demoted coordinator loses administration on the next request

- **GIVEN** an active `hs_coordinator` account whose scope contains `st-thomas`, holding a live
  session
- **WHEN** an account whose `role` is `management` demotes it
- **AND** that session requests the roster of `st-thomas`
- **THEN** the request is refused
- **AND** no `person` row is returned

#### Scenario: A coordinator cannot demote

- **WHEN** an account whose `role` is `hs_coordinator` demotes another `hs_coordinator` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: A JHSC member cannot demote

- **WHEN** an account whose `role` is `jhsc_member` demotes an `hs_coordinator` account
- **THEN** the request is refused
- **AND** the target account's `role` is unchanged

#### Scenario: An account that is not a coordinator cannot be demoted

- **WHEN** an account whose `role` is `management` demotes an account whose `role` is `jhsc_member`
  or `management`
- **THEN** the request is refused with a reason naming the current role
- **AND** that account's `role` is unchanged

#### Scenario: An inactive account cannot be demoted

- **WHEN** an account whose `role` is `management` demotes an `hs_coordinator` account whose
  `deactivated_at` is non-null
- **THEN** the request is refused
- **AND** the account stays inactive with its `role` unchanged

#### Scenario: A demotion outside the site scope is refused

- **WHEN** an account whose `role` is `management` and whose scope is `st-thomas` only demotes an
  `hs_coordinator` account scoped to `glencoe` alone
- **THEN** the request is refused
- **AND** that account's `role` is unchanged

#### Scenario: An account cannot demote itself

- **WHEN** an account whose `role` is `management` demotes its own account
- **THEN** the request is refused
- **AND** its `role` is unchanged

#### Scenario: A demoted coordinator keeps inspecting

- **GIVEN** an active `hs_coordinator` account listed among the accounts eligible to be assigned an
  inspection at its site
- **WHEN** that account is demoted to `jhsc_member`
- **THEN** it is still listed among the eligible accounts of that site
- **AND** assigning it as `inspector_id` of an inspection at that site is accepted

#### Scenario: The roster offers the demotion to management only

- **WHEN** the roster of a site is shown to an account whose `role` is `management`
- **THEN** the row of an active `hs_coordinator` account offers the demotion, and no row of a
  `jhsc_member` or `management` account does
- **AND** when the same roster is shown to an account whose `role` is `hs_coordinator`, no row
  offers it

## MODIFIED Requirements

### Requirement: Administrative authority is held by the coordinator and by management

The system SHALL treat `hs_coordinator` and `management` as the two administrative roles, holding
the same permissions as each other with exactly one asymmetry: deciding who holds the coordinator
role — promoting an account to it and demoting an account from it — which is management's alone.

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

#### Scenario: A coordinator does not decide who holds the coordinator role

- **WHEN** an account whose `role` is `hs_coordinator` promotes a `jhsc_member` account or demotes
  an `hs_coordinator` account
- **THEN** the request is refused, and the target account's `role` is unchanged

### Requirement: Management can promote a JHSC member to coordinator

The system SHALL let an account whose `role` is `management` change the `role` of an active account
from `jhsc_member` to `hs_coordinator`, and SHALL refuse that request to every other role, including
`hs_coordinator`. A coordinator SHALL NOT be able to appoint another coordinator, so that the
account that holds every administrative permission is never the account that decides who else holds
them.

The promotion and its inverse, the demotion of a coordinator to `jhsc_member`, SHALL be the only
role changes the system exposes. The promotion SHALL be refused when the target account's current
`role` is not `jhsc_member`, when the target account is inactive, when the target account is outside
the requesting account's site scope, and when the requesting account is the target. Refusing it
SHALL leave `app_user.role` unchanged.

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

#### Scenario: A promoted member can be demoted back

- **GIVEN** a `jhsc_member` account that management promoted to `hs_coordinator`
- **WHEN** an account whose `role` is `management` demotes it
- **THEN** its `role` is `jhsc_member` again
- **AND** two `user.role_changed` entries, one per change, exist in the chain of every site in its
  scope
