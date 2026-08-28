## Purpose

Turns a finding, or the investigation of an incident, into an obligation with a named owner and a
deadline declared by the HS coordinator, records every step of that obligation as an immutable event
rather than a status column, requires evidence and a second person's verification to close it, and
escalates it to the supervisor and then to management when it runs past its deadline unclosed.

## Requirements

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
on the action. An action's `due_at` SHALL never move afterwards; a different deadline is obtained
by opening a new action.

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

#### Scenario: Creating an action writes its first event

- **WHEN** an action is created
- **THEN** one `corrective_action_event` row exists for it with `position` `0`, `from_state` null
  and `to_state` `open`
- **AND** the derived state of the action is `open`

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

### Requirement: Declaring the work done requires evidence

The system SHALL require, for the transition `in_progress` → `awaiting_verification`, at least one
`corrective_action_evidence` row of `kind` `after` attached to that event, and SHALL accept
evidence of `kind` `before` on any event of the action. Evidence SHALL be stored as an
`object_key` of a file uploaded beforehand and SHALL NEVER carry image bytes. The system SHALL
reject an `object_key` outside the prefix derived from the action's own `site_id` and its own
identifier. The absence of `after` evidence SHALL fail at commit, so that no path — endpoint or
direct insert — can move an action to `awaiting_verification` with nothing to verify.

#### Scenario: Completing without evidence is refused

- **GIVEN** an action whose current state is `in_progress`
- **WHEN** the assignee declares the work done with no evidence
- **THEN** the request is rejected with the code `evidence_required`
- **AND** the action's state is still `in_progress`

#### Scenario: A completion event with no after evidence cannot commit

- **WHEN** an event with `to_state` `awaiting_verification` is inserted and the transaction commits
  with no `corrective_action_evidence` row of `kind` `after` for it
- **THEN** the commit fails with the dedicated SQLSTATE of the deferred evidence constraint

#### Scenario: Before and after evidence are both recorded

- **WHEN** the assignee declares the work done with one `before` and two `after` object keys
- **THEN** three `corrective_action_evidence` rows reference that event
- **AND** the action's state becomes `awaiting_verification`

#### Scenario: Evidence of another site's prefix is refused

- **WHEN** an evidence `object_key` outside the prefix derived from the action's `site_id` and id
  is submitted
- **THEN** the request is rejected with the code `invalid_evidence`

### Requirement: The verifier is never the person who declared the work done

The system SHALL refuse the transition `awaiting_verification` → `closed`, and the refusal
`awaiting_verification` → `in_progress`, when the acting account is the `actor_user_id` of the
event that moved the action to `awaiting_verification`. The rule SHALL be enforced by the database
and not only by the endpoint. When the verification is refused, the event SHALL carry a `reason`;
when it closes the action, a `reason` SHALL NOT be required.

#### Scenario: The executor cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by the supervisor who executed it
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: The rule holds for a direct insert too

- **WHEN** a closing event whose `actor_user_id` equals the actor of the completion event is
  inserted directly, bypassing the endpoint
- **THEN** the insert fails on the verifier guard

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

The system SHALL accept the creation of an action only from an `hs_coordinator` account. The
system SHALL accept the transitions `open` → `in_progress` and `in_progress` →
`awaiting_verification` only from the account of the assigned person or from an `hs_coordinator`
account acting on their behalf. The system SHALL accept the verification transitions from an
`hs_coordinator`, `supervisor` or `management` account of the action's site, subject to the
verifier rule. An `external_auditor` SHALL be refused every write and a `jhsc_member` SHALL be
refused every write, both with `forbidden`. The acting account SHALL be taken from the session and
never from the payload.

#### Scenario: A supervisor cannot create an action

- **WHEN** a supervisor creates an action for a finding of their own site
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `corrective_action` row is created

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

### Requirement: Coordinators can create corrective actions from findings in the actions workspace

The system SHALL show findings within the reader's site scope in the corrective actions workspace,
including findings with no corrective action and findings that already have one or more corrective
actions. For an authenticated `hs_coordinator`, the system SHALL offer a creation form for each
finding with exactly the required fields `assignee_person_id`, `description`, and `due_at`. The
assignee choices SHALL contain only active people of that finding's site. For every other role, the
system SHALL show the findings without offering the creation form. This presentation rule SHALL NOT
replace server authorization.

#### Scenario: A finding with no action is available to the coordinator

- **GIVEN** a finding in the coordinator's site scope has no corrective actions
- **WHEN** the coordinator opens the corrective actions workspace
- **THEN** the finding is shown with a control to create a corrective action

#### Scenario: A finding remains available after its first action

- **GIVEN** a finding in the coordinator's site scope already has one corrective action
- **WHEN** the coordinator opens the corrective actions workspace
- **THEN** the finding remains shown with its current action count
- **AND** the coordinator can open the form to create another corrective action for it

#### Scenario: Assignee choices come from the finding's site

- **GIVEN** a finding belongs to St. Thomas and active people exist in St. Thomas and Glencoe
- **WHEN** the coordinator opens the creation form for that finding
- **THEN** `assignee_person_id` can be selected only from active people of St. Thomas

#### Scenario: A non-coordinator cannot attempt creation from the workspace

- **WHEN** a supervisor opens the corrective actions workspace
- **THEN** scoped findings and existing corrective actions remain readable
- **AND** no control to create a corrective action is shown

### Requirement: Creating an action from the workspace requires a complete future commitment

The system SHALL submit a finding action only when `assignee_person_id` names one of the offered
people, `description` satisfies the corrective action contract, and `due_at` is later than the
current instant. While the creation is pending, the system SHALL prevent a duplicate submission.
After a successful creation, the system SHALL close the form, show the created action in the
corrective actions workspace, and update the source finding's action count. If creation fails, the
system SHALL keep the entered values available for correction and SHALL present the failure without
claiming that the action was created.

#### Scenario: A coordinator creates a complete action

- **GIVEN** the coordinator has selected an active `assignee_person_id` of the finding's site,
  entered a valid `description`, and selected a future `due_at`
- **WHEN** the coordinator submits the form
- **THEN** one corrective action is created for that finding with those three values
- **AND** the created action appears in the corrective actions workspace
- **AND** the finding's action count increases by one

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
- **THEN** the form remains open with `assignee_person_id`, `description`, and `due_at` preserved
- **AND** the failure is shown to the coordinator

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
