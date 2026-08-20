## Why

The Locations console can create shared destinations but cannot retire one created with an
incorrect code, leaving it available to template builders indefinitely. This closes the catalogue
console lifecycle gap in requirements-v1.2 §7 while preserving historical location references and
the no-delete invariant.

## What Changes

- Add a coordinator-only operation to deactivate an `organization_location` from the Locations
  console.
- Cascade the deactivation to the physical `location` rows in the requester's site scope, in the
  same transaction.
- Expose the operation through the shared contract, API, and web UI with an explicit warning about
  template sections becoming location-less while existing findings retain their physical location.
- Add the actions column and confirmation dialog to `/locations`; do not add an action to orphaned
  physical-location rows.
- Return authorization and already-deactivated errors through the existing API conventions.
- Do not add a migration or a reactivation control.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `catalog`: A coordinator can deactivate an organization-wide location, the operation deactivates
  in-scope physical mappings atomically, and inactive shared destinations are no longer offered by
  catalogue reads.

## Impact

- `packages/contracts` gains the strict deactivation request schema and export.
- `apps/api` gains `PATCH /organization-locations/:id` and the transactional cascade, using the
  existing coordinator authorization and RLS scope.
- `apps/web` gains the API call, row action, confirmation dialog, query invalidation, styling, and
  route tests.
- Integration tests exercise both-site cascading, coordinator authorization, and idempotent
  not-found behavior against Postgres.
- Database schema and migrations are unchanged; existing UPDATE grants are used.
