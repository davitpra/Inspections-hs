## RENAMED Requirements

- FROM: `### Requirement: An incident is visible only to the account that filed it, the HS coordinator and management`
- TO: `### Requirement: An incident is visible only to the account that filed it, the coordinator and management`

- FROM: `### Requirement: The HS coordinator is notified when an incident is reported, without the subject's name`
- TO: `### Requirement: The coordinator is notified when an incident is reported, without the subject's name`


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

The system SHALL accept the report from a `coordinator` or a `management` account and SHALL
refuse it from an `inspector` with `role_not_allowed`. Reporting on behalf of somebody else is an
administrative act: the two roles that hold the roster are the two that may name a person in an
accident record.

#### Scenario: A manager reports an incident about a roster person

- **WHEN** a `management` account submits an incident naming a `subject_person_id` of an active
  person of their site, with the guided fields filled
- **THEN** an `incident` row is created whose `reported_by` is that account's `user_id`
- **AND** whose `subject_person_id` is the named person
- **AND** whose `site_id` is a site of the session's scope

#### Scenario: An inspector cannot report an incident

- **WHEN** an account whose `role` is `inspector` submits an incident
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

### Requirement: No clinical detail is stored about the subject

The system SHALL NOT store a diagnosis, a medical report, a functional restriction or the nature
of an injury, and SHALL NOT offer any field, route or attachment that carries one. `body_part`
SHALL be a coarse closed selection and SHALL be the limit of what the record says about the
person's body; `on_site_treatment` SHALL be a closed selection of what was done at the workplace,
not of what a clinician concluded. No role, including the coordinator, SHALL be able to learn
from the system what injury a person suffered — only which category the event fell into.

#### Scenario: There is no diagnosis field to write to

- **WHEN** the incident schema is inspected
- **THEN** it carries no column for a diagnosis, a medical report or a functional restriction
- **AND** the accepted request body rejects such a field rather than storing it

#### Scenario: Body part is a closed selection

- **WHEN** an incident is submitted with a `body_part` outside the declared selection
- **THEN** the request is rejected

#### Scenario: The coordinator cannot query an injury

- **WHEN** the coordinator reads an incident of the most severe classification
- **THEN** the response states the classification, the body part category and the on-site
  treatment
- **AND** carries nothing describing the injury itself

#### Scenario: An incident carries no attachments

- **WHEN** an attachment or photo is submitted with an incident
- **THEN** the request is rejected, because a photograph of an injured person is clinical detail
  by another route

### Requirement: Only the transitions of the incident state machine are accepted

The system SHALL accept exactly the transitions §4 lists: `null` → `reported` by the reporting
account; `reported` → `under_investigation` by the coordinator; `reported` → `closed` by the
coordinator with a `reason`; `under_investigation` → `closed` by the coordinator; and `closed`
→ `under_investigation` by the coordinator with a `reason`, which is a reopening recorded as a
new event and never as an edit. Every other ordered pair SHALL be refused. The transition table,
the role allowed to make each transition and the data each demands SHALL be a data table in the
shared contracts, and the same table SHALL be enforced as a guard in the database, so that an
illegal transition is refused twice — by the pure function and by the engine.

Where the table names the coordinator it SHALL be read as naming `management` equally, under the
administrative equivalence of the `identity` capability, and as excluding `inspector`.

#### Scenario: An event whose from_state is not the current state is refused

- **GIVEN** an incident whose current state is `under_investigation`
- **WHEN** an event is inserted with `from_state` `reported`
- **THEN** the insert is refused by the guard

#### Scenario: A reported incident cannot jump backwards

- **WHEN** a transition from `reported` to `reported` is attempted
- **THEN** the request is rejected as a transition that does not exist in the table

#### Scenario: Only an administrative account investigates and closes

- **WHEN** an `inspector` attempts to move an incident to `under_investigation` or to `closed`
- **THEN** the request is rejected with the code `role_not_allowed`
- **AND** the same attempt by a `coordinator` or a `management` account is accepted

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

### Requirement: The corrective actions of an investigation use the same engine as those of a finding

The system SHALL let the coordinator create corrective actions whose parent is an
`investigation`, through the same routes, the same state machine, the same evidence rules, the
same verifier rule and the same overdue escalation as the actions of a finding. An action SHALL
belong to exactly one parent — a finding or an investigation — and never to both or to neither.

#### Scenario: An action is created for an investigation

- **WHEN** the coordinator creates a corrective action naming an `investigation_id`, an assignee
  and a deadline input
- **THEN** a `corrective_action` row is created carrying that `investigation_id` and a null
  `finding_id`

#### Scenario: The action of an investigation advances like any other

- **GIVEN** an action whose parent is an investigation
- **WHEN** the assignee moves it to `in_progress`, attaches after evidence and declares the work
  done, and a different account verifies it
- **THEN** the same events are written as for an action of a finding
- **AND** the executor is refused when they attempt to verify their own work

#### Scenario: An overdue action of an investigation escalates

- **GIVEN** an action of an investigation three days past its `due_at` and not closed
- **WHEN** the daily escalation runs
- **THEN** the coordinators of the site are notified, exactly as for an action of a finding

#### Scenario: An action naming both parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint

### Requirement: An incident is visible only to the account that filed it, the coordinator and management

The system SHALL restrict reading an incident, its events, its witnesses, its investigation and
its causes to the account named in `reported_by`, to accounts whose role is `coordinator` and
to accounts whose role is `management`, within the site scope of the session. An `inspector` SHALL
NOT see an incident another account filed, as §4 states. The restriction SHALL be enforced by
row level security on top of the site isolation policy and SHALL NOT be a filter written in an
endpoint. An incident outside the reader's visibility SHALL be indistinguishable from one that
does not exist.

#### Scenario: An inspector does not see an incident somebody else filed

- **GIVEN** an incident filed by a `management` account of a site
- **WHEN** an `inspector` of that same site lists incidents
- **THEN** that incident is not returned

#### Scenario: The coordinator and management see every incident of their scope

- **WHEN** the coordinator lists incidents of a site in scope
- **THEN** every incident of that site is returned, whoever filed it
- **AND** an account whose role is `management` sees the same list

#### Scenario: Site isolation still applies to the coordinator

- **GIVEN** a coordinator whose session scope is St. Thomas only
- **WHEN** they list incidents
- **THEN** no Glencoe incident is returned

#### Scenario: An invisible incident is indistinguishable from a missing one

- **WHEN** an `inspector` requests by id an incident filed by someone else
- **THEN** the answer is the same as for an id that does not exist

#### Scenario: The children follow the parent's visibility

- **WHEN** an `inspector` who cannot see an incident queries its events, witnesses, investigation
  or causes
- **THEN** none of them return a row

#### Scenario: The restriction is not an endpoint filter

- **WHEN** the incident tables are queried directly within a transaction carrying an `inspector`
  session's variables
- **THEN** the rows they cannot see are absent from the result of the query itself

### Requirement: The coordinator is notified when an incident is reported, without the subject's name

The system SHALL create a notification for the coordinators of the incident's site within the
same transaction that reports it, as §3 R4 requires. The payload SHALL carry the incident id, the
site, the classification and the instants, and SHALL NOT carry the subject's name, employee number
or any narrative field, because a notification is a less protected row than the incident and MUST
NOT become the lateral leak of what the visibility rule just closed.

#### Scenario: The coordinator finds the incident in their inbox

- **WHEN** a management account reports an incident at St. Thomas
- **THEN** the coordinators whose scope includes St. Thomas have a notification of kind
  `incident_reported`
- **AND** it names the incident id and its classification

#### Scenario: The notification carries no identity of the subject

- **WHEN** the notification of a reported incident is read
- **THEN** its payload carries no name, no employee number and no narrative field

#### Scenario: The notification is written in the reporting transaction

- **WHEN** the report fails and rolls back
- **THEN** no notification exists for it

#### Scenario: Following the notification still obeys the visibility rule

- **GIVEN** a notification of a reported incident
- **WHEN** an account that may not see the incident follows it
- **THEN** the incident is not returned
