## MODIFIED Requirements

### Requirement: An incident is reported in the third person by an account about a person of the roster

The system SHALL store every incident as an `incident` row carrying `site_id`, `form_version`,
`classification`, `subject_person_id`, `reported_by`, `occurred_at`, `reported_at` and the guided
narrative fields. `reported_by` SHALL reference `app_user` and `subject_person_id` SHALL reference
`person`, because the reporter is an account and the subject is a roster record who in the general
case has none — the distinction §4 calls the most important decision of the model. The system
SHALL take `reported_by` from the session and SHALL ignore any reporter a caller supplies. The
system SHALL NOT expose any route that accepts an incident without an authenticated session, and
SHALL NOT accept an incident whose `subject_person_id` is the reporter's own `person_id` — first
person reporting is out of scope for v1.

The system SHALL accept the report from an `hs_coordinator` or a `management` account and SHALL
refuse it from a `jhsc_member` with `role_not_allowed`. Reporting on behalf of somebody else is an
administrative act: the two roles that hold the roster are the two that may name a person in an
accident record.

#### Scenario: A manager reports an incident about a roster person

- **WHEN** a `management` account submits an incident naming a `subject_person_id` of an active
  person of their site, with the guided fields filled
- **THEN** an `incident` row is created whose `reported_by` is that account's `user_id`
- **AND** whose `subject_person_id` is the named person
- **AND** whose `site_id` is a site of the session's scope

#### Scenario: A JHSC member cannot report an incident

- **WHEN** an account whose `role` is `jhsc_member` submits an incident
- **THEN** the request is rejected with the code `role_not_allowed`
- **AND** no `incident` row is created

#### Scenario: The subject has no account and that is the ordinary case

- **GIVEN** a person of the roster with no `app_user` row
- **WHEN** an incident is reported about them
- **THEN** the incident is created
- **AND** no account is created for that person as a side effect

#### Scenario: A deactivated person cannot be the subject

- **GIVEN** a person whose `deactivated_at` is not null
- **WHEN** an incident is reported about them
- **THEN** the request is rejected with the code `person_not_active`
- **AND** no `incident` row is created

#### Scenario: The reporter cannot be the subject

- **WHEN** an account submits an incident whose `subject_person_id` equals the session's
  `person_id`
- **THEN** the request is rejected with the code `first_person_report_not_supported`

#### Scenario: A reporter supplied in the body is ignored

- **WHEN** an incident is submitted carrying a `reported_by` different from the session's account
- **THEN** the stored `reported_by` is the session's `user_id`

#### Scenario: There is no unauthenticated route to report an incident

- **WHEN** the incident routes are requested without a session token
- **THEN** every one of them is refused as unauthenticated
- **AND** no anonymous, kiosk or public-link route exists that creates an `incident` row

### Requirement: Only the transitions of the incident state machine are accepted

The system SHALL accept exactly the transitions §4 lists: `null` → `reported` by the reporting
account; `reported` → `under_investigation` by the HS coordinator; `reported` → `closed` by the HS
coordinator with a `reason`; `under_investigation` → `closed` by the HS coordinator; and `closed`
→ `under_investigation` by the HS coordinator with a `reason`, which is a reopening recorded as a
new event and never as an edit. Every other ordered pair SHALL be refused. The transition table,
the role allowed to make each transition and the data each demands SHALL be a data table in the
shared contracts, and the same table SHALL be enforced as a guard in the database, so that an
illegal transition is refused twice — by the pure function and by the engine.

Where the table names the HS coordinator it SHALL be read as naming `management` equally, under the
administrative equivalence of the `identity` capability, and as excluding `jhsc_member`.

#### Scenario: An event whose from_state is not the current state is refused

- **GIVEN** an incident whose current state is `under_investigation`
- **WHEN** an event is inserted with `from_state` `reported`
- **THEN** the insert is refused by the guard

#### Scenario: A reported incident cannot jump backwards

- **WHEN** a transition from `reported` to `reported` is attempted
- **THEN** the request is rejected as a transition that does not exist in the table

#### Scenario: Only an administrative account investigates and closes

- **WHEN** a `jhsc_member` attempts to move an incident to `under_investigation` or to `closed`
- **THEN** the request is rejected with the code `role_not_allowed`
- **AND** the same attempt by an `hs_coordinator` or a `management` account is accepted

#### Scenario: Reopening is an event with a reason

- **GIVEN** a closed incident
- **WHEN** the coordinator reopens it stating a reason
- **THEN** a new `incident_event` moves it from `closed` to `under_investigation`
- **AND** the closing event is still present and unchanged

#### Scenario: A reopening without a reason is refused

- **WHEN** a closed incident is reopened with no `reason`
- **THEN** the request is rejected and no event is written

#### Scenario: The two implementations of the table agree

- **WHEN** every ordered pair of the three states, plus the pairs from `null`, is evaluated against
  the contracts table and against the database guard
- **THEN** the two verdicts agree on every pair

### Requirement: An incident is visible only to the account that filed it, the HS coordinator and management

The system SHALL restrict reading an incident, its events, its witnesses, its investigation and
its causes to the account named in `reported_by`, to accounts whose role is `hs_coordinator` and
to accounts whose role is `management`, within the site scope of the session. An account that is
neither the reporter nor administrative SHALL NOT see an incident somebody else filed. The
restriction SHALL be enforced by row level security on top of the site isolation policy and SHALL
NOT be a filter written in an endpoint. An incident outside the reader's visibility SHALL be
indistinguishable from one that does not exist.

The policy SHALL keep this shape now that only `jhsc_member` is restricted by it. A JHSC member
files no incident in the ordinary case, so in practice the policy returns them nothing; that is the
correct outcome and SHALL NOT be relaxed into letting the committee read accident records, which
§4 does not grant.

#### Scenario: A JHSC member does not see an incident somebody else filed

- **GIVEN** an incident filed by a `management` account of a site
- **WHEN** a `jhsc_member` of that same site lists incidents
- **THEN** that incident is not returned

#### Scenario: The coordinator and management see every incident of their scope

- **WHEN** the HS coordinator lists incidents of a site in scope
- **THEN** every incident of that site is returned, whoever filed it
- **AND** an account whose role is `management` sees the same list

#### Scenario: Site isolation still applies to the coordinator

- **GIVEN** a coordinator whose session scope is St. Thomas only
- **WHEN** they list incidents
- **THEN** no Glencoe incident is returned

#### Scenario: An invisible incident is indistinguishable from a missing one

- **WHEN** a `jhsc_member` requests by id an incident filed by someone else
- **THEN** the answer is the same as for an id that does not exist

#### Scenario: The children follow the parent's visibility

- **WHEN** a `jhsc_member` who cannot see an incident queries its events, witnesses, investigation
  or causes
- **THEN** none of them return a row

#### Scenario: The restriction is not an endpoint filter

- **WHEN** the incident tables are queried directly within a transaction carrying a `jhsc_member`
  session's variables
- **THEN** the rows they cannot see are absent from the result of the query itself
