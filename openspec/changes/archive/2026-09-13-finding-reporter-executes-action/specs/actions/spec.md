## MODIFIED Requirements

### Requirement: Who may create, execute and verify an action

The system SHALL accept the creation of an action for a finding from an `hs_coordinator`
account or from the account named by that finding's `reported_by`. The system SHALL accept
the creation of an action for an investigation only from an `hs_coordinator` account. The
system SHALL accept the transitions `open` → `in_progress` and `in_progress` →
`awaiting_verification` only from the account of the assigned person, from the account named
by the `reported_by` of the action's finding, or from an `hs_coordinator` account acting on their
behalf. For an action on an investigation, which has no reporting account, the system SHALL
accept those transitions only from the account of the assigned person or from an
`hs_coordinator` account. A transition accepted from the finding's reporting account SHALL NOT
change the action's `assignee_person_id`. The system SHALL accept the verification
transitions from an `hs_coordinator` or `management` account of the action's site, subject to the
verifier rule. A `jhsc_member` who neither raised the finding nor is the assigned person SHALL be
refused every write with `forbidden`. The acting account SHALL be taken from the session and
never from the payload. A finding outside the session's scope SHALL be refused with
`action_not_found`, the same code as a finding that does not exist, evaluated before the
permission itself so that the response never discloses which is the case.

#### Scenario: The finding's reporter opens the action they raised

- **GIVEN** a finding whose `reported_by` names a `jhsc_member` account
- **WHEN** that account creates an action for that finding, with an `assignee_person_id`, a
  `description` and a `due_at`
- **THEN** a `corrective_action` row is created referencing that finding
- **AND** its `created_by` is that account

#### Scenario: A manager who did not raise the finding cannot create an action

- **WHEN** a `management` account that is not the finding's `reported_by`
  creates an action for that finding
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
- **WHEN** a `management` account that is neither the assignee, the coordinator nor the account
  named by the finding's `reported_by` moves it to `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The finding's reporter starts work assigned to someone else

- **GIVEN** a finding whose `reported_by` names a `jhsc_member` account
- **AND** an `open` action on that finding assigned to a person who is not that account's person
- **WHEN** that account moves the action to `in_progress`
- **THEN** the event is appended with that account as `actor_user_id`
- **AND** the action's `assignee_person_id` is unchanged

#### Scenario: The finding's reporter declares work done

- **GIVEN** an `in_progress` action on a finding whose `reported_by` names a `jhsc_member` account
  that is not the assigned person's account
- **WHEN** that account moves the action to `awaiting_verification`
- **THEN** the event is appended with that account as `actor_user_id`

#### Scenario: A reporter who declared the work done cannot verify it

- **GIVEN** a finding whose `reported_by` names a `management` account
- **AND** that account moved the finding's action to `awaiting_verification`
- **WHEN** that same account moves the action to `closed`
- **THEN** the request is rejected with the code `verifier_is_executor`

#### Scenario: Another JHSC member cannot advance an action on someone else's finding

- **GIVEN** an `open` action on a finding whose `reported_by` names one `jhsc_member` account
- **WHEN** a different `jhsc_member` account that is not the assigned person's account moves it to
  `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: Raising the incident does not let its reporter advance an investigation's action

- **GIVEN** an `open` action on an investigation whose incident was reported by a `management`
  account that is not the assigned person's account
- **WHEN** that account moves the action to `in_progress`
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The coordinator records progress on behalf of the assignee

- **GIVEN** an action assigned to a person with no account
- **WHEN** the HS coordinator moves it to `in_progress`
- **THEN** the event is appended with the coordinator's account as `actor_user_id`

#### Scenario: The actor is taken from the session

- **WHEN** a transition is posted with an `actor_user_id` in the payload naming another account
- **THEN** the stored `actor_user_id` is the account of the authenticated session
