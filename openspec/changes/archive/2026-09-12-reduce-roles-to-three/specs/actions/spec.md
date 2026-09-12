## ADDED Requirements

### Requirement: An overdue action escalates to the coordinator at three days and to management at seven

The system SHALL use the current `corrective_action.due_at` to find every non-closed action more than
3 or 7 days overdue and SHALL escalate it to the two administrative roles in turn: `hs_coordinator`
at three days and `management` at seven. Each level SHALL be emitted at most once. Replacing `due_at`
SHALL affect future decisions but SHALL NOT delete, withdraw or repeat an escalation already emitted.
An action whose work is declared done SHALL keep escalating against the frozen `due_at`, which SHALL
be movable only after a refused verification returns it to `in_progress`.

The two levels SHALL be distinguished by their recipient and not by their content: each SHALL carry
its own notification kind — `corrective_action_overdue_coordinator` and
`corrective_action_overdue_management` — so that a recipient's inbox is decided by who they are
rather than by reading the notification.

The first level SHALL reach every active `hs_coordinator` account of the action's site even when
that coordinator is the account that created the action or the person assigned to it: an escalation
reports the deadline, not fault.

#### Scenario: Three days past the deadline reaches the coordinator

- **GIVEN** an action whose current state is `in_progress` and whose `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `hs_coordinator` exists for it
- **AND** every active `hs_coordinator` account of its site has a notification of kind
  `corrective_action_overdue_coordinator` naming the action

#### Scenario: A replacement deadline governs future escalation

- **GIVEN** a non-closed action has not escalated
- **WHEN** its `due_at` is replaced with a later future value
- **THEN** subsequent escalation runs use the replacement value

#### Scenario: An action awaiting verification escalates on its frozen deadline

- **GIVEN** an action is `awaiting_verification` and its `due_at` was 4 days ago
- **WHEN** the escalation job runs
- **THEN** a `corrective_action_escalation` row with `level` `hs_coordinator` exists for it
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

- **GIVEN** an action created by the only `hs_coordinator` of its site, 4 days overdue
- **WHEN** the escalation job runs
- **THEN** that coordinator has a notification of kind `corrective_action_overdue_coordinator`

#### Scenario: Thirty daily runs escalate once

- **GIVEN** an action that has been overdue for 30 days
- **WHEN** the escalation job runs on each of those days
- **THEN** exactly one `hs_coordinator` row and one `management` row exist for it
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

## MODIFIED Requirements

### Requirement: The verifier is someone other than the executor, unless they are the HS coordinator

The system SHALL refuse the transition `awaiting_verification` → `closed`, and the refusal
`awaiting_verification` → `in_progress`, when the acting account is the `actor_user_id` of the
event that moved the action to `awaiting_verification` **and** that account's role is
`management` or `jhsc_member`. An `hs_coordinator` account SHALL be accepted for both
transitions even when it is the `actor_user_id` of that event. The rule SHALL be enforced by
the database and not only by the endpoint, and the database SHALL decide the exception from the
acting account's own role, not from a value supplied with the event. When the verification is
refused, the event SHALL carry a `reason`; when it closes the action, a `reason` SHALL NOT be
required.

The exception SHALL belong to `hs_coordinator` alone and SHALL NOT extend to `management`, even
though the two roles hold the same administrative permissions otherwise: the exception exists
because a site can hold a single coordinator whose work would otherwise stall unverifiable, and a
management account is by construction a second account that can verify it.

#### Scenario: A manager cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: A JHSC member cannot verify their own work

- **GIVEN** an action moved to `awaiting_verification` by the `jhsc_member` assignee who executed it
- **WHEN** that same account attempts to close it
- **THEN** the request is rejected with the code `verifier_is_executor`

#### Scenario: The rule holds for a direct insert too

- **WHEN** a closing event whose `actor_user_id` equals the `management` actor of the completion
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
transitions from an `hs_coordinator` or `management` account of the action's
site, subject to the verifier rule. A `jhsc_member` who neither raised the finding nor is the
assigned person SHALL be refused every write with `forbidden`. The acting account SHALL be taken
from the session and never from the payload. A finding outside the session's scope SHALL be refused
with `action_not_found`, the same code as a finding that does not exist, evaluated before the
permission itself so that the response never discloses which is the case.

Creating an action and advancing one SHALL name `hs_coordinator` specifically and SHALL NOT be read
as naming `management` under the administrative equivalence of the `identity` capability: opening an
action and recording progress on behalf of an assignee belong to the account that runs the health
and safety programme, and a management account reaches them the same way any other account does — by
having raised the finding, or by being the assigned person.

#### Scenario: The finding's reporter opens the action they raised

- **GIVEN** a finding whose `reported_by` names a `jhsc_member` account
- **WHEN** that account creates an action for that finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that account

#### Scenario: A manager who did not raise the finding cannot create an action

- **WHEN** a `management` account that is not the finding's `reported_by` creates an action for
  that finding
- **THEN** the request is rejected with the code `forbidden`
- **AND** no `corrective_action` row is created

#### Scenario: Another JHSC member cannot open an action on someone else's finding

- **GIVEN** a finding whose `reported_by` names one `jhsc_member` account
- **WHEN** a different `jhsc_member` account creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the finding does not extend to an investigation

- **GIVEN** an incident's investigation reported by a `management` account
- **WHEN** that same account, which is not an `hs_coordinator`, creates an action for that
  investigation
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: A finding outside the scope answers not found, not forbidden

- **WHEN** an account creates an action for a finding of a site outside its scope
- **THEN** the request is rejected with the code `action_not_found`

#### Scenario: Someone else's action cannot be advanced

- **GIVEN** an action assigned to a person whose account is not the caller's
- **WHEN** a `management` account that is neither the assignee nor the coordinator moves it to
  `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The coordinator records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** the HS coordinator moves it to `in_progress`
- **THEN** the event is appended with the coordinator's account as `actor_user_id`

#### Scenario: The actor is taken from the session

- **WHEN** a transition is posted with an `actor_user_id` in the payload naming another account
- **THEN** the stored `actor_user_id` is the account of the authenticated session

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

#### Scenario: An account of one site does not see the other's actions

- **GIVEN** actions in St. Thomas and in Glencoe
- **WHEN** a `jhsc_member` scoped to St. Thomas lists actions
- **THEN** only the St. Thomas actions are returned

#### Scenario: An action of the other site is indistinguishable from a missing one

- **WHEN** a `jhsc_member` scoped to St. Thomas requests a Glencoe action by id
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

## REMOVED Requirements

### Requirement: An overdue action escalates to the supervisor at three days and to management at seven

**Reason**: The `supervisor` role is withdrawn from the closed set, so the first level of the
escalation had no recipient it could ever reach. Replaced by the requirement of the same shape whose
first level reaches `hs_coordinator`, keeping the two steps and the two deadlines of §3 R3.

**Migration**: None. No `corrective_action_escalation` row carries `level` `supervisor` and no
notification of kind `corrective_action_overdue_supervisor` exists, so the migration narrows the two
check constraints without converting a row and aborts if one is found. The value
`corrective_action_overdue_supervisor` is replaced by `corrective_action_overdue_coordinator`.
