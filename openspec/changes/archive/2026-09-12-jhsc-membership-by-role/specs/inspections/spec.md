## MODIFIED Requirements

### Requirement: Only the HS coordinator schedules, reassigns and cancels

The system SHALL restrict creating and deactivating schedule rules, scheduling an inspection
outside the automatic calendar, reassigning `inspector_id` and cancelling a scheduled inspection to
accounts whose role is `hs_coordinator`. `inspector_id` SHALL reference an account that is not
deactivated and whose active site scope includes the inspection's `site_id`. The role SHALL NOT be
part of that question: every account of the closed set is on the committee, so there is no role a
scheduled inspection can be refused for. Every one of these operations SHALL be recorded in the
audit log with the acting account.

An account refused as `inspector_id` SHALL be refused for one of exactly two reasons, and the
refusal SHALL say which: the account does not exist or is deactivated, or it has no active scope
over the inspection's site.

#### Scenario: A JHSC member cannot reassign an inspection

- **WHEN** an account whose role is `jhsc_member` requests a change of `inspector_id` on a
  scheduled inspection
- **THEN** the request is rejected as forbidden
- **AND** `inspector_id` is unchanged

#### Scenario: A JHSC member cannot create a schedule rule

- **WHEN** an account whose role is `jhsc_member` requests the creation of a schedule rule
- **THEN** the request is rejected as forbidden

#### Scenario: An inspector without scope for the site is rejected

- **WHEN** the coordinator assigns as `inspector_id` an account whose role is `jhsc_member` but
  whose active site scope does not include the inspection's `site_id`
- **THEN** the request is rejected and names the site the account lacks

#### Scenario: A deactivated account is rejected as inspector

- **WHEN** the coordinator assigns as `inspector_id` an account whose `deactivated_at` is non-null
- **THEN** the request is rejected and says the account does not exist or is deactivated

#### Scenario: A manager can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` a `management` account whose active site scope
  includes the inspection's `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A coordinator can be assigned an inspection

- **WHEN** the coordinator assigns as `inspector_id` an `hs_coordinator` account whose active site
  scope includes the inspection's `site_id`
- **THEN** the assignment is accepted
- **AND** the inspection appears among what that account still owes

#### Scenario: A promoted member stays assignable

- **GIVEN** a `jhsc_member` account with active scope for the site
- **WHEN** that account is promoted to `hs_coordinator`
- **AND** the coordinator assigns it as `inspector_id` of an inspection at that site
- **THEN** the assignment is accepted, with no act between the promotion and the assignment

#### Scenario: A reassignment is audited

- **WHEN** the coordinator changes `inspector_id` on a scheduled inspection
- **THEN** an audit log entry is written for the inspection's `site_id` naming the acting account,
  the previous `inspector_id` and the new one

### Requirement: The accounts eligible to be assigned an inspection at a site can be listed

The system SHALL expose, for a site, the accounts eligible to be named as `inspector_id` of a
scheduled inspection at that site: accounts that are not deactivated and whose `user_site_scope` for
that `site_id` has not been revoked. No role SHALL be excluded, because every account of the closed
set is on the committee.

The system SHALL determine that list with **the same predicate** it uses to validate an
assignment, so that every account the list offers is an account a reassignment accepts, and an
account a reassignment refuses as `inspector_invalid` never appears in the list.

The listing SHALL be restricted to administrative accounts, because it is the only
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

- **GIVEN** an account whose role is `jhsc_member` but whose scope for the site has been revoked,
  and one that has been deactivated
- **WHEN** the eligible accounts for that site are listed
- **THEN** neither appears
- **AND** assigning either of them is refused with the code `inspector_invalid`

#### Scenario: A management account is offered

- **GIVEN** a `management` account with active scope for the site
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears
- **AND** it stops appearing once its scope for that site is revoked

#### Scenario: A coordinator is offered

- **GIVEN** an `hs_coordinator` account with active scope for the site
- **WHEN** the eligible accounts for that site are listed
- **THEN** the account appears

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
