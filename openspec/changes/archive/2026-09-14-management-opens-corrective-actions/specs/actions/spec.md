## RENAMED Requirements

- FROM: `### Requirement: The verifier is someone other than the executor, unless they are the coordinator`
- TO: `### Requirement: The verifier is someone other than the executor, unless they are an administrator`

## MODIFIED Requirements

### Requirement: A corrective action assignment is replaceable until declared work

The system SHALL allow an authenticated `coordinator` or `management` account, or the account named
by the parent finding's `reported_by`, to submit a complete replacement `assignee_person_id`,
`description` and `due_at` while the corrective action's derived state is `open` or `in_progress`.
Each accepted request SHALL update those three columns on the same `corrective_action` row and SHALL
NOT append an assignment version. The system SHALL require an active assignee from the action's site
and a future `due_at`. It SHALL refuse replacement when the state is `awaiting_verification` or
`closed` with `invalid_action_state`. A refused verification that returns the action to
`in_progress` SHALL make the assignment replaceable again. An `inspector` that is not the finding's
`reported_by` SHALL be refused with `forbidden`.

#### Scenario: Work in progress can be corrected

- **GIVEN** an action is `in_progress`
- **WHEN** an authorized account submits valid replacement assignment fields
- **THEN** the same `corrective_action` row exposes the replacement values
- **AND** no new corrective action or assignment-history row is created

#### Scenario: A manager corrects an assignment on a finding they did not raise

- **GIVEN** an `open` action on a finding whose `reported_by` names an `inspector` account
- **WHEN** a `management` account scoped to that site submits valid replacement assignment fields
- **THEN** the replacement is accepted

#### Scenario: An inspector who did not raise the finding cannot correct the assignment

- **GIVEN** an `open` action on a finding whose `reported_by` names one `inspector` account
- **WHEN** a different `inspector` account submits replacement assignment fields
- **THEN** the request is rejected with the code `forbidden`
- **AND** the assignment remains unchanged

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

### Requirement: The verifier is someone other than the executor, unless they are an administrator

The system SHALL refuse the transition `awaiting_verification` → `closed`, and the refusal
`awaiting_verification` → `in_progress`, when the acting account is the `actor_user_id` of the
event that moved the action to `awaiting_verification` **and** that account's role is `inspector`.
A `coordinator` or `management` account SHALL be accepted for both transitions even when it is the
`actor_user_id` of that event (ADR-019, ADR-025). The rule SHALL be enforced by the database and not
only by the endpoint, and the database SHALL decide the exception from the acting account's own
role at the moment of the insert, not from a value supplied with the event. When the verification
is refused, the event SHALL carry a `reason`; when it closes the action, a `reason` SHALL NOT be
required.

#### Scenario: A manager closes an action they declared done

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account closes it
- **THEN** the action's state becomes `closed`
- **AND** the closing event names that account as `actor_user_id`

#### Scenario: A manager sends back work they declared done

- **GIVEN** an action moved to `awaiting_verification` by a `management` account
- **WHEN** that same account refuses the verification with a `reason`
- **THEN** the action's state becomes `in_progress`
- **AND** the event carries that `reason`

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

#### Scenario: The exception survives a direct insert for both administrative roles

- **WHEN** a closing event whose `actor_user_id` equals the `coordinator` or `management` actor of
  the completion event is inserted directly, bypassing the endpoint
- **THEN** the insert succeeds

#### Scenario: The rule holds for a direct insert by an inspector

- **GIVEN** an action moved to `awaiting_verification` by the `inspector` assignee who executed it
- **WHEN** a closing event whose `actor_user_id` equals that `inspector` account is inserted
  directly, bypassing the endpoint
- **THEN** the insert fails on the verifier guard

#### Scenario: An account demoted to inspector loses the exception

- **GIVEN** an action moved to `awaiting_verification` by a `coordinator` account
- **AND** that account's role is later changed to `inspector`
- **WHEN** a closing event naming that account as `actor_user_id` is inserted directly
- **THEN** the insert fails on the verifier guard

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

The system SHALL accept the creation of an action for a finding from a `coordinator` or
`management` account or from the account named by that finding's `reported_by`. The system SHALL
accept the creation of an action for an investigation only from a `coordinator` or `management`
account. The system SHALL accept the transitions `open` → `in_progress` and `in_progress` →
`awaiting_verification` only from the account of the assigned person, from the account named by the
`reported_by` of the action's finding, or from a `coordinator` or `management` account acting on
their behalf. For an action on an investigation, which has no reporting account, the system SHALL
accept those transitions only from the account of the assigned person or from a `coordinator` or
`management` account. A transition accepted from the finding's reporting account or from an
administrative account acting on the assignee's behalf SHALL NOT change the action's
`assignee_person_id`. The system SHALL accept the verification transitions from a `coordinator` or
`management` account of the action's site, subject to the verifier rule. An `inspector` who neither
raised the finding nor is the assigned person SHALL be refused every write with `forbidden`. The
acting account SHALL be taken from the session and never from the payload. A finding outside the
session's scope SHALL be refused with `action_not_found`, the same code as a finding that does not
exist, evaluated before the permission itself so that the response never discloses which is the
case.

#### Scenario: The finding's reporter opens the action they raised

- **GIVEN** a finding whose `reported_by` names an `inspector` account
- **WHEN** that account creates an action for that finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that account

#### Scenario: A manager opens an action on a finding they did not raise

- **GIVEN** a finding whose `reported_by` names an `inspector` account
- **WHEN** a `management` account scoped to that finding's site creates an action for that finding
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that `management` account

#### Scenario: Another inspector cannot open an action on someone else's finding

- **GIVEN** a finding whose `reported_by` names one `inspector` account
- **WHEN** a different `inspector` account creates an action for that finding
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: A manager opens an action on an investigation

- **GIVEN** an incident's investigation of a site in the session's scope
- **WHEN** a `management` account creates an action for that investigation
- **THEN** a `corrective_action` row is created referencing that investigation

#### Scenario: Raising the incident does not let an inspector open an investigation's action

- **GIVEN** an incident's investigation of a site in the session's scope
- **WHEN** an `inspector` account creates an action for that investigation
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: A finding outside the scope answers not found, not forbidden

- **WHEN** an account creates an action for a finding of a site outside its scope
- **THEN** the request is rejected with the code `action_not_found`

#### Scenario: Someone else's action cannot be advanced

- **GIVEN** an action assigned to a person whose account is not the caller's
- **WHEN** an `inspector` account that is neither the assignee nor the account named by the
  finding's `reported_by` moves it to `in_progress`
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

- **GIVEN** a finding whose `reported_by` names an `inspector` account
- **AND** that account moved the finding's action to `awaiting_verification`
- **WHEN** that same account moves the action to `closed`
- **THEN** the request is rejected with the code `forbidden`
- **AND** the action's state is still `awaiting_verification`

#### Scenario: Another inspector cannot advance an action on someone else's finding

- **GIVEN** an `open` action on a finding whose `reported_by` names one `inspector` account
- **WHEN** a different `inspector` account that is not the assigned person's account moves it to
  `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the incident does not let its reporter advance an investigation's action

- **GIVEN** an `open` action on an investigation whose incident was reported by an account that is
  neither an administrative account nor the assigned person's account
- **WHEN** that account moves the action to `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The coordinator records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** the coordinator moves it to `in_progress`
- **THEN** the event is appended with the coordinator's account as `actor_user_id`

#### Scenario: A manager records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** a `management` account of the action's site moves it to `in_progress` and then to
  `awaiting_verification`
- **THEN** both events are appended with that `management` account as `actor_user_id`
- **AND** the action's `assignee_person_id` is unchanged

#### Scenario: The actor is taken from the session

- **WHEN** a transition is posted with an `actor_user_id` in the payload naming another account
- **THEN** the stored `actor_user_id` is the account of the authenticated session
