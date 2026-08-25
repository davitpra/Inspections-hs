## Context

See `proposal.md` for motivation. `GET /scheduled-inspections` returns every period visible in the session's site scope because the scheduling and JHSC surfaces legitimately need site-wide data. The inspector home already consumes that cached reading to derive completed work by matching `inspector_id` to the account id.

The annual matrix is implemented inside `SchedulingRoute`, but its rendering is read-only and already receives projected entries rather than deciding ownership. The change must preserve ADR-001: the annual server history is not an offline synchronization mechanism and does not replace local drafts or the pending reading.

## Goals / Non-Goals

**Goals:**

- Reuse one annual matrix presentation for scheduling and the inspector home.
- Derive the inspector entries from recorded periods assigned to the current account.
- Keep period selection read-only on the inspector home.

**Non-Goals:**

- Project unopened obligations for an inspector.
- Add assignment, cancellation or recurrence controls to the inspector home.
- Change the pending list, recent completed list or offline behavior.

## Decisions

### Filter the existing scheduled-period reading in the client

The inspector calendar will filter the cached scheduled-period list by `inspector_id` and selected `period_start` year, following the existing completed-inspections derivation. A dedicated API would return less data but would duplicate an already loaded reading and is unnecessary for this small, site-scoped dataset. RLS remains the security boundary; the client filter only decides what this surface presents.

### Feed only opened entries to the annual matrix

Each matching `ScheduledInspection` becomes an `opened` year entry. Inspection rules are not projected on the inspector home because an unopened obligation has no `inspector_id` and therefore is not the inspector's assignment. The scheduling surface continues to project rules and unopened periods unchanged.

### Promote and generalize the annual schedule presentation

The annual section, matrix and legend will move to shared components because they now cross route boundaries. Scheduling presentation rules will likewise move beside the other shared presentation decisions instead of making one route depend on another route's internals. `ScheduleSection` will accept a small copy object with defaults for the administrative scheduling surface; the inspector home supplies wording that describes personal assignments. This keeps the matrix, legend, year navigation and empty presentation consistent without duplicating markup.

The component remains read-only and uses the existing period detail dialog. No ADR-008 backend module boundary changes.

## Risks / Trade-offs

- [The scheduled-period endpoint contains site-wide rows] → Match `inspector_id` before creating any matrix entry and cover isolation with a route test; RLS continues to constrain visible sites.
- [Recent inspections duplicate completed cells in the calendar] → Retain the recent list because the current inspections spec requires fast chronological read-back and a link to full history.
- [Promoting existing scheduling presentation touches several imports] → Preserve function signatures and run both scheduling and inspector route suites before building the web artifact.

## Migration Plan

Deploy as a web-only change. No schema, API, contract, immutable table or data migration is involved; rollback consists of removing the inspector-home composition and optional copy API.
