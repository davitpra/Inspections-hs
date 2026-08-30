## MODIFIED Requirements

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
