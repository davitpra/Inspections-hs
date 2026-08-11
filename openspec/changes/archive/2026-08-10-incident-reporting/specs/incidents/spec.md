## Purpose

Records a workplace accident in the third person — a supervisor reporting about a person of the
roster who may have no account and whose profile the reporter never sees — as nine guided,
version-stamped fields that are frozen on submission; drives it through an investigation to a
close that no one can declare while its corrective actions are still open; computes and displays
the MLITSD and WSIB clocks the classification triggers without ever submitting anything to either
body; and keeps the record readable only by the person who filed it, the HS coordinator and
management.

## ADDED Requirements

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

#### Scenario: A supervisor reports an incident about a roster person

- **WHEN** a supervisor submits an incident naming a `subject_person_id` of an active person of
  their site, with the guided fields filled
- **THEN** an `incident` row is created whose `reported_by` is the supervisor's `user_id`
- **AND** whose `subject_person_id` is the named person
- **AND** whose `site_id` is a site of the session's scope

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

### Requirement: The subject and the witnesses are chosen without seeing a profile

The system SHALL offer the people of the reporter's site scope as `PersonOption` values —
`employee_number` and display name and nothing else — and SHALL NOT return through any incident
route a person's site, status, dates or any other roster attribute. Witnesses SHALL be stored as
`incident_witness` rows referencing `person`, chosen through the same selector, and an incident
MAY have none.

#### Scenario: The selector returns only what a selector needs

- **WHEN** a supervisor lists the people available as an incident subject
- **THEN** each entry carries `employee_number` and the display name
- **AND** no other roster attribute is present in the response

#### Scenario: Deactivated people are not offered

- **GIVEN** a person whose `deactivated_at` is not null
- **WHEN** the subject selector is listed
- **THEN** that person is absent from the options
- **AND** incidents that already reference them still resolve that reference

#### Scenario: Witnesses are recorded as person references

- **WHEN** an incident is reported naming two witnesses
- **THEN** two `incident_witness` rows reference those `person_id` values
- **AND** neither witness gains an account or a notification

#### Scenario: An incident with no witnesses is valid

- **WHEN** an incident is reported with an empty witness list
- **THEN** the incident is created and carries no `incident_witness` row

### Requirement: The narrative is nine guided fields fixed in code and stamped with their version

The system SHALL compose the narrative from the nine guided fields of §4 — `occurred_at`,
`location_id`, `task_performed`, `equipment_involved`, `what_happened`, `body_part`,
`on_site_treatment`, witnesses and `immediate_action` — and SHALL NOT offer a single free-text box
in their place. The field set SHALL live in code and SHALL NOT be configurable at runtime; the
visual builder SHALL NOT gain the incident form as a second consumer. Every `incident` row SHALL
carry `form_version`, an integer, and the system SHALL keep in code a registry mapping each
version to the set of fields it contained, so that an old incident is rendered with the fields
that existed when it was written and "empty because it did not apply" is distinguishable from
"empty because it did not exist". `location_id` SHALL come from the closed location catalogue,
the same vocabulary findings use.

#### Scenario: The nine fields are stored as separate columns

- **WHEN** an incident is reported
- **THEN** the row carries each guided field in its own column
- **AND** no column holds an undifferentiated description of the event

#### Scenario: The stored version is the code's, not the caller's

- **WHEN** an incident is submitted claiming a `form_version` that differs from the version the
  running code declares
- **THEN** the stored `form_version` is the code's

#### Scenario: An old incident renders with the fields of its own version

- **GIVEN** an incident stored with `form_version` 1 and a running code that declares version 2
  with one additional field
- **WHEN** that incident is read
- **THEN** the field added in version 2 is reported as absent from that version
- **AND** it is not reported as an empty value of that incident

#### Scenario: The field set cannot be changed at runtime

- **WHEN** the incident form definition is requested to be altered through any route
- **THEN** no route exists that does so
- **AND** the field set is the one the deployed code declares

#### Scenario: A location outside the catalogue is refused

- **WHEN** an incident is submitted with a `location_id` that is not an active location of its site
- **THEN** the request is rejected and no `incident` row is created

#### Scenario: The time of the event is not the time of the report

- **WHEN** an incident that happened yesterday is reported today
- **THEN** `occurred_at` is yesterday's instant as the reporter stated it
- **AND** `reported_at` is the server's clock at submission
- **AND** the two are stored as separate values

#### Scenario: An event in the future is refused

- **WHEN** an incident is submitted whose `occurred_at` is after the server's clock
- **THEN** the request is rejected with the code `occurred_at_in_future`

### Requirement: The narrative records the language it was written in and is never translated

The system SHALL store, alongside the free-text guided fields, the language the reporter declared
writing them in, and SHALL preserve those words exactly as submitted. The system SHALL NOT
translate, normalise or rewrite any narrative field, automatically or otherwise, because the row
is part of an immutable record that may reach the MLITSD. Recording the language SHALL NOT
localise the interface: the platform remains English only.

#### Scenario: Spanish text is stored verbatim with its language

- **WHEN** a supervisor writes the narrative fields in Spanish and declares `es`
- **THEN** the stored text is byte-for-byte what was submitted
- **AND** the row records `es` as the narrative language

#### Scenario: No translation is produced or stored

- **WHEN** an incident whose narrative language is `es` is read
- **THEN** the response carries the original text and the language
- **AND** carries no translated variant of any field

#### Scenario: The interface stays in English

- **WHEN** any incident screen is rendered for a session whose incidents were written in Spanish
- **THEN** the labels, buttons and help text are in English

### Requirement: An incident carries one of five classifications and near miss is not one of them

The system SHALL constrain `classification` to exactly `first_aid`, `health_care`,
`lost_time_or_modified_work`, `critical_injury` and `occupational_illness`. The system SHALL NOT
accept `near_miss` or any equivalent, as the closed question 8 removed it; a near miss SHALL be
recorded as a manual finding, which is where it produces a corrective action. The classification
SHALL be frozen at report: the `incident` table is append-only and no route SHALL change it.

#### Scenario: The five classifications are accepted

- **WHEN** an incident is reported with each of the five classifications in turn
- **THEN** each is stored as submitted

#### Scenario: Near miss is refused

- **WHEN** an incident is submitted with the classification `near_miss`
- **THEN** the request is rejected
- **AND** a direct insert of that value fails on the table's check constraint

#### Scenario: The classification cannot be changed afterwards

- **WHEN** any role attempts to change the `classification` of an existing incident through a
  route or a direct `UPDATE`
- **THEN** no route exists that does so and the statement fails
- **AND** the stored classification is unchanged

### Requirement: No clinical detail is stored about the subject

The system SHALL NOT store a diagnosis, a medical report, a functional restriction or the nature
of an injury, and SHALL NOT offer any field, route or attachment that carries one. `body_part`
SHALL be a coarse closed selection and SHALL be the limit of what the record says about the
person's body; `on_site_treatment` SHALL be a closed selection of what was done at the workplace,
not of what a clinician concluded. No role, including the HS coordinator, SHALL be able to learn
from the system what injury a person suffered — only which category the event fell into.

#### Scenario: There is no diagnosis field to write to

- **WHEN** the incident schema is inspected
- **THEN** it carries no column for a diagnosis, a medical report or a functional restriction
- **AND** the accepted request body rejects such a field rather than storing it

#### Scenario: Body part is a closed selection

- **WHEN** an incident is submitted with a `body_part` outside the declared selection
- **THEN** the request is rejected

#### Scenario: The coordinator cannot query an injury

- **WHEN** the HS coordinator reads an incident of the most severe classification
- **THEN** the response states the classification, the body part category and the on-site
  treatment
- **AND** carries nothing describing the injury itself

#### Scenario: An incident carries no attachments

- **WHEN** an attachment or photo is submitted with an incident
- **THEN** the request is rejected, because a photograph of an injured person is clinical detail
  by another route

### Requirement: The state of an incident is derived from its events and is never stored as a column

The system SHALL record every state change as an `incident_event` row carrying `incident_id`,
`site_id`, `position`, `from_state`, `to_state`, `actor_user_id`, an optional `note` and a
`reason` where the transition demands one. The `incident` table SHALL NOT have a state column, and
that absence is the requirement. The current state SHALL be the `to_state` of the event with the
highest `position`. The pair `(incident_id, position)` SHALL be unique, so two concurrent
transitions cannot fork the stream. An `incident` row SHALL NOT be able to commit without its
first event, whose `from_state` is null and whose `to_state` is `reported`.

#### Scenario: Reporting writes the first event

- **WHEN** an incident is reported
- **THEN** an `incident_event` row exists with `position` 1, `from_state` null and `to_state`
  `reported`
- **AND** its `actor_user_id` is the reporter's account

#### Scenario: The current state is the last event's

- **GIVEN** an incident with events ending in `to_state` `under_investigation`
- **WHEN** the incident is read
- **THEN** its reported state is `under_investigation`

#### Scenario: There is no state column to read or write

- **WHEN** the `incident` table is inspected
- **THEN** it has no `state` or `status` column

#### Scenario: An incident cannot commit without its first event

- **WHEN** a transaction inserts an `incident` row and commits without inserting its first event
- **THEN** the commit fails on the deferred constraint and no incident exists

#### Scenario: Two concurrent transitions do not fork the stream

- **WHEN** two transactions insert an `incident_event` with the same `incident_id` and the same
  `position`
- **THEN** one commits and the other fails on the unique constraint

### Requirement: Only the transitions of the incident state machine are accepted

The system SHALL accept exactly the transitions §4 lists: `null` → `reported` by the reporting
account; `reported` → `under_investigation` by the HS coordinator; `reported` → `closed` by the HS
coordinator with a `reason`; `under_investigation` → `closed` by the HS coordinator; and `closed`
→ `under_investigation` by the HS coordinator with a `reason`, which is a reopening recorded as a
new event and never as an edit. Every other ordered pair SHALL be refused. The transition table,
the role allowed to make each transition and the data each demands SHALL be a data table in the
shared contracts, and the same table SHALL be enforced as a guard in the database, so that an
illegal transition is refused twice — by the pure function and by the engine.

#### Scenario: An event whose from_state is not the current state is refused

- **GIVEN** an incident whose current state is `under_investigation`
- **WHEN** an event is inserted with `from_state` `reported`
- **THEN** the insert is refused by the guard

#### Scenario: A reported incident cannot jump backwards

- **WHEN** a transition from `reported` to `reported` is attempted
- **THEN** the request is rejected as a transition that does not exist in the table

#### Scenario: Only the coordinator investigates and closes

- **WHEN** a supervisor attempts to move an incident to `under_investigation` or to `closed`
- **THEN** the request is rejected with the code `role_not_allowed`
- **AND** the same attempt by the HS coordinator is accepted

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

### Requirement: An incident cannot be closed while any of its corrective actions is open

The system SHALL refuse to move an incident to `closed` while any corrective action belonging to
its investigation has a derived state other than `closed`, so that the state of an incident is a
consequence of the work actually done and not an administrative declaration. The guard SHALL be
evaluated in the database against the current state of each action's own event stream, not against
a cached count, and SHALL be re-evaluated on a reopened incident that is closed a second time.

#### Scenario: An open action blocks the close

- **GIVEN** an incident under investigation with three corrective actions, one of them
  `in_progress`
- **WHEN** the coordinator moves it to `closed`
- **THEN** the request is rejected with the code `incident_has_open_actions`
- **AND** no closing event is written

#### Scenario: An action awaiting verification also blocks the close

- **GIVEN** an incident whose only action is `awaiting_verification`
- **WHEN** the coordinator moves it to `closed`
- **THEN** the request is rejected

#### Scenario: All actions closed lets the incident close

- **GIVEN** an incident under investigation whose three actions are all `closed`, and a root cause
  recorded
- **WHEN** the coordinator moves it to `closed`
- **THEN** the closing event is written

#### Scenario: The guard holds against a direct insert

- **WHEN** a closing `incident_event` is inserted directly while an action of the incident is
  `open`
- **THEN** the insert fails on the database guard, not on an application check

#### Scenario: An incident with no actions can close

- **GIVEN** an incident under investigation with a root cause recorded and no corrective action
- **WHEN** the coordinator closes it
- **THEN** the closing event is written

#### Scenario: An action opened after a reopening blocks the second close

- **GIVEN** a reopened incident for which a new corrective action was created and is `open`
- **WHEN** the coordinator closes it again
- **THEN** the request is rejected with `incident_has_open_actions`

### Requirement: Investigation is mandatory for the three most serious classifications

The system SHALL refuse the transition `reported` → `closed` for an incident classified
`critical_injury`, `lost_time_or_modified_work` or `occupational_illness`, and SHALL accept it for
`first_aid` and `health_care` when a `reason` is recorded. The list SHALL be configuration written
in code and the system SHALL NOT treat it as an authoritative legal rule; it SHALL carry in code
the statement that it must be confirmed against the employer's concrete obligations under the OHSA
before production use.

#### Scenario: A critical injury cannot be closed without investigating

- **GIVEN** an incident classified `critical_injury` in state `reported`
- **WHEN** the coordinator moves it to `closed`
- **THEN** the request is rejected with the code `investigation_required`

#### Scenario: First aid closes with a reason

- **GIVEN** an incident classified `first_aid` in state `reported`
- **WHEN** the coordinator closes it stating a reason
- **THEN** the closing event is written and carries that reason

#### Scenario: First aid without a reason is refused

- **WHEN** a `first_aid` incident is closed from `reported` with no `reason`
- **THEN** the request is rejected

#### Scenario: The three classifications are refused identically

- **WHEN** the direct close is attempted for `critical_injury`,
  `lost_time_or_modified_work` and `occupational_illness`
- **THEN** all three are rejected with `investigation_required`

#### Scenario: The guard holds against a direct insert

- **WHEN** a closing event from `reported` is inserted directly for a `critical_injury` incident
- **THEN** the insert fails on the database guard

### Requirement: An investigation records a structured root cause and the method that produced it

The system SHALL allow at most one `investigation` per incident, created when the incident moves
to `under_investigation`, carrying `incident_id`, `site_id`, `method`, `opened_by`, `opened_at`
and a sequence of events. `method` SHALL be one of `five_whys` and `cause_tree` and SHALL be
recorded rather than inferred. Causes SHALL be stored as `investigation_cause` rows carrying
`position`, a `statement` and an `is_root` flag, append-only like everything else. The system
SHALL refuse to close an incident under investigation unless at least one cause with `is_root`
true exists, because an investigation with no root cause is an empty folder with a name.

#### Scenario: Moving to investigation opens the investigation

- **WHEN** the coordinator moves a reported incident to `under_investigation` declaring the method
  `five_whys`
- **THEN** one `investigation` row exists for that incident with that method

#### Scenario: A second investigation is refused

- **WHEN** a second `investigation` row is inserted for an incident that already has one
- **THEN** the insert fails on the unique constraint

#### Scenario: A method outside the two is refused

- **WHEN** an investigation is opened with a method other than `five_whys` or `cause_tree`
- **THEN** the request is rejected

#### Scenario: Closing without a root cause is refused

- **GIVEN** an incident under investigation with three causes recorded, none of them `is_root`
- **WHEN** the coordinator closes it
- **THEN** the request is rejected with the code `root_cause_required`

#### Scenario: Causes are append-only

- **WHEN** any role attempts to update or delete an `investigation_cause` row
- **THEN** the statement fails and the row is unchanged
- **AND** correcting a cause is done by adding another one

### Requirement: The corrective actions of an investigation use the same engine as those of a finding

The system SHALL let the HS coordinator create corrective actions whose parent is an
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
- **THEN** the supervisors of the site are notified, exactly as for an action of a finding

#### Scenario: An action naming both parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint

### Requirement: The regulatory clocks are computed from frozen inputs and are never stored as columns

The system SHALL compute the regulatory obligations an incident triggers from its
`classification`, its `occurred_at` and its `reported_at`, through pure functions that take no
database connection, and SHALL NOT store any due instant as a column. Each computed clock SHALL
carry the authority, what the obligation is, the instant it is due, the instant it counts from and
the statutory citation it comes from. The tables SHALL be configuration written in code and the
system SHALL NOT present them as an authoritative legal rule; they SHALL carry in code the
statement that they must be confirmed before production use. Because the three inputs are frozen
on an append-only row, a clock SHALL yield the same answer every time it is computed.

#### Scenario: The same incident yields the same clocks on every read

- **WHEN** the clocks of an incident are computed twice, days apart
- **THEN** the two results are identical

#### Scenario: There is no due date column

- **WHEN** the `incident` table is inspected
- **THEN** it carries no column holding an MLITSD or a WSIB due instant

#### Scenario: Each clock states where it comes from

- **WHEN** the clocks of a `critical_injury` incident are computed
- **THEN** each result carries the authority, the obligation, the due instant, the instant it
  counts from and the citation

#### Scenario: The clocks are computed without a database

- **WHEN** the clock functions are exercised over a table of cases
- **THEN** they produce their results with no database connection

### Requirement: The MLITSD clocks depend on the classification and count from the instant the statute names

The system SHALL compute, for `critical_injury`, an immediate notice obligation flagged as
immediate rather than as a due instant, plus a written report due 48 hours after `occurred_at`.
For `lost_time_or_modified_work` and `health_care` it SHALL compute a written notice due 4 days
after `occurred_at`. For `occupational_illness` it SHALL compute a written notice due 4 days after
`reported_at` and NOT after `occurred_at`, because OHSA s. 52(2) counts that obligation from when
the employer was advised: an occupational illness has no occurrence instant anyone can fix, and
counting from `occurred_at` would make every case reported months after onset be born past due.
For `first_aid` it SHALL compute no MLITSD obligation. Every clock SHALL state which instant it
counted from, so the difference is visible rather than implied.

#### Scenario: A critical injury produces the immediate notice and the 48 hour report

- **GIVEN** an incident classified `critical_injury` that occurred on `2026-03-02T08:00:00-05:00`
- **WHEN** its clocks are computed
- **THEN** one result is the immediate notice, flagged immediate and carrying no due instant
- **AND** another is the written report due `2026-03-04T08:00:00-05:00`

#### Scenario: Lost time produces the four day written notice

- **GIVEN** an incident classified `lost_time_or_modified_work` that occurred on
  `2026-03-02T08:00:00-05:00`
- **WHEN** its clocks are computed
- **THEN** the MLITSD result is a written notice due `2026-03-06T08:00:00-05:00`

#### Scenario: First aid triggers no MLITSD obligation

- **WHEN** the clocks of a `first_aid` incident are computed
- **THEN** no MLITSD obligation is returned

#### Scenario: An occupational illness counts from the report

- **GIVEN** an incident classified `occupational_illness` whose `occurred_at` is four months
  before its `reported_at`
- **WHEN** its clocks are computed
- **THEN** the MLITSD written notice counts from `reported_at`
- **AND** it is not reported as past due

#### Scenario: A late report does not move the MLITSD clock of an injury

- **GIVEN** an incident classified `critical_injury` that occurred eight days before it was
  reported
- **WHEN** its MLITSD clocks are computed
- **THEN** they count from `occurred_at`
- **AND** they are reported as already past due

#### Scenario: All five classifications are covered

- **WHEN** the MLITSD clocks are computed for each of the five classifications
- **THEN** each returns the obligations its row of the table declares and no others

### Requirement: The WSIB clock counts three business days from the report

The system SHALL compute, for every classification except `first_aid`, a WSIB Form 7 obligation
due three business days after `reported_at`, and SHALL compute none for `first_aid`. The clock
SHALL count from the report and not from the occurrence, because the obligation runs from when the
employer learned of the injury and a report filed for a week-old event would otherwise be overdue
before it existed. A business day SHALL exclude Saturdays, Sundays and the statutory holidays of
Ontario, which SHALL be derived by rule in code — fixed dates and nth-weekday rules, including
Good Friday — rather than listed year by year.

#### Scenario: Three business days across a weekend

- **GIVEN** an incident reported on Thursday `2026-03-05T10:00:00-05:00`
- **WHEN** its WSIB clock is computed
- **THEN** it is due on Tuesday `2026-03-10T10:00:00-04:00` or later, having skipped the Saturday
  and the Sunday

#### Scenario: A statutory holiday is not a business day

- **GIVEN** an incident reported on the business day before Canada Day
- **WHEN** its WSIB clock is computed
- **THEN** Canada Day is not counted among the three business days

#### Scenario: First aid triggers no Form 7

- **WHEN** the clocks of a `first_aid` incident are computed
- **THEN** no WSIB obligation is returned

#### Scenario: The WSIB clock counts from the report, the MLITSD ones from the occurrence

- **GIVEN** an incident that occurred on `2026-03-02` and was reported on `2026-03-09`
- **WHEN** its clocks are computed
- **THEN** the WSIB clock counts from `2026-03-09`
- **AND** the MLITSD clocks count from `2026-03-02`

#### Scenario: The holiday rules are exercised year by year

- **WHEN** the Ontario statutory holidays are derived for several consecutive years
- **THEN** each year yields the same set the rules declare, including a Good Friday whose date
  moves

### Requirement: The clocks are displayed and the system submits nothing

The system SHALL display, on the incident, every clock that applies, what it is due by, what it
counts from and its citation, and SHALL state that submission is a person's act. The system SHALL
NOT transmit anything to the MLITSD or to the WSIB, SHALL NOT hold a submission queue, and SHALL
NOT record a submitted state it cannot observe.

#### Scenario: The incident screen shows the applicable clocks

- **WHEN** a `critical_injury` incident is opened by an account allowed to see it
- **THEN** the immediate notice, the 48 hour report and the Form 7 obligation are shown with their
  due instants and citations

#### Scenario: Nothing is sent to either body

- **WHEN** an incident of any classification is reported
- **THEN** no outbound request is made to the MLITSD or the WSIB
- **AND** no job is enqueued that would make one

#### Scenario: There is no submitted state

- **WHEN** the incident schema and routes are inspected
- **THEN** none records or accepts that a report was filed with either body

#### Scenario: A past due clock is shown as past due, not hidden

- **GIVEN** an incident whose Form 7 clock has run out
- **WHEN** the incident is read
- **THEN** the clock is present and reported as past due

### Requirement: The Form 7 screen is read only and maps the incident's own form version

The system SHALL present a read-only screen mapping the incident's stored values to the fields of
the WSIB Form 7, with copy-to-clipboard per field and a copy-all, and SHALL NOT generate the
official PDF. The mapping SHALL be selected by the incident's `form_version`, so an incident
written under an earlier version is mapped with the field set it had. Fields the system does not
hold SHALL be shown as not held by the system rather than as empty values of the incident.

#### Scenario: The mapped fields are shown with copy affordances

- **WHEN** the Form 7 screen of an incident is opened
- **THEN** each mapped field shows its value and offers to copy it
- **AND** a copy-all offers the whole set

#### Scenario: No PDF is produced

- **WHEN** the Form 7 screen is used
- **THEN** no document is generated or downloaded
- **AND** no route produces the official form

#### Scenario: An old incident maps with its own version

- **GIVEN** an incident of `form_version` 1 and a deployed code declaring version 2
- **WHEN** its Form 7 screen is opened
- **THEN** the mapping used is the one registered for version 1

#### Scenario: What the system does not hold is labelled as such

- **WHEN** the Form 7 screen shows a field the system deliberately does not store, such as any
  clinical detail
- **THEN** it is labelled as not held by the system
- **AND** it is not presented as an empty answer of the incident

#### Scenario: The screen writes nothing

- **WHEN** the Form 7 screen is opened by the coordinator
- **THEN** no row is written other than the audit entry an external auditor's read would produce

### Requirement: An incident is visible only to the account that filed it, the HS coordinator and management

The system SHALL restrict reading an incident, its events, its witnesses, its investigation and
its causes to the account named in `reported_by`, to accounts whose role is `hs_coordinator` and
to accounts whose role is `management`, within the site scope of the session. A supervisor SHALL
NOT see an incident another supervisor filed, as §4 states. The restriction SHALL be enforced by
row level security on top of the site isolation policy and SHALL NOT be a filter written in an
endpoint. An incident outside the reader's visibility SHALL be indistinguishable from one that
does not exist.

#### Scenario: A supervisor does not see another supervisor's incident

- **GIVEN** two supervisors of the same site, each having filed an incident
- **WHEN** one of them lists incidents
- **THEN** only their own is returned

#### Scenario: The coordinator and management see every incident of their scope

- **WHEN** the HS coordinator lists incidents of a site in scope
- **THEN** every incident of that site is returned, whoever filed it
- **AND** an account whose role is `management` sees the same list

#### Scenario: Site isolation still applies to the coordinator

- **GIVEN** a coordinator whose session scope is St. Thomas only
- **WHEN** they list incidents
- **THEN** no Glencoe incident is returned

#### Scenario: An invisible incident is indistinguishable from a missing one

- **WHEN** a supervisor requests by id an incident filed by someone else
- **THEN** the answer is the same as for an id that does not exist

#### Scenario: The children follow the parent's visibility

- **WHEN** a supervisor who cannot see an incident queries its events, witnesses, investigation or
  causes
- **THEN** none of them return a row

#### Scenario: The restriction is not an endpoint filter

- **WHEN** the incident tables are queried directly within a transaction carrying a supervisor's
  session variables
- **THEN** the rows they cannot see are absent from the result of the query itself

### Requirement: The HS coordinator is notified when an incident is reported, without the subject's name

The system SHALL create a notification for the HS coordinators of the incident's site within the
same transaction that reports it, as §3 R4 requires. The payload SHALL carry the incident id, the
site, the classification and the instants, and SHALL NOT carry the subject's name, employee number
or any narrative field, because a notification is a less protected row than the incident and MUST
NOT become the lateral leak of what the visibility rule just closed.

#### Scenario: The coordinator finds the incident in their inbox

- **WHEN** a supervisor reports an incident at St. Thomas
- **THEN** the HS coordinators whose scope includes St. Thomas have a notification of kind
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
