# Reactivate a site from the Locations console

## Why

Removing a site from `Manage sites` is, today, a one-way door taken by accident. The sheet
lists the removed site with a `Removed` pill and no action beside it, and the confirmation
that leads there says *"This cannot be undone"* — so a coordinator who removes the wrong
plant, or removes one that reopens, has nowhere to go inside the application.

The engine never agreed with that sentence. `0023` granted `UPDATE (name, deactivated_at)
ON site` — both directions of the column — and `hs_catalog_guard` only defends `id`, `code`
and `created_at`. `2026-08-21-manage-sites-from-locations-console` even wrote the reversal
into its own proposal: the unlinked physical locations *"become visible as orphans when the
site is active again"*. The only thing that made removal permanent was the application
refusing to offer the other half, and `catalog` §"register a new site" said so in one word:
*"The application SHALL NOT offer a physical removal or reactivation operation."* That word
is what this change removes.

This does not close a new stage of requirements-v1.2 §7. It finishes the site-management
half of **stage 2** that `manage-sites-from-locations-console` opened: a lifecycle the
console can enter but not leave is not managed, it is one-way. Physical removal stays
prohibited — reactivation is not deletion, it is the same append-only column read the other
way, and the chain records the trip in both directions.

## Lo que este change NO es

- **It is not a physical removal.** `DELETE` on `site` stays revoked and
  `site_forbid_deletion` stays in place. Nothing here grants it.
- **It is not a code change.** `code` remains permanent for an active site, a removed one
  and a restored one. Restoring a plant is not a way to recycle an identifier.
- **It is not an undo of the removal's side effects.** Removing a site unlinks every
  physical location of that site from the shared catalogue. Reactivation restores the
  **site**, not those links: the physical rows come back as orphans in the mapping table and
  the coordinator ticks them again. Reconstructing a past mapping out of `audit_log` would
  be guessing at a state the shared catalogue may no longer support.
- **It is not a new scope rule.** `user_site_scope` is never revoked when a site is
  deactivated (`identity` §"Historical access still resolves the deactivated site"), so the
  restored site is already reachable by the coordinator who removed it. No scope is granted
  here.

## What Changes

- Add a coordinator-only `Restore` action beside the `Removed` pill in the `Manage sites`
  sheet, with its own confirmation, stating that the site's physical locations come back
  unmapped.
- Add a site reactivation operation that sets `deactivated_at` back to null for a scoped
  site, refusing an already-active site and a site outside the session's scope.
- Record `site.reactivated` in that site's audit chain, mirroring the `site.deactivated`
  entry the engine already writes and the `location.reactivated` branch `hs_catalog_audit`
  already has.
- Reword the removal confirmation and the sheet's note: removal is reversible, and what is
  not automatically reversible is the unlinking of its physical locations.
- **BREAKING (spec only, no stored data):** `catalog` no longer states that the application
  offers no reactivation operation.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `catalog`: site management from the Locations console covers reactivating a removed site,
  and the registration requirement no longer forbids a reactivation operation. Reactivation
  does not restore the `organization_location_id` links the removal cleared.
- `audit`: the site lifecycle event types gain `site.reactivated`.

## Impact

- `apps/api/drizzle` gains a migration that replaces `hs_site_audit` with the
  `NOT NULL → NULL` branch. No new `GRANT`, no new policy: `0023` already granted the
  column and `site` still carries no RLS (`0004`).
- `packages/contracts` gains a strict, empty reactivation request schema beside
  `deactivateSiteSchema`.
- `apps/api` gains `POST /sites/:siteId/reactivate` and its coordinator-only service method.
- `apps/web` gains a `reactivateSite` client call and the Restore branch of
  `ManageSitesSheet`. Nothing else on the web side changes: the Locations columns, the
  template scope picker and `src/presentation/sites.ts` all derive from `deactivated_at`
  and pick the site back up on their own.
- Integration tests cover the permission, the two refusals, the audit entry and the fact
  that unlinked locations stay unlinked; the Locations route test covers the Restore flow.
