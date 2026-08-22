## Why

The Locations console can now add a site, but it cannot correct a site name or retire a site
without leaving the coordinator to request a migration-role intervention. The console already
renders sites as columns, so site lifecycle management belongs beside `Add site`, where its impact
on locations, templates and inspections is visible.

This completes the site-management part of stage 2 of requirements-v1.2 §7 while preserving the
append-only record: removing a site is a logical deactivation, never a physical delete.

## What Changes

- Add a coordinator-only `Manage sites` button beside `Add site` in the Locations console.
- Open a right-side sheet listing scoped sites, their mapped-location progress, and edit/remove actions.
- Allow editing a site's human-readable `name`; `code` remains permanent and immutable.
- Remove a site by setting `deactivated_at`, hiding it from active Locations columns while retaining
  the site and all historical records.
- Atomically unlink every physical location of the removed site from its shared
  `organization_location` by setting `organization_location_id` to null; physical location rows
  remain stored and become visible as orphans when the site is active again.
- Audit site renames, site deactivations and the location unlinks in the site's audit chain.
- Keep `UPDATE` limited to `name` and `deactivated_at`; do not grant or expose `DELETE`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `catalog`: Coordinators can manage site names and retire sites from the Locations console, with
  atomic unlinking of that site's physical locations.
- `identity`: A deactivated site remains historical data and no longer appears as an active site
  reachable through the Locations console.
- `audit`: Site rename, deactivation and location unlink operations are recorded by the database
  engine.

## Impact

- `apps/api/drizzle` gains a migration changing site privileges and adding the site lifecycle and
  unlink audit behavior.
- `packages/contracts` gains strict update/deactivation request schemas.
- `apps/api` gains coordinator-only site update/deactivation endpoints and transactional repository
  behavior.
- `apps/web` gains the Manage sites sheet, edit form, remove confirmation, query invalidation and
  responsive styling.
- Integration and Locations route tests cover permissions, audit entries, atomic unlinking,
  historical retention and the sheet interactions.
