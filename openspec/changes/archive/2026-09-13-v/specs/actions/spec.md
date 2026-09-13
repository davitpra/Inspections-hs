## RENAMED Requirements

- FROM: `### Requirement: The verifier is someone other than the executor, unless they are the HS coordinator`
- TO: `### Requirement: The verifier is someone other than the executor, unless they are the coordinator`


## MODIFIED Requirements

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

- **WHEN** the coordinator creates an action for a finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that `finding_id`
- **AND** its `investigation_id` is null
- **AND** its `site_id` is the finding's `site_id`

#### Scenario: An action is created for an investigation

- **WHEN** the coordinator creates an action for an investigation, with an
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
Persona ≠ Usuario, an assignee MAY have no account; in that case the coordinator records the
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

### Requirement: The state of an action is derived from its events and is never stored as a column

The system SHALL record every step of an action as a `corrective_action_event` row and SHALL NOT
store a status column on `corrective_action`. The current state of an action SHALL be the
`to_state` of its highest event, obtained as `SELECT DISTINCT ON (action_id) to_state FROM
corrective_action_event ORDER BY action_id, position DESC`. The states SHALL be exactly `open`,
`in_progress`, `awaiting_verification` and `closed`. Creating an action SHALL write its first
event, with `position` `0`, a null `from_state` and `to_state` `open`, in the same transaction as
the action row, so that no action can exist without a state.

Creating an action SHALL write only that first event: naming a responsible person, the work and the
deadline does not begin the work. The action SHALL stay in `open` until the assigned person or a
`coordinator` requests `open` → `in_progress`.

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
- **WHEN** the assigned person or a `coordinator` requests `open` → `in_progress`
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
work SHALL remain the existing explicit state transition available to the assigned person or a
`coordinator`, and SHALL NOT freeze assignment editing until the action reaches
`awaiting_verification`.

#### Scenario: Creation leaves the action assigned

- **WHEN** an authorized account creates a corrective action
- **THEN** its derived state is `open`
- **AND** no `in_progress` event exists until an authorized account starts work

#### Scenario: Starting work keeps the assignment correctable

- **GIVEN** an open action has its current commitment
- **WHEN** the assigned person or a `coordinator` moves it to `in_progress`
- **THEN** the transition is accepted
- **AND** an authorized account can still replace the assignment

### Requirement: A corrective action assignment is replaceable until declared work

The system SHALL allow an authenticated `coordinator`, or the account named by the parent
finding's `reported_by`, to submit a complete replacement `assignee_person_id`, `description` and
`due_at` while the corrective action's derived state is `open` or `in_progress`. Each accepted request
SHALL update those three columns on the same `corrective_action` row and SHALL NOT append an
assignment version. The system SHALL require an active assignee from the action's site and a future
`due_at`. It SHALL refuse replacement when the state is `awaiting_verification` or `closed` with
`invalid_action_state`. A refused verification that returns the action to `in_progress` SHALL make
the assignment replaceable again.

#### Scenario: Work in progress can be corrected

- **GIVEN** an action is `in_progress`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the same `corrective_action` row exposes the replacement values
- **AND** no new corrective action or assignment-history row is created

#### Scenario: Declared work freezes the assignment

- **GIVEN** an action is `awaiting_verification`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the request is rejected with `invalid_action_state`
- **AND** the assignment being verified remains unchanged

#### Scenario: A refused verification reopens the assignment

- **GIVEN** an action was returned from `awaiting_verification` to `in_progress` with a reason
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the replacement is accepted

#### Scenario: Closure freezes the assignment

- **GIVEN** an action is `closed`
- **WHEN** an otherwise authorized account submits replacement assignment fields
- **THEN** the request is rejected with `invalid_action_state`
- **AND** the final assignment remains unchanged

### Requirement: The verifier is someone other than the executor, unless they are the coordinator

The system SHALL refuse the transition `awaiting_verification` → `closed`, and the refusal
`awaiting_verification` → `in_progress`, when the acting account is the `actor_user_id` of the
event that moved the action to `awaiting_verification` **and** that account's role is
`management` or `inspector`. A `coordinator` account SHALL be accepted for both
transitions even when it is the `actor_user_id` of that event. The rule SHALL be enforced by
the database and not only by the endpoint, and the database SHALL decide the exception from the
acting account's own role, not from a value supplied with the event. When the verification is
refused, the event SHALL carry a `reason`; when it closes the action, a `reason` SHALL NOT be
required.

The exception SHALL belong to `coordinator` alone and SHALL NOT extend to `management`, even
though the two roles hold the same administrative permissions otherwise: the exception exists
because a site can hold a single coordinator whose work would otherwise stall unverifiable, and a
management account is by construction a second account that can verify it.

#### Scenario: A manager cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: An inspector cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by the `inspector` assignee who executed it
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: A manager cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`

#### Scenario: The rule holds for a direct insert too

- **WHEN** a closing event whose `actor_user_id` equals the `management` actor of the completion
  event is inserted directly, bypassing the endpoint
- **THEN** the insert fails on the verifier guard

#### Scenario: The coordinator closes an action they declared done

- **GIVEN** an action moved to `awaiting_verification` by a `coordinator` account
- **WHEN** that same account closes it
- **THEN** the action's state becomes `closed`
- **AND** the closing event names that coordinator as `actor_user_id`

#### Scenario: The coordinator sends back work they declared done

- **GIVEN** an action moved to `awaiting_verification` by a `coordinator` account
- **WHEN** that same account refuses the verification with a `reason`
- **THEN** the action's state becomes `in_progress`
- **AND** the event carries that `reason`

#### Scenario: The exception survives a direct insert

- **WHEN** a closing event whose `actor_user_id` equals the `coordinator` actor of the
  completion event is inserted directly, bypassing the endpoint
- **THEN** the insert succeeds

#### Scenario: A different person closes the action

- **GIVEN** an action moved to `awaiting_verification` by one account
- **WHEN** the coordinator, a different account, closes it
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

The system SHALL accept the creation of an action for a finding from a `coordinator`
account or from the account named by that finding's `reported_by`. The system SHALL accept
the creation of an action for an investigation only from a `coordinator` account. The
system SHALL accept the transitions `open` → `in_progress` and `in_progress` →
`awaiting_verification` only from the account of the assigned person, from the account named
by the `reported_by` of the action's finding, or from a `coordinator` account acting on their
behalf. For an action on an investigation, which has no reporting account, the system SHALL
accept those transitions only from the account of the assigned person or from a
`coordinator` account. A transition accepted from the finding's reporting account SHALL NOT
change the action's `assignee_person_id`. The system SHALL accept the verification transitions
from a `coordinator` or `management` account of the action's site, subject to the verifier
rule. An `inspector` who neither raised the finding nor is the assigned person SHALL be refused
every write with `forbidden`. The acting account SHALL be taken from the session and never from
the payload. A finding outside the session's scope SHALL be refused with `action_not_found`, the
same code as a finding that does not exist, evaluated before the permission itself so that the
response never discloses which is the case.

#### Scenario: The finding's reporter opens the action they raised

- **GIVEN** a finding whose `reported_by` names an `inspector` account
- **WHEN** that account creates an action for that finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that account

#### Scenario: A manager who did not raise the finding cannot create an action

- **WHEN** a `management` account that is not the finding's `reported_by`
  creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `corrective_action` row is created

#### Scenario: Another inspector cannot open an action on someone else's finding

- **GIVEN** a finding whose `reported_by` names one `inspector` account
- **WHEN** a different `inspector` account creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the finding does not extend to an investigation

- **GIVEN** an incident's investigation reported by a `management` account
- **WHEN** that same account, which is not a `coordinator`, creates an action for that
  investigation
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: A finding outside the scope answers not found, not forbidden

- **WHEN** an account creates an action for a finding of a site outside its scope
- **THEN** the request is rejected with the code `action_not_found`

#### Scenario: Someone else's action cannot be advanced

- **GIVEN** an action assigned to a person whose account is not the caller's
- **WHEN** a `management` account that is neither the assignee, the coordinator nor the account
  named by the finding's `reported_by` moves it to
  `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The finding's reporter starts work assigned to someone else

- **GIVEN** a finding whose `reported_by` names an `inspector` account
- **AND** an `open` action on that finding assigned to a person who is not that account's person
- **WHEN** that account moves the action to `in_progress`
- **THEN** the event is appended with that account as `actor_user_id`
- **AND** the action's `assignee_person_id` is unchanged

#### Scenario: The finding's reporter declares work done

- **GIVEN** an `in_progress` action on a finding whose `reported_by` names an `inspector` account
  that is not the assigned person's account
- **WHEN** that account moves the action to `awaiting_verification`
- **THEN** the event is appended with that account as `actor_user_id`

#### Scenario: A reporter who declared the work done cannot verify it

- **GIVEN** a finding whose `reported_by` names a `management` account
- **AND** that account moved the finding's action to `awaiting_verification`
- **WHEN** that same account moves the action to `closed`
- **THEN** the request is rejected with the code `verifier_is_executor`

#### Scenario: Another inspector cannot advance an action on someone else's finding

- **GIVEN** an `open` action on a finding whose `reported_by` names one `inspector` account
- **WHEN** a different `inspector` account that is not the assigned person's account moves it to
  `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the incident does not let its reporter advance an investigation's action

- **GIVEN** an `open` action on an investigation whose incident was reported by a `management`
  account that is not the assigned person's account
- **WHEN** that account moves the action to `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The coordinator records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** the coordinator moves it to `in_progress`
- **THEN** the event is appended with the coordinator's account as `actor_user_id`

#### Scenario: The actor is taken from the session

- **WHEN** a transition is posted with an `actor_user_id` in the payload naming another account
- **THEN** the stored `actor_user_id` is the account of the authenticated session

### Requirement: An overdue action escalates to the coordinator at three days and to management at seven

The system SHALL use the current `corrective_action.due_at` to find every non-closed action more than
3 or 7 days overdue and SHALL escalate it to the two administrative roles in turn: `coordinator`
at three days and `management` at seven. Each level SHALL be emitted at most once. Replacing `due_at`
SHALL affect future decisions but SHALL NOT delete, withdraw or repeat an escalation already emitted.
An action whose work is declared done SHALL keep escalating against the frozen `due_at`, which SHALL
be movable only after a refused verification returns it to `in_progress`.

The two levels SHALL be distinguished by their recipient and not by their content: each SHALL carry
its own notification kind — `corrective_action_overdue_coordinator` and
`corrective_action_overdue_management` — so that a recipient's inbox is decided by who they are
rather than by reading the notification.

The first level SHALL reach every active `coordinator` account of the action's site even when
that coordinator is the account that created the action or the person assigned to it: an escalation
reports the deadline, not fault.

A `corrective_action_escalation` row written before the roles were renamed carries `level`
`hs_coordinator`. Such a row SHALL remain unchanged, SHALL be read as the first level, and SHALL
count as that level already emitted: the system SHALL NOT emit a `coordinator` escalation for an
action that already holds an `hs_coordinator` row. New rows SHALL carry `coordinator` or
`management` only.

#### Scenario: Three days past the deadline reaches the coordinator

- **GIVEN** an action whose current state is `in_progress` and whose `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `coordinator` exists for it
- **AND** every active `coordinator` account of its site has a notification of kind
  `corrective_action_overdue_coordinator` naming the action

#### Scenario: An escalation written before the rename is not repeated

- **GIVEN** a non-closed action, 4 days overdue, holding a `corrective_action_escalation` row with
  `level` `hs_coordinator` written before the roles were renamed
- **WHEN** the escalation job runs
- **THEN** no `coordinator` row is added for it, and no new coordinator notification is created
- **AND** the `hs_coordinator` row is present and unchanged

#### Scenario: A new escalation never carries the retired level

- **WHEN** a `corrective_action_escalation` row is inserted with `level` `hs_coordinator` after the
  roles were renamed
- **THEN** the insert is refused

#### Scenario: A replacement deadline governs future escalation

- **GIVEN** a non-closed action has not escalated
- **WHEN** its `due_at` is replaced with a later future value
- **THEN** subsequent escalation runs use the replacement value

#### Scenario: An action awaiting verification escalates on its frozen deadline

- **GIVEN** an action is `awaiting_verification` and its `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `coordinator` exists for it
- **AND** its `due_at` cannot be replaced while it stays in that state

#### Scenario: A past escalation survives a replacement

- **GIVEN** an action already has a `corrective_action_escalation` row
- **WHEN** its assignment is replaced with a later `due_at`
- **THEN** the escalation row and its notifications remain unchanged

#### Scenario: Seven days past the deadline reaches management

- **GIVEN** an action already escalated to the coordinator and whose `due_at` was 8 days ago
- **WHEN** the escalation job runs
- **THEN** a second row with `level` `management` exists for it
- **AND** every active `management` account of its site has a notification of kind
  `corrective_action_overdue_management`

#### Scenario: The coordinator who owns the action is still notified

- **GIVEN** an action created by the only `coordinator` of its site, 4 days overdue
- **WHEN** the escalation job runs
- **THEN** that coordinator has a notification of kind `corrective_action_overdue_coordinator`

#### Scenario: Thirty daily runs escalate once

- **GIVEN** an action that has been overdue for 30 days
- **WHEN** the escalation job runs on each of those days
- **THEN** exactly one `coordinator` row and one `management` row exist for it
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

#### Scenario: An inspector of one site does not see the other's actions

- **GIVEN** actions in St. Thomas and in Glencoe
- **WHEN** an `inspector` scoped to St. Thomas lists actions
- **THEN** only the St. Thomas actions are returned

#### Scenario: An action of the other site is indistinguishable from a missing one

- **WHEN** an `inspector` scoped to St. Thomas requests a Glencoe action by id
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
