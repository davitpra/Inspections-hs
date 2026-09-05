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
create a corrective action for each recorded finding, to an authenticated `hs_coordinator`
account or to the account named by that finding's `reported_by`, and to no other account. The
assignee choices SHALL contain only active people of that finding's site. The system SHALL
associate every existing corrective action with its own recorded finding and SHALL use those
actions to present that finding's persisted lifecycle, next step, nearest blocking deadline and
reached-state decisions without linking to an independent action screen. When the corrective
actions cannot be read, the system SHALL say so and SHALL NOT report that a finding has none. A
finding that already has corrective actions SHALL remain available for another one. This
presentation rule SHALL NOT replace server authorization.

#### Scenario: The coordinator is offered the creation control

- **GIVEN** a submitted inspection recorded a finding
- **WHEN** an `hs_coordinator` reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: The finding's reporter is offered the creation control (ADR-017)

- **GIVEN** a submitted inspection recorded a finding whose `reported_by` names a
  `jhsc_member` account
- **WHEN** that account reads the findings-only screen
- **THEN** a control to create a corrective action is shown for that finding

#### Scenario: Another JHSC member reads the same finding without the control

- **GIVEN** a submitted inspection recorded a finding whose `reported_by` names a different
  `jhsc_member` account
- **WHEN** a `jhsc_member` who did not raise that finding reads the findings-only screen
- **THEN** no control to create a corrective action is shown for that finding

#### Scenario: Existing corrective actions drive only their own finding

- **GIVEN** two corrective actions reference one recorded finding and one references another finding
- **WHEN** the findings-only screen is read
- **THEN** only the first two contribute to the lifecycle, next step and reached-state decisions of that finding
- **AND** none is linked to an independent corrective action screen

#### Scenario: Another role reads the commitments without being offered creation

- **GIVEN** a recorded finding already has one corrective action
- **WHEN** a `jhsc_member` who did not raise that finding reads the findings-only screen
- **THEN** that corrective action is shown with its description, responsible person, deadline and state
- **AND** no control to create a corrective action is shown

#### Scenario: A late commitment is read as late against its finding

- **GIVEN** a recorded finding has a corrective action in `in_progress` whose deadline has passed and which has escalated to the supervisor
- **WHEN** the findings-only screen is read
- **THEN** that corrective action is shown as past its deadline and as escalated to the supervisor
- **AND** its responsible person and deadline are shown without any further request

#### Scenario: Existing corrective actions are read against their own finding

- **GIVEN** two corrective actions reference the recorded finding and one references another finding
- **WHEN** the findings-only screen is read
- **THEN** only the two actions are shown under that finding
- **AND** neither is linked to an independent corrective action screen

#### Scenario: An unreadable list is not reported as no commitments

- **GIVEN** the corrective actions cannot be read
- **WHEN** the findings-only screen is read
- **THEN** the screen reports that existing corrective actions need a connection
- **AND** it does not state that the finding has no corrective action

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation control for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

### Requirement: The assignee is chosen without seeing a profile

The system SHALL offer, for choosing a corrective action's `assignee_person_id` from a
finding, the active people of that finding's site as `PersonOption` values —
`employee_number` and display name and nothing else — through a route scoped to the finding,
and SHALL NOT return through it a person's site, status, dates or any other roster attribute.
This route SHALL require no role beyond being able to read the finding itself: whoever may
choose an assignee for a finding may see this list, whether that is the coordinator or the
account named by the finding's `reported_by` (ADR-017). A deactivated person SHALL be absent
from the list, and a finding outside the reader's scope SHALL be refused with the same code as
one that does not exist.

#### Scenario: The selector returns only what a selector needs

- **WHEN** the account that raised a finding lists the people available as its assignee
- **THEN** each entry carries `employee_number` and the display name
- **AND** no other roster attribute is present in the response

#### Scenario: Deactivated people are not offered

- **GIVEN** a person whose `deactivated_at` is not null
- **WHEN** the assignee selector for a finding of their site is listed
- **THEN** that person is absent from the options

#### Scenario: The list is scoped to the finding's own site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** its assignee selector is listed
- **THEN** only active people of St. Thomas are present

#### Scenario: A finding outside the reader's scope is refused

- **WHEN** the assignee selector is requested for a finding of a site outside the reader's scope
- **THEN** the request is refused with the same code as a finding that does not exist

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

### Requirement: Every finding has an immutable state event stream

The system SHALL record each finding state exclusively as an append-only `finding_state_event`
stream whose allowed `to_state` values are `raised`, `assigned`, `in_progress`, `verification`
and `closed`. The system SHALL append an initial event from no prior state to `raised` in the same
transaction that creates every finding. The system SHALL prevent a transaction from committing a
finding without that initial event. The system SHALL prevent every update, deletion and truncation
of the state stream at the database privilege and trigger layers. The system SHALL isolate state
events by the finding's `site_id` through row level security and SHALL include every appended state
event in the site's audit chain.

#### Scenario: An inspection finding starts raised atomically

- **WHEN** an accepted inspection submission creates a finding
- **THEN** that transaction also creates its position `0` state event with `from_state` null and `to_state` `raised`
- **AND** the finding and its initial event either both commit or both roll back

#### Scenario: A manual finding also starts raised

- **WHEN** an authorized account creates a manual finding
- **THEN** its first state event is `raised`
- **AND** no caller supplies that state

#### Scenario: A state event cannot be rewritten

- **GIVEN** a `finding_state_event` has committed
- **WHEN** an application or owner connection attempts to update, delete or truncate it
- **THEN** the database refuses the mutation
- **AND** the original event remains unchanged

#### Scenario: State history is isolated and audited

- **GIVEN** a finding state event belongs to Glencoe
- **WHEN** a session scoped only to St. Thomas reads state events
- **THEN** that event is not visible
- **AND** its original insertion remains represented in the Glencoe audit chain

### Requirement: Corrective action events atomically drive finding state

The system SHALL automatically derive a finding's state after every appended corrective action
event for an action that references that finding. The system SHALL derive `raised` when no action
references the finding; otherwise it SHALL use the least advanced current action state, mapping
`open` to `assigned`, `in_progress` to `in_progress`, `awaiting_verification` to `verification`
and all actions `closed` to `closed`. When the derived value differs from the finding's latest
state event, the system SHALL append the next `finding_state_event` in the same transaction and
SHALL reference the causal corrective action event. When the derived value is unchanged, the
system SHALL NOT append a duplicate state event. The system SHALL allow later action events to
move a finding backward as well as forward.

#### Scenario: The first action assigns a raised finding

- **GIVEN** a finding's latest state event is `raised`
- **WHEN** a corrective action is created, which appends its `open` event
- **THEN** the same transaction appends a finding state event from `raised` to `assigned`
- **AND** the finding's current state is `assigned`

#### Scenario: Starting the action moves the finding into work

- **GIVEN** a finding in `assigned` whose only action is `open`
- **WHEN** the assigned person or an `hs_coordinator` moves that action to `in_progress`
- **THEN** the same transaction appends a finding state event from `assigned` to `in_progress`

#### Scenario: The least advanced action determines state

- **GIVEN** a finding has one current action in `closed` and another in `open`
- **WHEN** the aggregate state is derived after an action event
- **THEN** the finding's current state is `assigned`
- **AND** it is not `closed`

#### Scenario: Every action must close before the finding closes

- **GIVEN** a finding has two corrective actions and one remains in `verification`
- **WHEN** the other action moves to `closed`
- **THEN** no `closed` finding event is appended
- **AND** the finding remains in `verification`

#### Scenario: Refusing verification returns the finding to work

- **GIVEN** a finding in `verification` has one corrective action in `awaiting_verification`
- **WHEN** verification is refused and the action event moves to `in_progress`
- **THEN** the same transaction appends a finding state event from `verification` to `in_progress`

#### Scenario: A new action regresses a closed finding

- **GIVEN** a finding's latest state event is `closed` and all its existing actions are closed
- **WHEN** an authorized account creates another corrective action for that finding
- **THEN** the same transaction appends a finding state event from `closed` to `assigned`
- **AND** the new action remains valid

#### Scenario: An unchanged aggregate creates no noise

- **GIVEN** one action in `in_progress` already keeps a finding in `in_progress`
- **WHEN** another action of that finding moves to `awaiting_verification`
- **THEN** no additional finding state event is appended
- **AND** the finding remains `in_progress`

#### Scenario: A causal failure rolls back both streams

- **GIVEN** an action event would change its finding's aggregate state
- **WHEN** appending the corresponding finding state event fails
- **THEN** the corrective action event also rolls back
- **AND** neither stream exposes a partial transition

### Requirement: Every Finding response exposes the latest persisted state

The system SHALL include a required `state` in every current `Finding` response and SHALL obtain
it from the latest event by that finding's event position. The system SHALL NOT infer the response
state from a client-provided value or from the action list. The system SHALL treat a persisted
finding without a state event as invalid data rather than silently reporting it as `raised`.

#### Scenario: The findings list carries current state

- **GIVEN** a finding's latest event has `to_state` `in_progress`
- **WHEN** an authorized reader lists findings
- **THEN** that finding's `state` is `in_progress`

#### Scenario: A submitted inspection carries current finding state

- **GIVEN** a submitted inspection contains a finding whose latest event is `verification`
- **WHEN** the submitted inspection is read
- **THEN** its embedded finding has `state` `verification`

#### Scenario: A stale action snapshot does not redefine state

- **GIVEN** the latest finding event is `assigned`
- **WHEN** a client reads that finding alongside an older cached action list
- **THEN** the Finding response still reports `state` `assigned`

### Requirement: A recorded finding presents its persisted five-state lifecycle and one next step

The system SHALL present `finding.state` as the current position in the ordered lifecycle Raised,
Assigned, In progress, Verification and Closed. The system SHALL identify the state in words and
SHALL NOT rely on colour alone. The system SHALL use corrective actions only to identify the
blocking commitment, its nearest deadline and the permitted next transition; it SHALL NOT
recalculate the finding state from those actions. For a raised finding, the system SHALL offer
creation of a corrective action to an authenticated `hs_coordinator` or to the account named by
`reported_by`, and to no other account (ADR-017). The system SHALL accept that composition within
the finding's next step itself, without leaving the findings-only reading or opening a separate
view, and SHALL NOT present the control that begins the composition alongside the composition it
began. For a later non-closed state, the system SHALL offer at most one primary transition
permitted by the action state machine and the reader's role or relationship. When the reader may attempt no transition, the system SHALL name who the finding
is waiting on. The system SHALL offer a closed finding no action transition, while still allowing
an authorized account to create another corrective action. After a successful action creation or
transition, the system SHALL refresh cached action, finding and submitted-inspection readings that
can contain the changed state.

For a raised finding whose reader may create the corrective action, the system SHALL present that
composition folded behind a single control naming the act, and SHALL present neither the lifecycle
states nor the composition until that control is used. The system SHALL NOT fold the lifecycle of
any other finding, nor of a raised finding whose reader may not create the action: a finding that
has already recorded a decision SHALL present its lifecycle without asking for a gesture first.
The system SHALL request the roster of people available as assignee only for a finding whose
composition has been opened.

The system SHALL present the next step within the record of the state the finding is currently
in, and SHALL open that state by default. The single exception SHALL be an opened corrective action
composition, which the system SHALL present in the Assigned state that composition would write and
SHALL open by default; the system SHALL then mark that state in words as not yet recorded and
SHALL present no deadline for it. An unsubmitted composition or transition SHALL NOT move the
lifecycle indicator, which SHALL keep naming the persisted state. No other state the finding has
not reached SHALL be presented or offered.

The system SHALL let the reader open any lifecycle state the finding has already reached and read
the business decisions recorded there, without leaving the findings-only reading. Raised SHALL
present the observation facts recorded with the finding. Assigned SHALL present each corrective
action commitment with its responsible person, description and `due_at`. In progress and Verification
SHALL present one shared thread of every decision recorded in either of them — each decision that
began or resumed the work, and each declaration that the work was done with its submitted note and
before/after evidence counts when present — and opening either state SHALL present that same thread.
A decision that sent verification back to In progress SHALL be presented in that thread with its
required reason and optional note. Closed SHALL present each verification decision and its submitted
note when present, and SHALL NOT be merged into that thread. The system SHALL name each decision in
a record by the step that recorded it, and SHALL NOT name it by an event position or by a raw
destination state. A step that recorded no reason, note or evidence SHALL be presented as its named
decision alone rather than omitted.
If several actions or repeated passes through a state contribute decisions, the system SHALL
present every applicable decision in recorded order and SHALL NOT collapse a later decision into
an earlier one.

Reading a reached state SHALL be read-only: it SHALL NOT offer any transition and SHALL NOT
change the state the finding is reported to be in. The system SHALL NOT offer a state the finding
has not reached, other than the Assigned state of an opened corrective action composition. The
system SHALL NOT offer this navigation while an assignment replacement is being composed, whose
entered values would not survive changing panels; an unsubmitted corrective action composition
SHALL NOT withdraw that navigation, and SHALL be presented with its entered values intact when its
state is opened again. When the record of a reached state cannot be read, the system SHALL say so
and SHALL NOT report that nothing was recorded there.

#### Scenario: The persisted state drives the lifecycle indicator

- **GIVEN** `finding.state` is `verification`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as the current lifecycle state
- **AND** the screen does not derive another state from cached actions

#### Scenario: A raised finding offers the act before the lifecycle

- **GIVEN** `finding.state` is `raised` and the reader is named by its `reported_by`
- **WHEN** the findings-only screen is read
- **THEN** one control naming the creation of a corrective action is offered
- **AND** no lifecycle state and no composition are presented for that finding
- **AND** the roster of people available as assignee is not requested

#### Scenario: An opened composition is read in the state it would write

- **GIVEN** `finding.state` is `raised` and its reader may create the corrective action
- **WHEN** that reader uses the control that begins the composition
- **THEN** Assigned is the lifecycle state opened, and the composition is presented in it
- **AND** Assigned is named in words as not yet recorded, with no deadline presented
- **AND** Raised is still named as the current lifecycle state
- **AND** the control that began the composition is no longer presented

#### Scenario: Reading Raised does not discard the composition

- **GIVEN** an opened composition holds a responsible person, a description and a deadline that were not submitted
- **WHEN** the reader opens Raised and then opens Assigned again
- **THEN** the observation facts recorded with the finding are presented in Raised
- **AND** the composition is presented again with the same entered values
- **AND** no corrective action was created

#### Scenario: A raised finding a reader cannot assign is not folded

- **GIVEN** `finding.state` is `raised` and a `jhsc_member` who did not raise it reads the screen
- **WHEN** the findings-only screen is read
- **THEN** the lifecycle states are presented without asking for a gesture first
- **AND** Raised is the lifecycle state opened by default
- **AND** no composition and no control that begins one are offered
- **AND** Assigned cannot be opened

#### Scenario: A reached state presents decisions without moving the finding

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the reader opens the Assigned state
- **THEN** each applicable action's responsible person, description and `due_at` are presented
- **AND** In progress is still named as the current lifecycle state
- **AND** no transition is offered for the state being read

#### Scenario: The next step is read inside the current state

- **GIVEN** `finding.state` is `assigned` and its blocking action is `open`
- **WHEN** a reader permitted to begin the work opens the findings-only screen
- **THEN** Assigned is the lifecycle state opened by default
- **AND** the commitment recorded in Assigned is presented above the next step
- **AND** the transition from `open` to `in_progress` is offered in that same state
- **AND** In progress cannot be opened

#### Scenario: A state the finding has not reached is not offered

- **GIVEN** `finding.state` is `in_progress`
- **WHEN** the findings-only screen is read
- **THEN** Verification is named as a lifecycle state
- **AND** Verification cannot be opened

#### Scenario: An unreadable record is not reported as an empty one

- **GIVEN** a reader opens a reached state and its corrective action cannot be read
- **WHEN** the record is presented
- **THEN** the screen says the decisions need a connection
- **AND** it does not report that no decision was recorded in that state

#### Scenario: Completion is read as a decision rather than an event

- **GIVEN** an action reached `awaiting_verification` with a note, one before item and two after items
- **WHEN** the reader opens the Verification state
- **THEN** the decision to declare the work done is presented with that note and the two evidence counts
- **AND** no event position or raw destination state is presented

#### Scenario: A rejected verification is read beside the declaration it refused

- **GIVEN** verification sent an action from `awaiting_verification` to `in_progress` with a required `reason` and an optional `note`
- **WHEN** the reader opens either the In progress state or the Verification state
- **THEN** the decision to send the work back is presented with its `reason` and `note`
- **AND** the declaration it refused is presented before it in the same thread
- **AND** an earlier decision that began the work remains present before both

#### Scenario: A step that recorded nothing else is still named

- **GIVEN** an action moved from `open` to `in_progress` with no note and no evidence
- **WHEN** the reader opens the In progress state
- **THEN** that decision is presented, named as the step that started the work
- **AND** no reason, note or evidence is presented for it

#### Scenario: Closure is not merged into the work thread

- **GIVEN** an action was closed with a submitted note
- **WHEN** the reader opens the Verification state
- **THEN** the closure note is not presented there
- **AND** it is presented when the reader opens the Closed state

#### Scenario: Repeated and parallel decisions are not collapsed

- **GIVEN** two actions of one finding contributed decisions to the same reached state and one action passed through that state twice
- **WHEN** the reader opens that state
- **THEN** every applicable decision from both actions is presented in recorded order

#### Scenario: The reporter can assign a raised finding

- **GIVEN** a finding has `state` `raised` and its `reported_by` names the reader
- **WHEN** that reader opens the findings-only screen
- **THEN** the one primary next step is to create a corrective action

#### Scenario: The assignee is offered the blocking action's next step

- **GIVEN** a finding has `state` `in_progress` and its least advanced action is `in_progress` and
  assigned to the reader
- **WHEN** the reader opens the findings-only screen
- **THEN** the one primary next step names the move from `in_progress` to `awaiting_verification`

#### Scenario: A reader who cannot act is told who owes the step

- **GIVEN** a finding has `state` `in_progress` and its blocking action belongs to another person
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** no next step control is offered
- **AND** the blocking action's `assignee_name` is named as who the finding is waiting on

#### Scenario: A new action is still available after closure

- **GIVEN** a finding has `state` `closed`
- **WHEN** an account authorized to create corrective actions reads it
- **THEN** no transition is offered for a closed action
- **AND** the control to create another corrective action remains available

#### Scenario: A successful transition refreshes every affected reading

- **GIVEN** an action transition changes a finding from `in_progress` to `verification`
- **WHEN** the transition succeeds from the findings-only screen
- **THEN** the action list and detail are refreshed as applicable
- **AND** cached finding lists and submitted-inspection readings are refreshed
- **AND** the screen remains on the inspection and shows `finding.state` `verification`

### Requirement: Closed findings present the evidence accepted by verification

The system SHALL present, for each closed corrective action, the `before` and `after` photographs
attached to the last work-completion declaration before the transition to `closed`. The system SHALL
NOT present photographs attached to a work-completion declaration that was later sent back to
`in_progress`. The Closed record SHALL remain readable when the accepted declaration contains no
photographs.

#### Scenario: Closed presents the accepted photographs

- **WHEN** an action reaches `closed` after a completion declaration containing `before` and `after` evidence
- **THEN** the Closed record presents those photographs grouped by `kind`

#### Scenario: Rejected photographs are excluded

- **WHEN** an earlier completion declaration was sent back to `in_progress` and a later declaration was accepted
- **THEN** the Closed record presents only the evidence from the later accepted declaration

#### Scenario: Closure without photographs remains readable

- **WHEN** the accepted completion declaration has an empty `evidence` array
- **THEN** the Closed record presents the corrective action without claiming that the stage was not recorded

### Requirement: A corrective action is advanced from the finding that justifies it

The system SHALL offer, for the corrective action currently holding a recorded finding at its
persisted state, the transitions the action state machine allows and that the reader's role and
relationship permit, presented within the finding's next step itself — with no control that
reveals them, and without leaving the findings-only reading or opening a separate view — so that
the step takes one interaction to submit. When the reader may attempt no transition, the
system SHALL offer none and SHALL say that the action is waiting on someone else. Before a
transition that requires a reason, the system SHALL request it. When work can be declared done,
the system SHALL present the control to attach evidence without making evidence a condition of
submission. The system SHALL NOT present a note field for a transition that takes no note, so
that starting the work assigned by a corrective action is submitted by its control alone. The
system SHALL offer a corrective action in its terminal state no transition.

The findings-only reading SHALL NOT present the action's event history as a technical history or
timeline. The complete history SHALL remain available from the action API as source data. The
findings-only reading SHALL instead present the result of each
submitted next-step decision under the reached finding state to which that decision contributes,
using the values submitted by the same creation or transition control. The system SHALL derive
offered transitions from the same state machine enforced by the server and SHALL NOT treat an
offered transition as authorization. After a successful transition, the system SHALL refresh the
action and every cached Finding reading whose persisted state may have changed.

#### Scenario: The assignee advances their own action without leaving the finding

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader submits the next step, which was presented with nothing to reveal first
- **THEN** the action moves to `in_progress`
- **AND** the findings-only reading remains on screen with `finding.state` `in_progress`

#### Scenario: Starting the work asks for nothing

- **GIVEN** a finding has `state` `assigned` and an action in `open` assigned to the reader
- **WHEN** the reader opens the findings-only screen
- **THEN** the next step presents no note field
- **AND** the move from `open` to `in_progress` is submitted by its control alone

#### Scenario: A reader who may write nothing is offered no next step

- **GIVEN** a recorded finding has a corrective action the reader may not advance
- **WHEN** a `jhsc_member` reads the findings-only screen
- **THEN** no next step control is offered to that reader
- **AND** the screen says the action is waiting on someone else

#### Scenario: Declaring work done offers evidence without demanding it

- **GIVEN** a corrective action in `in_progress` can move to `awaiting_verification`
- **WHEN** the assignee reads the finding's next step
- **THEN** the control to attach after evidence is presented
- **AND** the transition can be submitted without evidence

#### Scenario: A closed action is offered no transition or technical timeline

- **GIVEN** a corrective action is in its terminal state
- **WHEN** any role reads the findings-only screen
- **THEN** no next step, transition or action-reopening control is offered
- **AND** its submitted decisions can be read by reached finding state without an event timeline

#### Scenario: Verification refusal records the regression

- **GIVEN** a verifier is permitted to reject an action in `awaiting_verification`
- **WHEN** the verifier submits the required reason
- **THEN** the action moves to `in_progress`
- **AND** the persisted finding state is refreshed from its new `in_progress` event

#### Scenario: A refused transition is not reported as done

- **GIVEN** a verifier is the same person who declared the work done
- **WHEN** that verifier submits approval from the findings-only screen
- **THEN** the server's refusal is shown against the action
- **AND** neither the action stream nor the finding state stream advances

#### Scenario: The action API retains the complete immutable history

- **GIVEN** a corrective action is read through `GET /actions/:id`
- **WHEN** the independent action detail route is no longer available
- **THEN** the response still carries its complete `events` and evidence in recorded order
- **AND** no findings-only screen renders those records as an event timeline

### Requirement: An active finding exposes its current assignment for correction

The system SHALL present `Edit assignment` in the current next step of an `assigned` or
`in_progress` finding to an authenticated `hs_coordinator` or the account named by `reported_by`, and
to no other account. It SHALL decide that offer on the derived state of the corrective action that
holds the finding in its stage, using the same editable-state rule the server applies. The inline form
SHALL contain the current `assignee_person_id`, `description` and `due_at`. A successful submission
SHALL preserve the finding state, refresh affected readings and present only the replacement values.
A failed submission SHALL preserve the entered values. A `verification` or `closed` finding SHALL
offer no assignment editing.

#### Scenario: An authorized reader edits while the work is in progress

- **GIVEN** a finding is `in_progress` and the reader may edit its action
- **WHEN** the reader chooses `Edit assignment`
- **THEN** the current responsible person, work and due date are available inline

#### Scenario: Verification presents its decision without an assignment editor

- **GIVEN** a finding is `verification` and the reader may edit its action
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered
- **AND** the verification outcomes of the step are still offered

#### Scenario: A refused verification restores assignment editing

- **GIVEN** a `verification` finding whose reader may edit its action
- **WHEN** the reader sends the work back and the finding returns to `in_progress`
- **THEN** `Edit assignment` is offered again

#### Scenario: Closure removes assignment editing

- **GIVEN** a finding exposes `Edit assignment`
- **WHEN** its corrective action reaches `closed`
- **THEN** `Edit assignment` is no longer offered

#### Scenario: An unauthorized reader cannot edit an assignment

- **GIVEN** an `assigned` or `in_progress` finding whose reader is neither an `hs_coordinator` nor
  its `reported_by`
- **WHEN** the current next step is presented
- **THEN** no `Edit assignment` control is offered

### Requirement: The Assigned record presents one current assignment

The system SHALL present only the effective responsible person, description and `due_at` when the
reader opens the reached Assigned stage. It SHALL NOT present the original value, edit versions,
amendment labels or an assignment-history list. Reading that record SHALL remain read-only.

#### Scenario: A corrected assignment replaces the visible values

- **GIVEN** an action assignment was corrected twice
- **WHEN** the reader opens the Assigned stage record
- **THEN** only the latest responsible person, description and `due_at` are presented
- **AND** no previous value or amendment label is presented

### Requirement: An inspector browses inspection-derived findings by inspection type

The system SHALL present one named findings section per `template_id` for which the signed-in
account completed at least one inspection that recorded a finding. Each section SHALL contain
all matching inspections most recent first on the same page, and each inspection SHALL offer
its existing findings-only reading. The sections SHALL be ordered by inspection type name.

The findings sections SHALL exclude clean inspections, inspections completed by another
account, incomplete periods and manual findings that have no `inspection_id` or inspection
type. They SHALL derive findings from the reader's existing site-scoped finding listing.

#### Scenario: Inspection versions share one findings type section

- **GIVEN** the account completed two inspections with one `template_id` under different
  `template_version_id` values and both recorded findings
- **WHEN** the account views findings
- **THEN** one section is presented for that `template_id`
- **AND** its table contains both completed inspections

#### Scenario: Multiple findings count as one inspection

- **GIVEN** one completed inspection recorded three findings
- **WHEN** the account views findings
- **THEN** that inspection is presented once in its type section

#### Scenario: Clean and foreign inspections are excluded

- **GIVEN** the account completed a clean inspection and another account completed an
  inspection that recorded a finding
- **WHEN** the account views findings
- **THEN** neither inspection is presented in a type section

#### Scenario: All findings types are visible on one page

- **GIVEN** the account completed inspections of one `template_id` in `2027-05` and `2027-07`
  and both recorded findings
- **WHEN** the account views findings
- **THEN** the two inspections are listed in the order `2027-07`, `2027-05`
- **AND** each inspection offers its findings-only reading addressed by scheduled inspection id
