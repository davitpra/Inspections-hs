## Context

See `proposal.md` for motivation. `GET /actions` currently returns the same full object as the
detail endpoint, including every event and evidence item, while `ActionsRoute` renders only four
fields. The action row identifies its parent but does not carry the inspection/template chain,
site name or assignee name needed by an operational table.

The existing foreign-key chain can resolve inspection context without changing persistence:
`corrective_action` → `finding` → `inspection` → `scheduled_inspection` → `inspection_template`.
Manual findings and investigation-backed actions intentionally have no template.

ADR-002 governs the derived action state, ADR-004 governs site isolation, and ADR-008 permits the
actions repository to read related domain data directly without importing other NestJS providers.
This change reads immutable tables but does not modify any immutable table or database schema.

## Goals / Non-Goals

**Goals:**

- Give the action list enough historical source context to render and filter without client joins.
- Keep urgency visible by preserving due-date order across templates.
- Avoid transferring action histories that the list never renders.
- Represent every valid parent explicitly instead of treating a missing template as an error.

**Non-Goals:**

- Pagination, free-text search and server-side filtering.
- Changes to the action detail or transition workflow.
- New persistence, offline action data or links from inspection reports.
- Aggregated dashboards or recurrence analysis.

## Decisions

### Use a distinct action summary contract

`GET /actions` returns `ActionSummary[]`; `GET /actions/:id` continues to return `Action`. The
summary repeats operational scalar fields but omits event history. This makes accidental list
overfetch impossible at the contract boundary. Reusing `Action` with empty arrays was rejected
because empty history would falsely describe the record.

### Model source as a discriminated union

The summary source is one of `inspection`, `manual_finding` or `investigation`. Inspection sources
carry template and inspection identifiers; the other variants carry only their valid parent
context. A collection of nullable template fields was rejected because it could represent invalid
combinations and would force the UI to infer origin again.

### Resolve display context in the action repository

The list query uses left joins under the existing session-scoped transaction. It does not add a
site predicate; RLS remains the isolation boundary per ADR-004. Resolving names in the API avoids
three broad client queries and preserves historical/deactivated template names. Provider calls to
other modules were rejected because the context is one relational projection, not domain
orchestration, consistent with ADR-008.

### Filter the complete summary list in pure client code

The deployment has two sites and low action volume. State, source and site filters operate on the
loaded summaries and share one query cache entry. Server query parameters and pagination are
deferred until measured volume requires them. The default status filter is `active`, defined as
every state except `closed`; all sources remain visible by default.

### Preserve due-date order rather than grouping by template

Templates appear as filter values and source cells. Rows stay globally ordered by `due_at`, so an
overdue action cannot be hidden in a later template section. Closed rows use the same deterministic
order when the user explicitly includes them.

## Risks / Trade-offs

- [Historical rows make the unpaginated list grow] → The summary removes the largest payload; add
  pagination only when production volume demonstrates the need.
- [A related person row is not visible through its own RLS policy] → Return a nullable assignee
  name while retaining `assignee_person_id`; display a neutral fallback rather than fabricate a name.
- [A malformed legacy parent chain cannot resolve a source] → The database parent checks and
  inspection-finding constraints remain authoritative; contract parsing exposes any violation.
- [Changing the list response is an API contract break] → Web and API ship together as one monorepo;
  the detail contract remains stable and all list consumers are updated in this change.

## Migration Plan

Build shared contracts before deploying the API and web from the same revision. No data migration
or rollback migration is required. Rollback consists of deploying the previous application revision.
