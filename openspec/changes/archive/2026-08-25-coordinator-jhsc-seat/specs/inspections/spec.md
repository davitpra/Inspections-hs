## MODIFIED Requirements

### Requirement: Only the HS coordinator schedules, reassigns and cancels

The system SHALL restrict creating and deactivating schedule rules, scheduling an inspection
outside the automatic calendar, reassigning `inspector_id` and cancelling a scheduled inspection to
accounts whose role is `hs_coordinator`. `inspector_id` SHALL reference an account that sits on the
JHSC — one whose role is `jhsc_member`, or one whose role is `hs_coordinator` and whose
`jhsc_seat_granted_at` is non-null — and whose active site scope includes the inspection's
`site_id`. Every one of these operations SHALL be recorded in the audit log with the acting
account.

An `hs_coordinator` who holds no JHSC seat SHALL be refused as `inspector_id`, and the refusal
SHALL say that the account holds no seat rather than name the role, because the role is not what is
missing.

Withdrawing an account's JHSC seat SHALL NOT change the `inspector_id` of any scheduled inspection
already assigned to it, and SHALL NOT remove those inspections from what that account still owes:
the seat governs what is offered and what is accepted from that moment on, not what was already
decided.

#### Scenario: A JHSC member cannot reassign an inspection

- **WHEN** an account whose role is `jhsc_member` requests a change of `inspector_id` on a
  scheduled inspection
- **THEN** the request is rejected as forbidden
- **AND** `inspector_id` is unchanged

#### Scenario: A supervisor cannot create a schedule rule

- **WHEN** an account whose role is `supervisor` requests the creation of a schedule rule
- **THEN** the request is rejected as forbidden

#### Scenario: An inspector without scope for the site is rejected

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `jhsc_member` but
  whose active site scope does not include the inspection's `site_id`
- **THEN** the request is rejected and names the site the account lacks

#### Scenario: An account that is not a JHSC member is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `management`
- **THEN** the request is rejected and names the role

#### Scenario: A coordinator who holds a seat can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` an `hs_coordinator` account whose
  `jhsc_seat_granted_at` is non-null and whose active site scope includes the inspection's
  `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A coordinator who holds no seat is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an `hs_coordinator` account whose
  `jhsc_seat_granted_at` is null
- **THEN** the request is rejected and says the account holds no JHSC seat

#### Scenario: Leaving the committee does not reassign what was already assigned

- **GIVEN** a scheduled inspection assigned to an `hs_coordinator` account that holds a seat
- **WHEN** that account's seat is withdrawn
- **THEN** the inspection's `inspector_id` is unchanged
- **AND** the inspection is still among what that account still owes

#### Scenario: A reassignment is audited

- **WHEN** the coordinator changes `inspector_id` on a scheduled inspection
- **THEN** an audit log entry is written for the inspection's `site_id` naming the acting account,
  the previous `inspector_id` and the new one

### Requirement: The accounts eligible to be assigned an inspection at a site can be listed

The system SHALL expose, for a site, the accounts eligible to be named as `inspector_id` of a
scheduled inspection at that site: accounts that are not deactivated, that sit on the JHSC — role
`jhsc_member`, or role `hs_coordinator` with a non-null `jhsc_seat_granted_at` — and whose
`user_site_scope` for that `site_id` has not been revoked.

The system SHALL determine that list with **the same predicate** it uses to validate an
assignment, so that every account the list offers is an account a reassignment accepts, and an
account a reassignment refuses as `inspector_invalid` never appears in the list.

The listing SHALL be restricted to accounts whose role is `hs_coordinator`, because it is the only
read that projects the account table and it exists solely to feed an operation that is already
the coordinator's alone. A request for a site outside the session's site scope SHALL be refused
and SHALL return no entry, and the endpoint SHALL apply that check itself, because `app_user` and
`user_site_scope` carry no site isolation policy to apply it for them.

Each entry SHALL carry the account's `id` — the value that travels as `inspector_id`, never the
`person.id` — together with `employee_number`, `first_name` and `last_name`. Those three SHALL be
nullable: eligibility is defined over `user_site_scope` while the name lives in `person`, which is
site-isolated and whose `site_id` is a separate mutable column, so an eligible account whose person
row is outside the reader's scope SHALL still be listed, without its name, rather than dropped.

#### Scenario: Every account offered is an account an assignment accepts

- **GIVEN** a site with a mix of accounts of several roles and scopes
- **WHEN** the eligible accounts for that site are listed
- **AND** each one is then assigned to a scheduled inspection of that site
- **THEN** every assignment is accepted

#### Scenario: An account refused as inspector is never offered

- **GIVEN** an account whose role is `management`, and one whose role is `jhsc_member` but whose
  scope for the site has been revoked, and one that has been deactivated, and an `hs_coordinator`
  account that holds no JHSC seat
- **WHEN** the eligible accounts for that site are listed
- **THEN** none of the four appears
- **AND** assigning any of them is refused with the code `inspector_invalid`

#### Scenario: A coordinator with a seat is offered

- **GIVEN** an `hs_coordinator` account with active scope for the site and a non-null
  `jhsc_seat_granted_at`
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears
- **AND** it stops appearing once its seat is withdrawn

#### Scenario: An eligible account whose person row is out of scope is still offered

- **GIVEN** an account whose role is `jhsc_member` with active scope for St. Thomas, whose `person`
  row belongs to Glencoe
- **WHEN** a coordinator whose scope covers only St. Thomas lists the eligible accounts
- **THEN** the account is listed with a null `first_name` and a null `last_name`
- **AND** assigning it to a St. Thomas inspection is accepted

#### Scenario: A JHSC member cannot list the eligible accounts

- **WHEN** an account whose role is `jhsc_member` requests the eligible accounts of its own site
- **THEN** the request is rejected as forbidden

#### Scenario: A site outside the session scope returns nothing

- **WHEN** a coordinator whose scope covers only Glencoe requests the eligible accounts of
  St. Thomas
- **THEN** the request is refused
- **AND** no entry is returned
