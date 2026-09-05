## Context

See `proposal.md`. ADR-021 supersedes ADR-020 and moves the freeze boundary to the moment the work is
declared done. This change touches the partially mutable `corrective_action` table, so both database
barriers of ADR-002 and the site isolation of ADR-004 stay exactly as ADR-020 left them; only the
state the guard refuses on changes.

## Goals / Non-Goals

**Goals:**

- Freeze the single active assignment from `awaiting_verification` onwards, in the engine and in the
  endpoint.
- Keep refusal as the recorded way to correct a commitment during verification.
- State the boundary once, as shared data, instead of as a condition written in each layer.

**Non-Goals:**

- Revisiting anything else ADR-020 decided: in-place replacement, no amendment history, the closing
  audit snapshot, notification withdrawal, escalation preservation.
- Changing who may edit (ADR-017) or who may verify (ADR-019).
- Changing the event-derived state machine or any grant, revoke or RLS policy.

## Decisions

### Move the boundary inside the existing guard, not into a new mechanism

Migration 0044 replaces the body of `hs_corrective_action_guard` so the state check reads
`current_state IN ('awaiting_verification', 'closed')`. The allowed-column check, the assignee check,
the DELETE refusal, the exact UPDATE grant and the RLS policy are untouched. `HS014` is reused
because the refusal is the same one from the caller's side — the assignment is no longer a
commitment — and it already translates to `invalid_action_state`.

### Express the boundary as shared data

`ASSIGNMENT_EDITABLE_STATES` and `isAssignmentEditable` live in `packages/contracts` next to
`TRANSITIONS`. The service and the findings route both consult them, so "where editing stops" cannot
drift between what the interface offers and what the endpoint accepts. The migration writes the same
rule as a guard, which is the duplication ADR-002 requires and the one the transition table already
has; integration tests assert both paths.

### Decide the control on the action's state, not on the finding's stage

The next step reads `isAssignmentEditable(action.state)`. The frozen row is the action's, and naming
a finding stage in the interface would be a second table that can separate from the one the server
applies.

### Leave verification with one way to correct

`Send it back` already exists in the Verification step and already requires a reason. It becomes the
only route to a correction from that state, which turns an unrecorded write into an event in the
stream.

## Risks / Trade-offs

- [An action stuck in verification cannot have its deadline moved while it keeps escalating] ->
  Accepted: refusing the verification is the accurate thing to record when the work is not
  acceptable, and it restores editing.
- [A coordinator must take one extra step to fix a typo during verification] -> Accepted: the same
  step that documents why the work was not accepted.
- [Two rules for one boundary, in TypeScript and in SQL] -> Same trade-off as the transition table;
  integration tests assert the service and direct SQL paths against each other.

## Migration Plan

1. Ship migration 0044 (`CREATE OR REPLACE` of the guard function only; no data conversion, no
   grant, revoke or policy change).
2. Deploy contracts, API and web together; the endpoint contract does not change, only the state in
   which it is accepted.

Rollback is pre-production: restore the 0043 guard body.
