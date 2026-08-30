## Context

See `proposal.md` for motivation. `/historical` currently reads the site-scoped scheduled
inspection projection, narrows it to completions assigned to the session account, and renders
all resulting rows. `CompletedInspectionsTable` is shared with findings and already owns the
responsive and report-link behavior.

The history is an online server reading, consistent with ADR-001 and ADR-010. This change
does not touch any immutable table or any database table at all.

## Goals / Non-Goals

**Goals:**

- Give each stable `template_id` one index row and a dedicated history address.
- Keep filtering, ordering and grouping deterministic and independently testable.
- Reuse the existing query key and completed-inspection table.

**Non-Goals:**

- Add a server endpoint, pagination, year/month filtering or offline history.
- Group by template version or mutable display name.
- Change report addressing or completion derivation.

## Decisions

### Use `/historical/$templateId` for the detail

`template_id` is the stable identity across template versions, while `template_version_id`
would split one inspection type and the schedule id would identify only one recurrence rule.
The detail remains outside `/inspections/*` so the service worker does not mistake this
online-only reading for capture content.

### Derive both views from the existing scheduled-inspection query

Both routes use `queryKeys.scheduledInspections()` followed by `completedInspections`. TanStack
Query therefore reuses the warm cache while the client keeps applying the account-specific
projection already required by the current API shape. A dedicated endpoint would add a second
definition of the list without a demonstrated volume need.

### Keep route-specific grouping in pure presentation code

The index groups by `template_id`, retains the most recent historical name for presentation,
counts each group's inspections and sorts groups by name. The detail filters the already
ordered completed list by the route parameter. These decisions live in
`HistoricalInspectionsRoute/presentation.ts`; route components only compose data and UI.

### Use an explicit link inside the type cell

A block-level typed `Link` makes the visible type cell the navigation target without adding
imperative row click handling or invalid interactive table markup. The count remains a plain
value and the destination remains usable by keyboard and assistive technology.

## Risks / Trade-offs

- [The same template had different historical names] → Use the first item from the
  newest-first completed list so index and detail have one deterministic current historical
  label while individual rows preserve their own names.
- [The client receives the complete scheduled list] → Preserve the existing architecture and
  query cache; revisit pagination only with measured volume.
- [A copied detail URL names a type no longer visible to the account] → Derive visibility from
  the same account-filtered completed list and render a not-visible state.

## Migration Plan

Deploy the web route and UI atomically. Existing `/historical` bookmarks continue to resolve
to the new index; no persisted data or API migration is required. Rollback consists only of
restoring the previous route component and removing the detail route.
