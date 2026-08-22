## Context

See `proposal.md` for the motivation and `specs/catalog/spec.md` for the observable contract.
The current catalogue already stores editable `site.name` and nullable `site.deactivated_at`, but
`hs_app` has no update privilege on `site`; the existing location trigger audits only location
name/deactivation changes. `location` is site-isolated by RLS and maps a physical row to the shared
`organization_location` catalogue through `organization_location_id`.

This change touches the mutable catalogue tables `site` and `location`. It does not alter the
identity columns or any append-only table. The implementation must preserve ADR-002/004 (engine
enforced immutability and RLS) and ADR-008 (controller -> service -> repository).

## Goals / Non-Goals

**Goals:**

- Provide one coordinator-only API operation for site rename and site removal.
- Make removal one database transaction that deactivates the site and clears its physical mappings.
- Move lifecycle auditing into database triggers so every write path is covered.
- Keep deactivated sites and physical locations available for historical resolution.
- Invalidate the Locations console queries after a successful mutation.

**Non-Goals:**

- Reactivating sites or changing site codes.
- Deleting sites, physical locations, or shared organization locations.
- Revoking account site scopes as a side effect of deactivation.
- Changing the offline capture flow; Locations remains an online coordinator console.

## Decisions

### Database permissions remain column-scoped

The migration SHALL grant `UPDATE (name, deactivated_at)` on `site` to `hs_app`, while retaining
the existing `hs_catalog_guard` and delete/truncate guards. `location` already grants the needed
`organization_location_id` update. No table-wide update or delete grant is introduced.

Alternative rejected: relying on the service to reject a code or identity update. The existing
catalogue pattern requires the database to reject bypasses, including migration-role writes.

### Database triggers own the new audit events

Extend the site audit trigger to write `site.renamed` and `site.deactivated`. Extend the location
audit trigger to detect a change of `organization_location_id` from non-null to null and write one
`location.unlinked` event containing the previous mapping. The triggers use `app.user_id`, exactly
like the existing catalogue audit, and let the audit-chain trigger fill sequence and hash fields.

Alternative rejected: inserting audit rows in `SitesService`. That would make audit completeness
depend on this endpoint and would duplicate the database-owned catalogue rule.

### Removal is a single scoped transaction

The repository will use `DbService.withSessionClient` and issue, in one transaction, an update of
the scoped site followed by an update of `location` rows for that `site_id` where
`organization_location_id IS NOT NULL`. RLS remains the authority for location visibility; the
service does not manufacture a site scope or use a broad cross-site operation. The update returns
the changed site and the count of affected locations for observability, while the trigger emits one
audit event per changed physical row.

The service checks coordinator role and rejects already-deactivated sites before the transaction.
The database remains the final authority for identity columns, privileges, RLS and audit integrity.

Alternative rejected: a separate `POST /unlink` followed by `PATCH /site`. That exposes a partial
state to concurrent requests and cannot provide the atomicity required by the removal contract.

### Use separate explicit HTTP operations

Keep `GET /sites` and `POST /sites` unchanged. Add `PATCH /sites/:siteId` with a body containing
only `name` for rename, and `POST /sites/:siteId/deactivate` with no mutable identity fields for
removal. Both resolve the site through the session scope and return the shared `Site` contract;
deactivation also returns the unlink count if the endpoint contract needs it for the UI toast.

Alternative rejected: a polymorphic `PATCH` that accepts optional `name` and `deactivated_at`.
Separate operations make the irreversible removal action explicit and prevent clients from
requesting an arbitrary timestamp or combining unsupported transitions.

### The sheet owns management UI state

`LocationsRoute` will keep `Manage sites` beside `Add site` and render a route-local
`ManageSitesSheet`. The sheet lists the already fetched scoped sites, shows deactivated status,
uses a small inline rename form, and requires a confirmation step for removal. Mutation success
closes the relevant form, invalidates sites and catalogue-location queries, and displays the
existing error/status conventions. Deactivated sites are not passed as active columns to
`MappingTable`, while they remain available in the sheet and in historical API data.

Alternative rejected: a new route or a global admin modal. The operation is specific to the
Locations catalogue and the existing `Sheet` primitive already provides focus, Escape and mobile
behavior.

## Risks / Trade-offs

- [Risk] A site deactivation updates many `location` rows and emits many audit entries. -> Keep it
  transactional, update only mapped rows, and add an integration test for the count and chain.
- [Risk] A deactivated site may still be present in a session's scope. -> Keep it visible to
  historical resolution and filter only active presentation columns; never revoke scope rows.
- [Risk] Trigger ordering can make audit writes fail under RLS if the transaction scope is absent.
  -> Use `withSessionClient`, preserve the declared site scope, and test the complete transaction
  with a coordinator session.
- [Risk] A stale sheet can submit a second removal. -> Reject non-null `deactivated_at` and map the
  conflict to HTTP 400 without changing mappings.

## Migration Plan

1. Add a hand-written Drizzle migration after `0022` that grants site column updates, replaces the
   site audit trigger function, extends the location audit trigger function, and grants no delete
   privilege.
2. Deploy the API and web changes after the migration is applied. Existing sites retain null
   `deactivated_at`, and existing location mappings remain unchanged.
3. If application rollout must be rolled back, leave the additive migration in place: the old API
   does not expose the new operations, and the data remains readable. Do not reverse the migration
   with destructive DDL or remove audit entries.
