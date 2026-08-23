# Design — Reactivate a site from the Locations console

## Context

See `proposal.md` — Why. What matters here is what already exists and does not need to be
built:

- `0023_manage_sites_from_locations_console.sql` granted `UPDATE (name, deactivated_at) ON
  site TO hs_app`. The column is grantable in both directions; nothing distinguishes
  `SET deactivated_at = now()` from `SET deactivated_at = NULL` at the privilege level.
- `hs_catalog_guard` (`0004`) rejects a change to `id`, `code` or `created_at` for every
  role, `hs_migrator` included. `deactivated_at` is deliberately outside it.
- `site` carries no RLS policy, by the circularity documented in `0004` and restated in
  `SitesService`. Scope on this table is *selection* (`id = ANY(session.siteIds)`), and
  `user_site_scope` is never revoked when a site is deactivated (`identity` spec), so the
  coordinator who removed a plant can still reach it.
- `hs_site_audit` only writes `site.deactivated`, on `OLD.deactivated_at IS NULL AND
  NEW.deactivated_at IS NOT NULL`. The reverse transition currently commits silently — the
  one real gap on the engine side.
- On the web side, every consumer of a site's availability already derives it from
  `deactivated_at`: `LocationsRoute/index.tsx` filters the columns,
  `src/presentation/sites.ts` filters the scope picker, `TemplateDraftRoute/presentation.ts`
  filters the template scope. A restored site reappears everywhere without a line of change.

## Goals / Non-Goals

**Goals**

- One reversal path, from the same sheet that performed the removal.
- The reversal is recorded in the protected chain, like every other site lifecycle step.
- No new privilege and no new policy: this change must not widen what `hs_app` can do to
  `site`.

**Non-Goals**

- Restoring the `organization_location_id` links the removal cleared (see Decision 2).
- Any change to `code` mutability, physical deletion, or scope granting.
- A generic "undo" mechanism. This is one operation on one column, not a pattern.

## Decisions

### 1. A separate `POST /sites/:siteId/reactivate`, not a flag on the update

`updateSiteSchema` stays `{ name }`. Reactivation gets its own strict empty body, mirroring
`deactivateSiteSchema`.

*Why:* the `catalog` spec requires that registration and update expose no lifecycle field
(*"Registration exposes no lifecycle fields"*, *"The registration operation SHALL NOT accept
`deactivated_at`"*). `location` does carry `deactivated: boolean` inside `updateLocationSchema`,
and that is the alternative considered — but a physical location's lifecycle is a property
the mapping table edits inline, while a site's lifecycle is a distinct operation with its own
confirmation and its own audit event. Two POST verbs that mirror each other read the same way
in the controller, the client and the test as the pair they are.

*Rejected:* `PATCH /sites/:id { deactivated: false }` — it would make one endpoint capable of
both renaming and resurrecting a plant, and would need a `.refine` to keep an empty body out.

### 2. Reactivation restores the site, not its mappings

The service touches exactly one row: `UPDATE site SET deactivated_at = NULL`. It runs no
statement against `location`.

*Why:* the deactivation's unlink is not a side effect to be replayed. `audit_log` does keep
`previous_organization_location_id` in each `location.unlinked` entry, so a replay is
technically reachable — and that is the rejected alternative. It fails on its own terms: the
shared `organization_location` may have been retired in the meantime, another site may now
hold the mapping the removal freed, and a replay would have to decide what to do about each
without the coordinator present. The mapping table already renders unmapped rows as orphans —
`add-site-from-locations-console` designed that screen around exactly this — so the honest
restore is the one that hands the coordinator the ticks back.

*Consequence for the UI:* the removal confirmation can no longer say *"This cannot be
undone"*, and must not simply say the opposite either. It says the site can be restored and
that its locations come back unmapped.

### 3. The audit branch goes in the trigger, not in the service

`CREATE OR REPLACE FUNCTION hs_site_audit()` gains the `NOT NULL → NULL` branch, exactly as
`hs_catalog_audit` already does for `location.reactivated` (same file, `0023`).

*Why:* ADR-002 and the `audit` spec both put this in the engine so that *any* write path is
recorded — a seed, a fix run by `hs_migrator`, a future endpoint. A service-side INSERT would
audit this endpoint, not this transition.

### 4. The race is arbitrated by the UPDATE, not by a lock

`... AND deactivated_at IS NOT NULL RETURNING ...`, then a follow-up `SELECT` to tell 404
from 400 when zero rows come back.

*Why:* the identical reasoning `deactivate` already carries in a comment — `hs_app` holds
`UPDATE` only per column on `site`, and `SELECT ... FOR UPDATE` requires the whole-table
privilege. Two concurrent restores: exactly one finds the row still deactivated; the other
gets HTTP 400.

## Risks / Trade-offs

- **A restored site silently loses its location mappings, and the coordinator does not
  notice** → the confirmation states it before the restore, and the restored columns render
  their locations as unmapped orphans, which is the console's existing signal for "needs a
  tick".
- **Removal stops feeling consequential now that it is reversible** → removal keeps its own
  confirmation, and its consequence on the mapping is real and not automatically reversible.
  The wording carries that, rather than a false claim of permanence.
- **`CREATE OR REPLACE` on `hs_site_audit` drifts from `0023` if that file is ever edited** →
  the new migration reproduces the whole function body, which is how `0023` itself replaced
  `hs_catalog_audit`. The latest migration is the definition.
- **A restored site re-enters template scope and scheduling pickers** → that is the intent,
  and it is derived, not stored: `template-scope-excludes-removed-sites` filters on
  `deactivated_at` at read time, so nothing needs backfilling.

## Migration Plan

One forward migration, `0026_reactivate_site.sql`, containing only the `CREATE OR REPLACE
FUNCTION hs_site_audit()` with the added branch and the `DROP TRIGGER` / `CREATE TRIGGER`
pair that `0023` uses. No `GRANT`, no `REVOKE`, no policy, no data change — a database that
has run `0023` is already capable of the operation and is only missing the record of it.

Rollback: replace the function with the `0023` body. No row is written or altered by the
migration itself, so there is nothing to undo in the data. A site restored before a rollback
stays restored, with its `site.reactivated` entry intact in the chain.

Deploy order is the ordinary one: migration, then API, then web. Between migration and API
the branch is simply never triggered; between API and web the endpoint exists and nothing
calls it.
