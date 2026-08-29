## Why

Findings are currently embedded in the corrective-actions screen, so an inspector cannot navigate directly to the findings recorded for their sites and the actions screen mixes two distinct resources. This change corrects the UI boundary between the findings work delivered in requirements v1.2 §7 stage 4 and the corrective-actions work delivered in stage 5; it does not close a new stage because both stages are already implemented.

## What Changes

- Add a dedicated `/findings` screen listing findings within the signed-in user's site scope.
- Offer the Findings navigation destination to `jhsc_member` inspectors and `hs_coordinator` users.
- Keep finding review read-only for inspectors while allowing coordinators to create a corrective action from a finding.
- Remove the findings list from `/actions` so that route is dedicated to existing corrective actions.
- Display, on both the full inspection report and the findings-only reading, the corrective action the template item prescribed for each recorded finding, taken from the document frozen with the submission.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `findings`: Define the dedicated findings screen, its role-specific navigation and controls, how a recorded finding is read next to the corrective action its template item prescribed, and how a coordinator opens a corrective action from it.
- `actions`: Remove the findings listing and the creation form from the corrective actions workspace; that behaviour moves to `findings`.

## Impact

- Web router, navigation visibility and mobile section titles.
- Findings and corrective-actions route composition and route tests.
- The finding readout shared by the report and the findings-only screen.
- No API, database schema, RLS policy, contract or dependency changes.
- **Accepted regression — a manual finding loses its creation path.** A finding reported outside an inspection has no `inspection_id`, so it appears on neither `/findings` (which lists inspections) nor `/findings/$id`. Removing the findings listing from `/actions` leaves it with no way to open a corrective action from the PWA. `POST /findings/:id/actions` still accepts one; only the screen is missing. This is a declared trade-off of this change, to be closed by a later one.
