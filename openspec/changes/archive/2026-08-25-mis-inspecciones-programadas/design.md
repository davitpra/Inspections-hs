## Context

`GET /me/pending-inspections` already returns every pending assignment for the account in
`period_end` order. The implemented list currently lives at `/inspections/scheduled`, while
`/` still selects one assignment with `focusedAssignment` and combines its preparation with
next, history, and device-draft sections.

The revision is entirely in `apps/web`. It applies **ADR-001** because selecting one
assignment still leads to one-device capture, **ADR-002 / ADR-004** because the existing
RLS-scoped reading remains the authority, and **ADR-008** because presentation decisions
stay outside route composition. It does not touch any immutable table or require a
migration.

## Goals / Non-Goals

**Goals:**

- Make the complete pending list the inspector's first authenticated surface.
- Give an explicitly selected assignment a stable detail URL before capture.
- Keep bulk field preparation possible from the list.
- Preserve accepted-submission feedback, history access, and recoverable local drafts.

**Non-Goals:**

- Change capture, review, report, server filtering, contracts, or offline ownership.
- Make an entire HTML table row behave as an inaccessible JavaScript click target.
- Keep an unpublished compatibility route for `/inspections/scheduled`.

## Decisions

### D1 — The list owns `/`; the selected assignment owns `/inspections/$id`

The root route keeps its existing accepted-submission search parameter but renders the
pending list. A static detail route resolves its `id` against the same cached pending query.
Static paths such as `past` remain declared before the id route and TanStack Router ranks
them explicitly.

No redirect is kept for `/inspections/scheduled`: the route was introduced by this active,
unarchived change and has no shipped consumer.

### D2 — Selection replaces automatic focus

The detail never calls `focusedAssignment` or `nextAssignment`. It finds the exact pending
row whose id came from the route. A missing id produces an unavailable state with a back
link and no capture action.

The detail composes the existing assignment hero, progress, instructions, and site cards.
Next assignment, recent history, and the complete device-draft list do not belong to one
selected assignment and stay on the root or behind their existing history destination.

### D3 — List preparation remains operational

Each row retains its local readiness query and the shared status derivation. Missing
packages retain `DownloadForField`; ready or in-progress rows navigate to the detail instead
of capture. The requirement name is an ordinary accessible link as well, rather than making
`<tr>` clickable.

### D4 — Existing supporting exits move with Home

`InstallPrompt`, the accepted-submission notice, local draft management, and access to
`/inspections/past` remain reachable from `/`. This prevents the route split from removing
recovery or history behavior that was already shipped.

## Risks / Trade-offs

- **A direct detail URL needs the pending server reading.** → Reuse its cache and show an
  explicit connection state rather than guessing from unrelated local data.
- **A submitted assignment disappears from detail.** → Review already returns to `/` with
  the accepted acknowledgement, where the pending list is refreshed.
- **Moving route-owned components can create broad import churn.** → Move only components
  still used and delete automatic-focus code after its replacement tests pass.

## Migration Plan

Publish the root list and detail route together. Rollback restores the prior route mapping;
there is no persisted or server state to migrate.
