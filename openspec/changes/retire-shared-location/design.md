## Context

See `proposal.md` for the motivation and `specs/catalog/spec.md` for the observable contract.
The existing catalogue writes already use the coordinator guard and `withSessionClient`; the
database grants allow updating only `name` and `deactivated_at` on both relevant tables. The
`organization_location` table is organization-wide and has no RLS, while `location` is protected
by site RLS.

This change does not alter an immutable table's identity or delete data. It updates the allowed
status column on `organization_location` and `location`; no migration is required because the
necessary grants and database protections already exist. The implementation must continue to
respect ADR-002 and ADR-004.

## Goals / Non-Goals

**Goals:**

- Expose one coordinator-only PATCH operation for retiring an active shared location.
- Perform the shared-row update and the in-scope physical cascade in the existing request
  transaction.
- Make the operation explicit in `/locations`, with accessible row-specific actions and a
  confirmation that explains the future-template and historical-finding consequences.
- Refresh both catalogue populations after success.

**Non-Goals:**

- No schema migration, DELETE, reactivation endpoint, or physical-location action.
- No endpoint counting template sections that reference the shared location.
- No attempt to bypass or replace RLS with endpoint site filtering.

## Decisions

### Use a strict one-way command contract

Add `deactivateOrganizationLocationSchema` with `{ deactivated: true }`, matching the existing
identity command convention. `z.boolean()` would imply that the console supports reactivation;
the literal keeps the public endpoint limited to the one operation the UI offers.

### Update the shared row before the physical cascade

Within `withSessionClient`, update the active `organization_location` and treat zero affected rows
as not found, then update active physical `location` rows for the same organization-location id.
The helper already wraps the callback in `BEGIN`/`COMMIT`/`ROLLBACK`, so the two statements are
atomic without a new transaction abstraction. A single SQL cascade or a separate service call was
rejected because separate statements make the authorization and failure boundary less explicit.

The apparent scope asymmetry is intentional and must be documented beside the method:
`organization_location` has no RLS, so deactivation applies to the entire organization;
`location` has RLS, so only physical rows in the executor's site scope are updated. A one-site
coordinator can therefore leave another site's physical mapping active, which is correctly shown
as an orphan rather than hidden or modified outside scope.

### Keep the dialog outside the table row

`LocationsRoute/index.tsx` owns the `retiring` shared-location state and mounts one
`RetireLocationDialog` at the route level. The dialog invalidates both
`queryKeys.organizationLocations()` and `queryKeys.catalogLocations()`. Keeping it outside the
row avoids unmounting the dialog while its successful mutation removes the row that opened it.

The action button directly opens the confirmation instead of introducing a one-action menu. The
button's accessible name includes the shared location name, and the fourth table header remains
present at mobile widths because it is the only way to reach this operation.

### Preserve server-derived historical behavior

The confirmation text distinguishes future template-section resolution from already stored
findings. Existing findings continue resolving through their physical `location` row, while the
submission lookup excludes deactivated `organization_location` mappings and therefore future
sections can produce no location. No historical rows are rewritten by this change.

## Risks / Trade-offs

- [Risk] A coordinator scoped to one site can deactivate the organization-wide shared row while
  leaving another site's physical mapping active. -> The method documents this deliberate RLS
  boundary, and the existing orphan list exposes the resulting state.
- [Risk] A successful retirement makes a template section resolve without a location. -> Require a
  confirmation with the exact consequence; do not add a speculative reference-count endpoint.
- [Risk] Query invalidation can remove the row while the dialog is completing. -> Mount the dialog
  outside `LocationRow` and invalidate both affected query keys after the mutation.

## Migration Plan

No migration. Deploy the contract, API, UI, and tests together. Rollback is a code rollback; rows
already deactivated remain deactivated and can only be reactivated by the existing server-side
command, not by this UI endpoint.
