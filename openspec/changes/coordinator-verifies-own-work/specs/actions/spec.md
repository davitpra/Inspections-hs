## ADDED Requirements

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

## REMOVED Requirements

### Requirement: The verifier is never the person who declared the work done

**Reason**: The four-eyes control of R3 was written as universal, and the operation has one
`hs_coordinator` who is also the only account able to declare work done on behalf of a roster
person without a user account. Applied to that role the rule leaves finished work sitting in
`awaiting_verification` waiting for a supervisor or manager who did not take part in it. The
requirement is replaced by one that keeps the control for `supervisor` and `management` and
carves out the coordinator (ADR-019).

**Migration**: No data migration. Existing events are unaffected — the rule is evaluated at
insert time and no stored row changes meaning. The guard function
`hs_action_verifier_guard` is replaced in place by a new migration; `verifier_is_executor`
keeps its code and its SQLSTATE `HS005` for the roles that still carry the rule.
