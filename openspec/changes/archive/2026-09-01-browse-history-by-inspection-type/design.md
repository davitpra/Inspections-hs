## Context

See `proposal.md` for motivation. `/historical` currently reads the site-scoped scheduled
inspection projection, narrows it to completions assigned to the session account, and renders
all resulting rows. `CompletedInspectionsTable` is shared with findings and already owns the
responsive and report-link behavior.

The history is an online server reading, consistent with ADR-001 and ADR-010. This change
does not touch any immutable table or any database table at all.

## Goals / Non-Goals

**Goals:**

- Give each stable `template_id` one named table on the complete history page.
- Keep filtering, ordering and grouping deterministic and independently testable.
- Reuse the existing query key and completed-inspection table.

**Non-Goals:**

- Add a server endpoint, pagination, year/month filtering or offline history.
- Group by template version or mutable display name.
- Change report addressing or completion derivation.

## Decisions

### Keep every historical type on `/historical`

`template_id` is the stable identity across template versions, while `template_version_id`
would split one inspection type and the schedule id would identify only one recurrence rule.
Each stable identity becomes a named section with its own `CompletedInspectionsTable`. The
route does not add a detail address: all groups remain visible together and the report link
continues to be the only navigation from an inspection row.

### Derive both views from the existing scheduled-inspection query

The history uses `queryKeys.scheduledInspections()` followed by `completedInspections`, plus
the existing sites query needed to resolve each table's site names. TanStack Query therefore
reuses the warm caches while the client keeps applying the account-specific projection already
required by the current API shape. A dedicated endpoint would add a second definition of the
list without a demonstrated volume need.

### Keep route-specific grouping in pure presentation code

The history and findings readings group by `template_id`, retain the most recent historical
name for presentation, keep each group's already ordered inspections and sort groups by name.
These decisions live in `presentation/inspections.ts`; route components only compose data and
UI. The intersection between completed inspections and findings lives in
`presentation/findings.ts` before the findings groups are formed.

### Use the same grouped-table structure for history and findings

Both readings use named sections containing `CompletedInspectionsTable`, and each table gets a
distinct accessible name. Findings narrows the completed list to inspections that recorded a
finding before grouping it, then links each row directly to `/findings/$id`. No intermediate
type route or type-index component remains.

### Preserve the existing individual findings address

`/findings/$id` already identifies a scheduled inspection and remains unchanged. The findings
reading derives data in the order `completedInspections` → `inspectionsWithFindings` →
`inspectionTypeGroups`, so clean inspections and other inspectors never enter a section.

## Risks / Trade-offs

- [The same template had different historical names] → Use the first item from the
  newest-first completed list so the section has one deterministic current historical label
  while individual rows preserve their own names.
- [The client receives the complete scheduled list] → Preserve the existing architecture and
  query cache; revisit pagination only with measured volume.
- [Many inspection types make the page long] → Preserve one complete server reading and avoid
  adding pagination without measured volume; headings keep every table navigable by structure.
- [A manual finding has no inspection type] → Keep it outside this inspection-derived reading,
  matching the declared regression of the existing findings route.

## Migration Plan

Deploy the web route and UI atomically. Existing `/historical` bookmarks continue to resolve;
the temporary `/historical/$templateId` and `/findings/types/$templateId` details are removed.
No persisted data or API migration is required. Rollback consists only of restoring the
previous route components and detail routes.
