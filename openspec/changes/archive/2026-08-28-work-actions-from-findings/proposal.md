## Why

The findings reading of a submitted inspection lets a coordinator open a corrective action
without losing the record that justifies it, but everything after creation — reading how the
commitment stands, and moving it along — is only reachable at `/actions/$id`. The loop is
asymmetric: the finding is the anchor for making a commitment and stops being the anchor the
moment the commitment exists, so the one question a reader of that screen actually has, "is
this being handled", costs a navigation away from the inspection they were reading.

**This change closes no stage of §7.** Stage 4 (findings) and stage 5 (corrective actions) are
both implemented; so is the UI boundary correction proposed in `add-findings-route`, which this
change extends. It exists because that boundary was drawn for creation only, and the half of
the flow that comes after it was left on the other side.

## What Changes

- Read a finding's existing corrective actions as their current standing — state, responsible
  person, deadline, whether they are late, and the escalation levels they reached — instead of
  a description and a state badge. Every field already travels in the corrective action listing
  the screen fetches, so this adds no request.
- Offer, on the findings-only reading, a control that opens the corrective action's event
  history and the transitions available to the reader, so the work can be advanced without
  leaving the inspection. The transitions offered are exactly the ones the state machine and
  the acting role allow — the same table the server enforces, never a second copy of it.
- Keep `/actions/$id` as the permalink of a corrective action. It is the destination of the
  corrective actions workspace and of escalation notices, and the finding's commitment stays
  linked to it.
- Lift the event timeline, the "what now" panel and the evidence picker out of the action
  detail route into shared components, so the route and the findings screen compose one
  implementation of the state machine's presentation rather than two.
- No change to who may do what: the offer is convenience, the guarantee stays RLS and the role
  the server checks on every transition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `findings`: Define how a recorded finding's existing corrective actions are read — their
  standing, not only their name — and how an authorized account advances one from the findings
  reading itself without the finding ceasing to be the anchor.

## Impact

- `apps/web` only: the findings-only route composition, the corrective action detail route it
  borrows from, and the shared components both compose. Route tests for both.
- No API, database schema, RLS policy, contract or dependency changes. `GET /actions/:id` and
  `POST /actions/:id/transitions` are unchanged and already return and accept exactly what the
  screen needs.
- No change to the `actions` capability requirements: the state machine, the verifier rule, the
  evidence rule and the site scope are untouched, and the screen is bound by them as before.
- **Depends on `add-findings-route`.** That change owns the findings-only screen and the
  creation control this one grows around; the two must not be applied out of order.
- **Accepted consequence — a corrective action of a manual finding is still unreachable from
  the PWA.** `add-findings-route` declared that regression; this change does not widen it and
  does not close it either. The commitment readout and the update control follow the finding,
  so a finding with no screen still has no path to its actions.
- No offline path is added. A corrective action is advanced with a connection (design D15) and
  uploading evidence needs one; the findings screen already reads from the server (ADR-010).
