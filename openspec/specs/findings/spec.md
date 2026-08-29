## Purpose

Records what was found wrong — derived from a negative inspection answer or entered by hand —
with the description, location and photo that make it actionable, and with the risk
classification and control hierarchy level the HS coordinator assigns to it afterwards.

## Requirements

### Requirement: Every negative answer of an accepted submission produces one finding

The system SHALL create one `finding` row for every negative answer of an accepted inspection
submission, inside the same transaction that writes the `inspection` and its
`inspection_answer` rows. A submission that is rejected for any reason SHALL leave no `finding`
row, and an accepted submission SHALL NOT be committed with a negative answer that produced no
finding.

#### Scenario: Three negative answers produce three findings

- **WHEN** a submission with 40 answers, 3 of them negative, is accepted
- **THEN** 3 `finding` rows reference the created `inspection`
- **AND** each one carries the `item_key` of the answer it was derived from

#### Scenario: A submission with no negative answer produces no finding

- **WHEN** a submission whose answers are all compliant is accepted
- **THEN** no `finding` row references the created `inspection`

#### Scenario: A rejected submission leaves no finding

- **GIVEN** a submission with two negative answers and one required item missing
- **WHEN** it is posted
- **THEN** the response carries the code `validation_failed`
- **AND** no `finding` row exists for that `client_submission_id`'s inspection

#### Scenario: A replayed submission does not duplicate findings

- **GIVEN** a submission with 3 negative answers already accepted
- **WHEN** the identical payload is posted four more times
- **THEN** the response carries `created` `false` each time
- **AND** exactly 3 `finding` rows exist for that inspection

### Requirement: What counts as a negative answer is fixed by response type

The system SHALL treat as negative exactly two answers: a `yes_no` answer whose value is
`false`, and a `yes_no_na` answer whose value is `no`. A `yes_no_na` answer of `na` SHALL NOT
produce a finding — "not applicable" is a third answer, not a failure. No `scale`, `number`,
`text`, `single_choice`, `multi_choice`, `photo` or `signature` answer SHALL produce a finding.
A failure threshold authored on a `scale` or `number` template question SHALL NOT change this:
the threshold is data the author wrote down, the engine does not read it, and an answer that
crosses it produces no finding.
An answer for an item the submission's own answers hide SHALL NOT produce a finding, because it
is not part of the answer set at all. The rule SHALL be evaluated by the same shared form engine
code on the device and on the server, so that what the inspector was asked to describe is exactly
what the server derives.

#### Scenario: `na` is not a failure

- **WHEN** a submission answers `dock.guards` — a `yes_no_na` item — with `na`
- **THEN** no `finding` row is created for `dock.guards`
- **AND** the submission is accepted without any finding details for it

#### Scenario: A low value on a scale is not a finding

- **WHEN** a submission answers a `scale` item with the lowest value of its range
- **THEN** no `finding` row is created for that item

#### Scenario: An authored threshold does not derive a finding

- **GIVEN** a template version whose `number` item declares a failure threshold of operator `gt`
  and value `80`
- **WHEN** a submission answers that item with `95`
- **THEN** no `finding` row is created for that item
- **AND** the submission is accepted without any finding details for it

#### Scenario: A hidden item produces nothing

- **GIVEN** a template version where `spill.cleanup` is visible only when `spill.present` is `yes`
- **WHEN** a submission answers `spill.present` with `no` and carries no answer for
  `spill.cleanup`
- **THEN** a finding is created for `spill.present` and none for `spill.cleanup`

#### Scenario: The device and the server agree on the same answer set

- **WHEN** the same template document and the same answer set are evaluated on the device and on
  the server
- **THEN** both report the same list of negative `item_key` values

### Requirement: A derived finding carries the dual identity of the item it came from

The system SHALL store, on every finding derived from an inspection answer, both
`template_version_item_id` — the published row that was answered, for legal fidelity — and
`item_key` — the stable identity of the concept the question asks about. The engine SHALL
guarantee that `item_key` is the key of the referenced `template_version_item`, and `item_key`
SHALL be indexed together with `site_id` so that resolving a site's findings by concept does not
require reading every finding of every inspection.

#### Scenario: The same question failing in two template versions groups under one key

- **GIVEN** two accepted inspections of the same site, one against version `2` and one against
  version `3` of a template, both answering `dock.guards` negatively
- **WHEN** that site's findings are grouped by `item_key`
- **THEN** both rows fall in the same group
- **AND** their `template_version_item_id` values differ

#### Scenario: A finding cannot claim an item key that is not the referenced item's

- **WHEN** a `finding` row is inserted whose `item_key` is not the `item_key` of its
  `template_version_item_id`
- **THEN** the insert fails with a foreign key violation on the
  `(template_version_item_id, item_key)` pair

#### Scenario: The exact question asked is still resolvable

- **WHEN** a finding derived from version `2` is read back through its
  `template_version_item_id`
- **THEN** the `prompt`, `section_key`, `position` and `response_type` of version `2` are
  returned, not those of the current version

### Requirement: A finding carries a description, an optional resolved location and at least one photo

The system SHALL require, on every finding regardless of its origin, a `description` of at least
10 characters and at least one photo recorded as an object key. `location_id` MAY be null when
the section's organization location cannot be resolved for the finding's site. When non-null, it
SHALL name a location of the finding's own site from the closed catalogue. The engine SHALL reject
a finding whose `location_id` belongs to another site, and SHALL reject at commit a finding with no
photo. Photos SHALL be stored as object keys of files uploaded beforehand; a finding SHALL NEVER
carry image bytes.

#### Scenario: A finding is stored with all three

- **WHEN** a submission with one negative answer carrying a description, a `location_id` and two
  object keys is accepted
- **THEN** the created `finding` row carries that `description` and that `location_id`
- **AND** two `finding_photo` rows reference it, each with one object key

#### Scenario: A finding with no photo cannot be committed

- **WHEN** a `finding` row is inserted and the transaction commits without inserting any
  `finding_photo` row for it
- **THEN** the commit fails with the dedicated SQLSTATE of the deferred photo constraint

#### Scenario: A location of the other site is refused

- **GIVEN** a finding of a St. Thomas inspection
- **WHEN** its `location_id` names a location of Glencoe
- **THEN** the insert fails on the `(site_id, location_id)` foreign key
- **AND** no finding is created

#### Scenario: A description of two characters is refused

- **WHEN** a finding is submitted with the `description` `ok`
- **THEN** the request is rejected and no `finding` row is created

### Requirement: A location deactivated after the field package was prepared is still accepted for a derived finding

The system SHALL resolve a section's `organization_location_code` against the location catalogue
of the inspection's site. If no active mapping exists, the derived finding SHALL be stored with a
null `location_id` rather than inventing a location or losing the submission. A supplied non-null
`location_id` SHALL be accepted only when it resolves to the section's declared organization
location in that site. A manually entered finding MAY also omit its location; when it supplies one,
the server SHALL refuse a deactivated location.

#### Scenario: A stale catalogue does not lose an inspection

- **GIVEN** an inspection prepared while `pack-line-3` was active, and `pack-line-3` deactivated
  before the submission arrives
- **WHEN** the submission carries a finding located at `pack-line-3`
- **THEN** the submission is accepted and the finding records `pack-line-3` when its mapping still
  resolves

#### Scenario: An unmapped section leaves the finding location unresolved

- **GIVEN** a section whose organization location has no active mapping in the inspection's site
- **WHEN** a negative answer produces a finding
- **THEN** the submission is accepted and the `finding.location_id` is null

#### Scenario: A manual finding cannot use a deactivated location

- **WHEN** a manually entered finding names a `location_id` whose `deactivated_at` is not null
- **THEN** the request is rejected with the code `invalid_finding`
- **AND** no `finding` row is created

### Requirement: A finding can be entered by hand and then has no item key

The system SHALL accept a manually entered finding — a hazard seen outside an inspection — from a
supervisor, manager or the HS coordinator, carrying its site, description, location and photos. A
manually entered finding SHALL have `inspection_id`,
`template_version_item_id` and `item_key` all null, and a derived finding SHALL have all three
set; the engine SHALL enforce that exactly one of the two origins holds. A manually entered
finding SHALL therefore be absent from any grouping by `item_key`, which is the accepted
consequence recorded in §4 and risk F.

#### Scenario: A supervisor reports a hazard seen outside an inspection

- **WHEN** a supervisor posts a finding with a site, a description, a `location_id` and one object
  key
- **THEN** a `finding` row is created with `origin` `manual`
- **AND** its `inspection_id`, `template_version_item_id` and `item_key` are null
- **AND** no classification is stored for it

#### Scenario: A half-derived finding cannot exist

- **WHEN** a `finding` row is inserted with an `inspection_id` but no `item_key`
- **THEN** the insert fails on the origin check constraint

#### Scenario: A manual finding is outside every grouping by concept

- **GIVEN** a site with two derived findings for `dock.guards` and one manual finding describing
  the same hazard
- **WHEN** the site's findings are grouped by `item_key`
- **THEN** the group for `dock.guards` counts 2
- **AND** the manual finding appears in no group

#### Scenario: A manual finding cannot borrow another inspection's photo

- **WHEN** a manual finding references an object key outside the prefix derived from its own
  `site_id` and its draft identifier
- **THEN** the request is rejected with the code `invalid_finding`

### Requirement: Findings are read within the reader's site scope

The system SHALL return findings only for the sites in the session's scope, enforced by the row
level security policy on `finding` and `finding_photo` and not by a `WHERE site_id` clause in the
endpoint. A listing SHALL carry, for each finding, its origin, its description, its location and
its photos. A request for a finding outside the session's scope SHALL be answered exactly as one
for a finding that does not exist.

#### Scenario: A JHSC member of one site does not see the other's findings

- **GIVEN** findings in St. Thomas and in Glencoe
- **WHEN** a JHSC member scoped to St. Thomas lists findings
- **THEN** only the St. Thomas findings are returned

#### Scenario: The coordinator sees both sites

- **WHEN** the HS coordinator, scoped to both sites, lists findings
- **THEN** findings of both sites are returned

#### Scenario: A finding of the other site is indistinguishable from a missing one

- **WHEN** a JHSC member scoped to St. Thomas requests a Glencoe finding by id
- **THEN** the response is `finding_not_found`
- **AND** the body reveals nothing about its site, location or description

#### Scenario: A listing carries no classification

- **GIVEN** a finding of the reader's site
- **WHEN** it is listed
- **THEN** the finding carries no `assessment`, `risk_level`, `probability` or `control_level`

### Requirement: A finding is read together with the corrective action its template item prescribed

When a submitted inspection is read back, the system SHALL display, for every question that
recorded a finding, the corrective action prescribed by that item in the template document frozen
with the submission, alongside the description the inspector wrote and the count of photos attached
to the finding. The prescribed text SHALL be taken from the frozen document and never from the
template version published today. A question that recorded no finding SHALL NOT display a
prescribed corrective action, and an item whose template prescribes none SHALL display no heading
in its place. The full inspection report and the findings-only reading of the same submission SHALL
present this identically.

#### Scenario: The prescribed corrective action is read next to the finding

- **GIVEN** a submitted inspection whose item `general.guards` prescribes "Refit the guard before the line runs again." and recorded a finding
- **WHEN** the inspection is read at either the report or the findings-only screen
- **THEN** the prescribed corrective action is displayed with the finding description and photo count

#### Scenario: A clean question does not announce what would have been corrected

- **GIVEN** a submitted inspection whose item `general.photo` prescribes a corrective action and was answered without a finding
- **WHEN** the full report is read
- **THEN** that item's prescribed corrective action is not displayed

#### Scenario: An item without a prescription says nothing

- **GIVEN** a submitted inspection whose item recorded a finding and whose template prescribes no corrective action
- **WHEN** the finding is read
- **THEN** no corrective action heading is displayed for that item

### Requirement: Coordinators open a corrective action from the finding that justifies it

The system SHALL offer, on the findings-only reading of a submitted inspection, a control to
create a corrective action for each recorded finding, to an authenticated `hs_coordinator` and to
no other role. The assignee choices SHALL contain only active people of that finding's site. The
system SHALL show, for every recorded finding and to every role, the corrective actions that
already reference it, each identified by its description, the person responsible for it, the
deadline it was created with, its current state, whether it is past that deadline, and the
escalation levels it has reached, and each linked to that action's own screen. Showing the
standing of a commitment SHALL NOT require reading anything beyond the corrective action listing
the screen already reads. When the corrective actions cannot be read, the system SHALL say so and
SHALL NOT report that a finding has none. A finding that already has corrective actions SHALL
remain available for another one. This presentation rule SHALL NOT replace server authorization.

#### Scenario: The coordinator is offered the creation control

- **GIVEN** a submitted inspection recorded a finding
- **WHEN** an `hs_coordinator` reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: Another role reads the commitments without being offered creation

- **GIVEN** a recorded finding already has one corrective action
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** that corrective action is shown with its description, responsible person, deadline and state
- **AND** no control to create a corrective action is shown

#### Scenario: A late commitment is read as late against its finding

- **GIVEN** a recorded finding has a corrective action in `in_progress` whose deadline has passed and which has escalated to the supervisor
- **WHEN** the findings-only screen is read
- **THEN** that corrective action is shown as past its deadline and as escalated to the supervisor
- **AND** its responsible person and deadline are shown without any further request

#### Scenario: Existing corrective actions are listed against their own finding

- **GIVEN** two corrective actions reference the recorded finding and one references another finding
- **WHEN** the findings-only screen is read
- **THEN** only the two are shown under that finding, each linked to its own corrective action

#### Scenario: An unreadable list is not reported as no commitments

- **GIVEN** the corrective actions cannot be read
- **WHEN** the findings-only screen is read
- **THEN** the screen reports that existing corrective actions need a connection
- **AND** it does not state that the finding has no corrective action

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation control for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

### Requirement: A corrective action opened from a finding is a complete future commitment

The system SHALL submit a corrective action only when `assignee_person_id` names one of the
offered people, `description` satisfies the corrective action contract, and `due_at` is later
than the current instant. While the creation is pending, the system SHALL prevent a duplicate
submission. After a successful creation, the system SHALL close the form and show the created
corrective action against its finding. If creation fails, the system SHALL keep the entered values
available for correction and SHALL present the failure without claiming that the corrective action
was created.

#### Scenario: A coordinator creates a complete corrective action

- **GIVEN** the coordinator has selected an active `assignee_person_id` of the finding's site, entered a valid `description`, and selected a future `due_at`
- **WHEN** the coordinator submits the form
- **THEN** one corrective action is created for that finding with those three values
- **AND** the form closes and the created corrective action is shown against that finding

#### Scenario: A past deadline is not submitted

- **WHEN** the coordinator enters a `due_at` that is not later than the current instant
- **THEN** the form reports that the deadline must be in the future
- **AND** no creation request is submitted

#### Scenario: A pending creation cannot be submitted twice

- **GIVEN** a creation request is pending
- **WHEN** the coordinator attempts to submit the same form again
- **THEN** no second creation request is submitted

#### Scenario: A rejected creation preserves the draft

- **GIVEN** the coordinator has completed the creation form
- **WHEN** the creation request fails
- **THEN** the form remains open with `assignee_person_id`, `description` and `due_at` preserved
- **AND** the failure is shown to the coordinator

### Requirement: A corrective action is advanced from the finding that justifies it

The system SHALL offer, for every corrective action shown against a recorded finding, a control
that opens that action's complete event history and the work left to do on it, without leaving the
findings-only reading of the inspection. The history SHALL be presented in the order the events
were recorded, each event naming the state it moved to, when it occurred, and the reason, note and
evidence counts it carried. The system SHALL offer exactly the transitions the state machine allows
from the action's current state and that the reader's role and relationship to the action permit,
and SHALL offer none otherwise, saying instead that the action is waiting on someone else. Before
submitting a transition the system SHALL request the reason and the evidence that transition
requires. A corrective action in the terminal state SHALL be offered no transition at all,
including any form of reopening. The transitions offered SHALL be derived from the same state
machine the server enforces, and offering one SHALL NOT replace the server's authorization, its
verifier rule or its evidence rule.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a recorded finding has a corrective action in `open` assigned to the reader
- **WHEN** the reader opens that action from the findings-only screen and records progress
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading of the inspection is still on screen, showing the action in its new state

#### Scenario: A reader who may write nothing still reads the history

- **GIVEN** a recorded finding has a corrective action with three recorded events
- **WHEN** a `jhsc_member` opens that action from the findings-only screen
- **THEN** the three events are shown in the order they were recorded
- **AND** no transition is offered, and the screen says the action is waiting on someone else

#### Scenario: Declaring the work done asks for the evidence it requires

- **GIVEN** a corrective action in `in_progress` whose next transition requires after evidence
- **WHEN** the assignee opens it from the findings-only screen
- **THEN** the control to attach after evidence is presented before the transition can be submitted

#### Scenario: A closed action is offered nothing

- **GIVEN** a recorded finding has a corrective action in the terminal state
- **WHEN** any role opens it from the findings-only screen
- **THEN** its history is shown
- **AND** no transition is offered, and no control to reopen it exists

#### Scenario: A refused transition is not reported as done

- **GIVEN** a verifier who is the same person that declared the work done opens the action from the findings-only screen
- **WHEN** they submit the verification the state machine allows
- **THEN** the server's refusal is shown against that action
- **AND** the action is still shown in the state it was in

#### Scenario: The corrective action keeps its own screen

- **GIVEN** a corrective action reachable from an escalation notice or the corrective actions workspace
- **WHEN** it is opened by its own identifier rather than from a finding
- **THEN** its history and the transitions available to the reader are presented there as well
