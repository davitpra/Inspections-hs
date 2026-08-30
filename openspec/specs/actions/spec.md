## Purpose

Turns a finding, or the investigation of an incident, into an obligation with a named owner and a
deadline declared by the HS coordinator, records every step of that obligation as an immutable event
rather than a status column, records optional evidence, requires a second person's verification to
close it, and escalates it to the supervisor and then to management when it runs past its deadline
unclosed.

## Requirements

### Requirement: Corrective actions are not an independent application destination

The system SHALL NOT expose an authenticated navigation entry, workspace, inspection-grouped
listing, or independent detail route for corrective actions. Removing those application routes
SHALL NOT remove the site-scoped action reads, event history, transitions, evidence, escalation,
or audit behavior used by findings and server workflows. The immutable event history SHALL remain
available through the action API as source data, but the findings-only reading SHALL present the
business decisions represented by that data rather than an event timeline.

#### Scenario: The application has no corrective actions navigation entry

- **WHEN** an authenticated account reads the application navigation
- **THEN** no corrective actions workspace entry is presented

#### Scenario: A retired action URL does not resolve

- **WHEN** an account requests `/actions`, `/actions/inspection/$inspectionId`, or `/actions/$id`
- **THEN** the application returns its not-found experience
- **AND** it does not redirect the account to another route

#### Scenario: Non-inspection actions have no v1 application surface

- **GIVEN** a corrective action belongs to a manual finding or an incident investigation
- **WHEN** an authenticated account uses the v1 application
- **THEN** the application offers no route that lists or opens that action
- **AND** the action and its immutable records remain stored and available to server workflows

#### Scenario: Removing the detail route does not remove the immutable record

- **GIVEN** a corrective action has creation, completion and verification events
- **WHEN** the independent action detail route is retired
- **THEN** `GET /actions/:id` continues to return its complete event and evidence history
- **AND** the findings-only reading translates applicable records into decisions instead of an event timeline

### Requirement: A corrective action belongs to exactly one parent, a finding or an investigation

The system SHALL store every corrective action as a `corrective_action` row carrying `site_id`,
`assignee_person_id`, `description`, `due_at`, `created_by` and exactly one of `finding_id` and
`investigation_id`. A parent MAY have many corrective actions and a corrective action SHALL belong
to exactly one parent, as §4 closed; the exactly-one rule SHALL be a check constraint in the
database and not an application check. The system SHALL NOT require anything of the parent beyond
its existence within the session's scope: a finding carries no classification and yields no
property the action derives. The action's `site_id` SHALL be the `site_id` of its parent, enforced
by the engine through the composite foreign key of whichever parent it names.

#### Scenario: An action is created for a finding

- **WHEN** the HS coordinator creates an action for a finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that `finding_id`
- **AND** its `investigation_id` is null
- **AND** its `site_id` is the finding's `site_id`

#### Scenario: An action is created for an investigation

- **WHEN** the HS coordinator creates an action for an investigation, with an
  `assignee_person_id`, a `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that `investigation_id`
- **AND** its `finding_id` is null
- **AND** its `site_id` is the investigation's `site_id`

#### Scenario: A finding needs nothing else to receive an action

- **GIVEN** a derived finding just created by an accepted submission
- **WHEN** an action is created for it
- **THEN** the `corrective_action` row is created

#### Scenario: An action with no parent is refused

- **WHEN** a `corrective_action` row is inserted with both `finding_id` and `investigation_id` null
- **THEN** the insert fails on the check constraint

#### Scenario: An action with two parents is refused

- **WHEN** a `corrective_action` row is inserted carrying both a `finding_id` and an
  `investigation_id`
- **THEN** the insert fails on the check constraint

#### Scenario: One parent carries several actions

- **WHEN** three actions are created for the same finding
- **THEN** three `corrective_action` rows reference that `finding_id`
- **AND** each carries its own `assignee_person_id` and its own `due_at`

#### Scenario: An action cannot name a site other than its parent's

- **WHEN** a `corrective_action` row is inserted whose `site_id` differs from the `site_id` of the
  parent it names
- **THEN** the insert fails on that parent's composite foreign key

#### Scenario: Actions written before the second parent existed remain valid

- **GIVEN** corrective actions created before this change, all carrying a `finding_id`
- **WHEN** the exactly-one check constraint is added
- **THEN** every existing row satisfies it and none is rewritten

#### Scenario: A description of two characters is refused

- **WHEN** an action is created with the `description` `fix`
- **THEN** the request is rejected and no `corrective_action` row is created

### Requirement: The responsible party is a named person of the action's own site

The system SHALL require `assignee_person_id` to name an active `person` of the action's own site,
as §3 R2 demands a named person and not a job title or a queue. The system SHALL refuse an
assignee whose `person.deactivated_at` is not null and one who belongs to another site. The
reference SHALL be to `person (id)` alone and SHALL NOT freeze the pair `(site, person)`, because
`person.site_id` is mutable and a transfer between workplaces MUST NOT retroactively invalidate or
rewrite the actions that name that person — the same rule migration 0005 already states for every
table of stages 4 to 6. The site of the assignee SHALL therefore be checked when the action is
created, and the guarantee that only people of the site are offered SHALL come from the row level
security policy on `person`. Because
Persona ≠ Usuario, an assignee MAY have no account; in that case the HS coordinator records the
progress on their behalf and the events name the coordinator's account as actor, which is what the
audit chain has to be able to state.

#### Scenario: An assignee of the other site is refused

- **GIVEN** an action for a St. Thomas finding
- **WHEN** its `assignee_person_id` names a person of Glencoe
- **THEN** the request is rejected with the code `invalid_assignee`
- **AND** no action is created

#### Scenario: Transferring a person does not touch the actions that name them

- **GIVEN** an action of St. Thomas assigned to a person
- **WHEN** that person's `site_id` is later changed to Glencoe
- **THEN** the action's `site_id` is still St. Thomas and its `assignee_person_id` is unchanged
- **AND** the action still resolves the person's `employee_number` and name

#### Scenario: A deactivated person cannot be made responsible

- **WHEN** an action is created naming a person whose `deactivated_at` is not null
- **THEN** the request is rejected with the code `invalid_assignee`

#### Scenario: A person with no account can still be responsible

- **WHEN** an action is created naming a person with no `app_user` row
- **THEN** the action is created
- **AND** the transitions recorded by the coordinator on their behalf name the coordinator's
  account as actor

### Requirement: The deadline is stated by the HS coordinator and frozen at creation

The system SHALL require a `due_at` when a corrective action is created, for a finding and for an
investigation alike, and SHALL store it unchanged on the row, so the record states what was
promised the day it was promised. The system SHALL refuse a creation with no `due_at`, and SHALL
refuse a `due_at` that is not later than the moment of creation with the code `invalid_due_at`,
because an action born overdue escalates before anyone can act on it. That comparison reads the
current time, so it SHALL be enforced when the request is served and not by a database check. The
system SHALL NOT derive the deadline from any property of the parent and SHALL NOT store a severity
on the action. The stored `due_at` column SHALL never move afterwards; while the action's derived
state is `open` an accepted commitment amendment MAY supersede it for every reading, and once work
has started a different deadline is obtained only by opening a new action.

#### Scenario: The stored deadline is the one the coordinator stated

- **WHEN** the HS coordinator creates an action on `2026-08-10T09:00:00-04:00` stating `due_at`
  `2026-09-30T17:00:00-04:00`
- **THEN** the stored `due_at` is `2026-09-30T17:00:00-04:00`

#### Scenario: An action of an investigation states its deadline the same way

- **WHEN** the HS coordinator creates an action for an investigation stating a `due_at` two weeks
  out
- **THEN** the stored `due_at` is that date
- **AND** no `severity` is required and none is stored

#### Scenario: A deadline already past is refused

- **WHEN** an action is created with a `due_at` one day before the moment of creation
- **THEN** the request is rejected with the code `invalid_due_at`
- **AND** no `corrective_action` row is created

#### Scenario: An action with no deadline is refused

- **WHEN** an action is created with no `due_at`
- **THEN** the request is rejected
- **AND** no `corrective_action` row is created

#### Scenario: The deadline of an open action does not move

- **GIVEN** an action created with a `due_at` fourteen days out
- **WHEN** an `UPDATE` sets its `due_at` to a later date
- **THEN** the engine rejects the update and the stored `due_at` is unchanged
### Requirement: The state of an action is derived from its events and is never stored as a column

The system SHALL record every step of an action as a `corrective_action_event` row and SHALL NOT
store a status column on `corrective_action`. The current state of an action SHALL be the
`to_state` of its highest event, obtained as `SELECT DISTINCT ON (action_id) to_state FROM
corrective_action_event ORDER BY action_id, position DESC`. The states SHALL be exactly `open`,
`in_progress`, `awaiting_verification` and `closed`. Creating an action SHALL write its first
event, with `position` `0`, a null `from_state` and `to_state` `open`, in the same transaction as
the action row, so that no action can exist without a state.

Creating an action SHALL write only that first event: naming a responsible person, the work and the
deadline does not begin the work. The action SHALL stay in `open` until the assigned person or an
`hs_coordinator` requests `open` → `in_progress`.

#### Scenario: Creating an action writes its first event

- **WHEN** an action is created
- **THEN** one `corrective_action_event` row exists for it with `position` `0`, `from_state` null
  and `to_state` `open`
- **AND** that row names the creating account

#### Scenario: A created action waits for work to start

- **WHEN** an action is created and its state is read
- **THEN** the derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: An action starts by hand

- **GIVEN** an action whose only event is `to_state` `open`
- **WHEN** the assigned person or an `hs_coordinator` requests `open` → `in_progress`
- **THEN** the transition is accepted

#### Scenario: The current state is the last event's

- **GIVEN** an action with events `open`, `in_progress` and `awaiting_verification`
- **WHEN** its state is read
- **THEN** the state returned is `awaiting_verification`
- **AND** all three events are still present and unchanged

#### Scenario: There is no status column to read or write

- **WHEN** the columns of `corrective_action` are listed
- **THEN** no column named `status`, `state` or `current_state` exists

#### Scenario: An action cannot be committed without its first event

- **WHEN** a `corrective_action` row is inserted and the transaction commits with no
  `corrective_action_event` row for it
- **THEN** the commit fails with the dedicated SQLSTATE of the deferred first-event constraint

### Requirement: A newly created action waits for work to start

The system SHALL create a corrective action with exactly one initial `corrective_action_event` whose
`to_state` is `open`. The system SHALL NOT append `open` to `in_progress` during creation. Starting
work SHALL remain the existing explicit state transition available to the assigned person or an
`hs_coordinator`.

#### Scenario: Creation leaves the action assigned

- **WHEN** an authorized account creates a corrective action
- **THEN** its derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: Starting work closes the amendment window

- **GIVEN** an open action has its current commitment
- **WHEN** the assigned person or an `hs_coordinator` moves it to `in_progress`
- **THEN** the transition is accepted
- **AND** later commitment amendments are refused

### Requirement: An open action commitment can be amended without rewriting its past

The system SHALL allow an authenticated `hs_coordinator`, or the account named by the parent
finding's `reported_by`, to submit a complete replacement `assignee_person_id`, `description` and
`due_at` while the corrective action's derived state is `open`. The system SHALL require the new
assignee to be active and belong to the action's site, and SHALL require `due_at` to be later than
the amendment instant. The system SHALL refuse every amendment after the action leaves `open`.

The system SHALL append each accepted replacement with its actor and occurrence time and SHALL
preserve the original commitment and every earlier amendment. Action summaries, action details,
deadline processing and subsequent authorization SHALL use the latest accepted commitment.

#### Scenario: A finding reporter corrects an assigned action

- **GIVEN** a corrective action is `open` and belongs to a finding whose `reported_by` names the reader
- **WHEN** the reader submits a valid `assignee_person_id`, `description` and future `due_at`
- **THEN** an amendment is appended and the action remains `open`
- **AND** subsequent reads expose those values as the current commitment

#### Scenario: Work that has started cannot be reassigned

- **GIVEN** a corrective action's current state is `in_progress`
- **WHEN** an otherwise authorized account submits an amendment
- **THEN** the request is rejected with the code `invalid_action_state`
- **AND** no amendment is appended

#### Scenario: The original and corrected commitments remain readable

- **GIVEN** an open action has two accepted amendments
- **WHEN** its detail is read
- **THEN** the original commitment and both amendments are returned in recorded order
- **AND** the second amendment supplies the current `assignee_person_id`, `description` and `due_at`

#### Scenario: Concurrent amendments do not fork the history

- **GIVEN** an open action whose latest commitment position is known
- **WHEN** two amendments are submitted concurrently
- **THEN** at most one occupies the next `(action_id, position)`
- **AND** the action has one unambiguous current commitment

### Requirement: Only the transitions of the state machine are accepted

The system SHALL accept exactly these transitions: `open` → `in_progress`, `in_progress` →
`awaiting_verification`, `awaiting_verification` → `closed`, and `awaiting_verification` →
`in_progress` when the verification is refused. `closed` SHALL be terminal: no event SHALL be
appended to an action whose current state is `closed`. Every other pair SHALL be refused. The
system SHALL evaluate the transition table as a pure function shared by the endpoint, and SHALL
enforce the same table in the database, so that an event inserted outside the endpoint cannot
produce a sequence the machine forbids. Every event SHALL carry the `from_state` it was applied
to, and that `from_state` SHALL equal the current state of the action at the time the event is
written.

#### Scenario: An open action cannot jump to closed

- **GIVEN** an action whose current state is `open`
- **WHEN** a transition to `closed` is requested
- **THEN** the request is rejected with the code `invalid_transition`
- **AND** no event is appended

#### Scenario: A closed action accepts nothing further

- **GIVEN** an action whose current state is `closed`
- **WHEN** any transition is requested for it
- **THEN** the request is rejected with the code `invalid_transition`

#### Scenario: A forbidden transition inserted directly is refused by the engine

- **WHEN** a `corrective_action_event` row with `from_state` `open` and `to_state` `closed` is
  inserted directly, bypassing the endpoint
- **THEN** the insert fails on the transition guard

#### Scenario: An event whose from_state is not the current state is refused

- **GIVEN** an action whose current state is `in_progress`
- **WHEN** an event with `from_state` `open` is inserted for it
- **THEN** the insert fails on the transition guard

#### Scenario: Two concurrent transitions do not fork the stream

- **GIVEN** an action whose current state is `open`
- **WHEN** two requests move it to `in_progress` at the same time
- **THEN** one commits and the other fails with a unique violation on `(action_id, position)`
- **AND** the action has exactly one current state

#### Scenario: The two implementations of the table agree

- **WHEN** every ordered pair of the four states is evaluated by the shared pure function and by
  the database guard
- **THEN** the two report the same set of accepted pairs

### Requirement: Completion evidence is recorded and never required

The system SHALL accept evidence of `kind` `before` and `kind` `after` on any event of a
corrective action, and SHALL NOT require evidence of any kind for any transition, including
`in_progress` → `awaiting_verification`. Evidence SHALL be stored as an `object_key` of a file
uploaded beforehand and SHALL NEVER carry image bytes. The system SHALL reject an `object_key`
outside the prefix derived from the action's own `site_id` and its own identifier. No endpoint,
constraint or trigger SHALL prevent an action from reaching `awaiting_verification` with no
evidence attached, so that a completed repair is never held in `in_progress` by the absence of a
photograph.

#### Scenario: Completing with no evidence is accepted

- **GIVEN** an action whose current state is `in_progress`
- **WHEN** the assignee declares the work done with an empty `evidence` array
- **THEN** the action's state becomes `awaiting_verification`
- **AND** no `corrective_action_evidence` row references the event that moved it

#### Scenario: A completion event with no after evidence commits

- **WHEN** an event with `to_state` `awaiting_verification` is inserted with no
  `corrective_action_evidence` row of `kind` `after` for it
- **THEN** the transaction commits
- **AND** the action reads as `awaiting_verification`

#### Scenario: Before and after evidence are both recorded

- **WHEN** the assignee declares the work done with one `before` and two `after` object keys
- **THEN** three `corrective_action_evidence` rows reference that event
- **AND** the action's state becomes `awaiting_verification`

#### Scenario: Evidence of another site's prefix is refused

- **WHEN** an evidence `object_key` outside the prefix derived from the action's `site_id` and id
  is submitted
- **THEN** the request is rejected with the code `invalid_evidence`

#### Scenario: Evidence already recorded survives the change

- **GIVEN** an action that reached `awaiting_verification` carrying two `after` object keys
- **WHEN** the action is read by its identifier
- **THEN** the event that moved it still lists both `corrective_action_evidence` rows

### Requirement: The verifier is someone other than the executor, unless they are the HS coordinator

The system SHALL refuse the transition `awaiting_verification` → `closed`, and the refusal
`awaiting_verification` → `in_progress`, when the acting account is the `actor_user_id` of the
event that moved the action to `awaiting_verification` **and** that account's role is
`supervisor` or `management`. An `hs_coordinator` account SHALL be accepted for both
transitions even when it is the `actor_user_id` of that event. The rule SHALL be enforced by
the database and not only by the endpoint, and the database SHALL decide the exception from the
acting account's own role, not from a value supplied with the event. When the verification is
refused, the event SHALL carry a `reason`; when it closes the action, a `reason` SHALL NOT be
required.

#### Scenario: A supervisor cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by the supervisor who executed it
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: A manager cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`

#### Scenario: The rule holds for a direct insert too

- **WHEN** a closing event whose `actor_user_id` equals the `supervisor` actor of the completion
  event is inserted directly, bypassing the endpoint
- **THEN** the insert fails on the verifier guard

#### Scenario: The HS coordinator closes an action they declared done

- **GIVEN** an action moved to `awaiting_verification` by an `hs_coordinator` account
- **WHEN** that same account closes it
- **THEN** the action's state becomes `closed`
- **AND** the closing event names that coordinator as `actor_user_id`

#### Scenario: The HS coordinator sends back work they declared done

- **GIVEN** an action moved to `awaiting_verification` by an `hs_coordinator` account
- **WHEN** that same account refuses the verification with a `reason`
- **THEN** the action's state becomes `in_progress`
- **AND** the event carries that `reason`

#### Scenario: The exception survives a direct insert

- **WHEN** a closing event whose `actor_user_id` equals the `hs_coordinator` actor of the
  completion event is inserted directly, bypassing the endpoint
- **THEN** the insert succeeds

#### Scenario: A different person closes the action

- **GIVEN** an action moved to `awaiting_verification` by one account
- **WHEN** the HS coordinator, a different account, closes it
- **THEN** the action's state becomes `closed`
- **AND** the closing event names the coordinator as `actor_user_id`

#### Scenario: A refused verification returns the action to in progress and states why

- **WHEN** a verifier refuses the work with the reason `the guard is installed on line 2, not
  line 3`
- **THEN** the action's state becomes `in_progress`
- **AND** the event carries that `reason`

#### Scenario: A refusal without a reason is rejected

- **WHEN** an event with `from_state` `awaiting_verification` and `to_state` `in_progress` is
  inserted with a null `reason`
- **THEN** the insert fails on the reason check constraint

### Requirement: Who may create, execute and verify an action

The system SHALL accept the creation of an action for a finding from an `hs_coordinator`
account or from the account named by that finding's `reported_by`. The system SHALL accept
the creation of an action for an investigation only from an `hs_coordinator` account. The
system SHALL accept the transitions `open` → `in_progress` and `in_progress` →
`awaiting_verification` only from the account of the assigned person or from an
`hs_coordinator` account acting on their behalf. The system SHALL accept the verification
transitions from an `hs_coordinator`, `supervisor` or `management` account of the action's
site, subject to the verifier rule. An `external_auditor` SHALL be refused every write and a
`jhsc_member` who neither raised the finding nor is the assigned person SHALL be refused
every write, both with `forbidden`. The acting account SHALL be taken from the session and
never from the payload. A finding outside the session's scope SHALL be refused with
`action_not_found`, the same code as a finding that does not exist, evaluated before the
permission itself so that the response never discloses which is the case.

#### Scenario: The finding's reporter opens the action they raised

- **GIVEN** a finding whose `reported_by` names a `jhsc_member` account
- **WHEN** that account creates an action for that finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that account

#### Scenario: A supervisor who did not raise the finding cannot create an action

- **WHEN** a supervisor who is not the finding's `reported_by` and not an `hs_coordinator`
  creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `corrective_action` row is created

#### Scenario: Another JHSC member cannot open an action on someone else's finding

- **GIVEN** a finding whose `reported_by` names one `jhsc_member` account
- **WHEN** a different `jhsc_member` account creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the finding does not extend to an investigation

- **GIVEN** an incident's investigation reported by a supervisor
- **WHEN** that supervisor, who is not an `hs_coordinator`, creates an action for that
  investigation
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: A finding outside the scope answers not found, not forbidden

- **WHEN** an account creates an action for a finding of a site outside its scope
- **THEN** the request is rejected with the code `action_not_found`

#### Scenario: Someone else's action cannot be advanced

- **GIVEN** an action assigned to a person whose account is not the caller's
- **WHEN** a supervisor who is neither the assignee nor the coordinator moves it to `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The coordinator records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** the HS coordinator moves it to `in_progress`
- **THEN** the event is appended with the coordinator's account as `actor_user_id`

#### Scenario: An external auditor writes nothing

- **WHEN** an external auditor requests any transition
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The actor is taken from the session

- **WHEN** a transition is posted with an `actor_user_id` in the payload naming another account
- **THEN** the stored `actor_user_id` is the account of the authenticated session

### Requirement: An overdue action escalates to the supervisor at three days and to management at seven

The system SHALL run a daily job that finds every action whose current state is not `closed` and
whose `due_at` is more than 3 days in the past, and escalate it to the `supervisor` accounts of
its site; and every such action whose `due_at` is more than 7 days in the past, and escalate it to
the `management` accounts of its site. Each escalation SHALL be recorded as one
`corrective_action_escalation` row per action and `level`, and the row SHALL be unique on
`(action_id, level)`, so that a job that runs every day of the month escalates once per level.
A closed action SHALL NOT escalate, whatever its `due_at`. Escalation SHALL NOT be a state: it
changes nothing in the event stream and adds no `corrective_action_event` row.

#### Scenario: Three days past the deadline reaches the supervisor

- **GIVEN** an action whose current state is `in_progress` and whose `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `supervisor` exists for it
- **AND** every active `supervisor` account of its site has a notification of kind
  `corrective_action_overdue_supervisor` naming the action

#### Scenario: Seven days past the deadline reaches management

- **GIVEN** an action already escalated to the supervisor and whose `due_at` was 8 days ago
- **WHEN** the escalation job runs
- **THEN** a second row with `level` `management` exists for it
- **AND** every active `management` account of its site has a notification of kind
  `corrective_action_overdue_management`

#### Scenario: Thirty daily runs escalate once

- **GIVEN** an action that has been overdue for 30 days
- **WHEN** the escalation job runs on each of those days
- **THEN** exactly one `supervisor` row and one `management` row exist for it
- **AND** each recipient has exactly one notification per level

#### Scenario: A closed action does not escalate

- **GIVEN** an action closed one day before its deadline
- **WHEN** the escalation job runs ten days later
- **THEN** no `corrective_action_escalation` row exists for it

#### Scenario: An action inside its deadline does not escalate

- **GIVEN** an action whose `due_at` is two days in the future
- **WHEN** the escalation job runs
- **THEN** no escalation row and no notification exist for it

#### Scenario: Escalation adds no event to the stream

- **GIVEN** an action escalated to both levels
- **WHEN** its events are read
- **THEN** its current state is unchanged by the escalation
- **AND** no event of the stream refers to an escalation

### Requirement: The assignee is notified when an action is created for them

The system SHALL create, when an action is created and the assigned person has an active account,
one `notification` row for that account with `kind` `corrective_action_assigned` and a payload
naming the action, the finding, the `description` and the `due_at`. When the assigned person has
no account, no notification SHALL be created and the action SHALL still be created. Notifications
SHALL be delivered in the application; the system SHALL NOT depend on outbound email.

#### Scenario: The assignee sees the assignment in their inbox

- **WHEN** an action is created for a person who has an active account
- **THEN** a `notification` row of kind `corrective_action_assigned` exists for that account
- **AND** its payload names the action, its `due_at` and the finding it comes from

#### Scenario: An assignee with no account gets no notification

- **WHEN** an action is created for a person with no `app_user` row
- **THEN** the action is created
- **AND** no notification is created for it

### Requirement: Actions are read within the reader's site scope

The system SHALL return corrective actions only for the sites in the session's scope, enforced by
the row level security policy on `corrective_action`, `corrective_action_event`,
`corrective_action_evidence` and `corrective_action_escalation`, and not by a `WHERE site_id`
clause in the endpoint. A listing SHALL carry, for each action, its parent identifier, assignee,
assignee name when visible, site name, `due_at`, derived current state, whether it is past `due_at`,
the escalation levels it has reached, and a source discriminated as an inspection finding, manual
finding or incident investigation. An inspection-finding source SHALL carry the stable template
identity and historical template name needed to filter actions across template versions. The
listing SHALL omit event and evidence history; an individual action read SHALL retain that complete
history. A request for an action outside the session's scope SHALL be answered exactly as one for
an action that does not exist.

#### Scenario: A supervisor of one site does not see the other's actions

- **GIVEN** actions in St. Thomas and in Glencoe
- **WHEN** a supervisor scoped to St. Thomas lists actions
- **THEN** only the St. Thomas actions are returned

#### Scenario: An action of the other site is indistinguishable from a missing one

- **WHEN** a supervisor scoped to St. Thomas requests a Glencoe action by id
- **THEN** the response is `action_not_found`
- **AND** the body reveals nothing about its site, assignee or description

#### Scenario: The listing reports the derived state and whether it is late

- **GIVEN** an action in `in_progress` whose `due_at` was two days ago
- **WHEN** it is listed
- **THEN** its state is reported as `in_progress`
- **AND** its `overdue` is reported as true, computed from `due_at` and the current time

#### Scenario: An inspection action names its source template

- **GIVEN** an action whose `finding_id` belongs to an inspection made with a historical template version
- **WHEN** actions are listed
- **THEN** its `source.kind` is `inspection`
- **AND** its `source.template_id` and `source.template_name` identify the stable template regardless of version

#### Scenario: Non-inspection actions remain visible

- **GIVEN** one action from a manual finding and one from an incident investigation
- **WHEN** actions are listed
- **THEN** their `source.kind` values are `manual_finding` and `investigation`, respectively

#### Scenario: The listing omits detail history

- **GIVEN** an action with events and evidence
- **WHEN** actions are listed
- **THEN** the summary contains neither `events` nor evidence
- **AND** reading that action by id returns its complete `events` and evidence

#### Scenario: A transaction with no declared scope sees nothing

- **WHEN** a transaction that declared no site scope selects from the four tables
- **THEN** all four return no rows, even though rows exist

### Requirement: A shared remediation is grouped without changing anything

The system SHALL accept an optional `remediation_group_id` on a corrective action, shared by the
several actions that one piece of work resolves, as pregunta cerrada 9 decided. The system SHALL
NOT let that identifier alter deadlines, escalation or verification: each action of a group SHALL
keep the `due_at` it was created with, SHALL escalate on its own, and SHALL be closed by its own
verified event.

#### Scenario: Grouped actions keep their own deadlines

- **GIVEN** seven actions sharing one `remediation_group_id`, created with different deadlines
- **WHEN** their deadlines are read
- **THEN** each `due_at` is the one its creation declared

#### Scenario: Closing one action of a group closes only that one

- **GIVEN** seven actions sharing one `remediation_group_id`
- **WHEN** one of them is verified and closed
- **THEN** that action's state is `closed`
- **AND** the other six are unchanged
