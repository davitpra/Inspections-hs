## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Declaring the work done requires evidence

**Reason**: Requiring a photograph to declare the work done blocks the transition for a repair
that is genuinely finished but cannot be photographed, and leaves the action reading
`in_progress` — escalating at three and seven days — over a camera, not over a hazard. The
evidence stays the first thing the interface asks for; it stops being what the engine enforces.
The other half of R3, that the verifier is never the person who declared the work done, is
untouched.

**Migration**: None. The rules this requirement carried that are not about the obligation —
evidence as an `object_key` and never as bytes, the rejection of a key outside the action's own
prefix, and `before` evidence accepted on any event — are restated in "Completion evidence is
recorded and never required". Evidence already written is neither deleted nor rewritten:
`corrective_action_evidence` keeps its immutability and its site isolation, and only the
deferred constraint that refused the commit is dropped.
