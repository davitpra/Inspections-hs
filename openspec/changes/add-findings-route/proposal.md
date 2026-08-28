## Why

Findings are currently embedded in the corrective-actions screen, so an inspector cannot navigate directly to the findings recorded for their sites and the actions screen mixes two distinct resources. This change corrects the UI boundary between the findings work delivered in requirements v1.2 §7 stage 4 and the corrective-actions work delivered in stage 5; it does not close a new stage because both stages are already implemented.

## What Changes

- Add a dedicated `/findings` screen listing findings within the signed-in user's site scope.
- Offer the Findings navigation destination to `jhsc_member` inspectors and `hs_coordinator` users.
- Keep finding review read-only for inspectors while allowing coordinators to create a corrective action from a finding.
- Remove the findings list from `/actions` so that route is dedicated to existing corrective actions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `findings`: Define the dedicated findings screen and its role-specific navigation and controls.

## Impact

- Web router, navigation visibility and mobile section titles.
- Findings and corrective-actions route composition and route tests.
- No API, database schema, RLS policy, contract or dependency changes.
