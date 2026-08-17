## Context

See proposal.md — Why. What shapes the approach:

- `SCHEDULED_SELECT` (`apps/api/src/inspections/inspections.service.ts`) already carries
  `LEFT JOIN inspection insp`, because `periodStatusCase` derives `'completed'` from
  `insp.id IS NOT NULL`. The join exists; only the projection is missing.
- `inspection` holds two timestamps: `signed_at` (the device clock at signing) and
  `received_at` (the server clock at ingest). `apps/api/src/reporting/compliance.sql.ts`
  already aliases `signed_at` as `occurred_at`, and `submissions.service.ts` uses it as
  `finding.occurred_at`.
- `inspection` is immutable (ADR-002/004): migration 0009 runs `hs_make_immutable` and
  `hs_apply_site_isolation` on it, and grants `SELECT, INSERT` to `hs_app`. Reading it needs
  no DDL and no policy change.
- `findActiveInspection` (`apps/api/src/inspections/active-inspection.ts`) filters on
  `cancelled_at IS NULL` and nothing else — no period date — so
  `GET /scheduled-inspections/:id/template-version` already answers for a month that has not
  opened yet.
- `CaptureRoute` already has a read-only mode (`readOnly = row.status === 'accepted'`), which
  `ItemRow` applies as `<fieldset disabled>`. What it does not have is a path that reaches the
  document without a draft: today it runs `openDraft` before it renders anything.
- `packages/forms` exposes `sectionsInDocumentOrder(document)`, which walks a template with no
  answer state at all.

## Goals / Non-Goals

**Goals:**

- The completion date is a **projection**, not a new column and not a second request.
- The read-only preview is provably **inert**: it must be impossible for opening it to change
  what the home screen says about that assignment.
- Every screen change is composition; the pure decisions stay in `presentation.ts` with tests
  that do not render.

**Non-Goals:**

- No endpoint that returns a submitted inspection's answers. That is the next change.
- No new listing endpoint for completed inspections. `GET /scheduled-inspections` already
  returns them, the web client already filters them (`recentCompleted`), and adding a second
  query to serve the same rows would be two definitions of "completed" instead of one.
- No offline availability for the preview or the completed list.

## Decisions

### `completed_at` is `signed_at`, not `received_at`

The two differ by however long the device stayed offline — up to the seven days ADR-010
budgets. Dating the record by `received_at` would put an inspection walked and signed on
March 29 into April if the plant had no signal until then, and the month is what identifies
the obligation to a regulator. `signed_at` is also the instant the rest of the system already
treats as when the inspection happened: `compliance.sql.ts` calls it `occurred_at`, and every
finding derived from the submission inherits it.

The cost is that `signed_at` is a **device clock**, and a device with a wrong clock produces a
wrong date. That is not new — it is the clock the compliance report already runs on — and the
alternative trades a rare wrong clock for a systematic wrong month. The schema comment says so
out loud, because a reader who does not know this will assume it is a server timestamp.

### Both fields are nullable, and the null is the common case

`LEFT JOIN` yields null for every period that has not been submitted, which is most of them.
Modelling them as optional instead of nullable would make "absent" and "not completed"
different states for the same fact; `scheduledInspectionSchema` is a `strictObject` and every
other conditional field on it (`inspector_id`, `cancelled_at`) is already nullable.

`inspection_id` ships now even though nothing reads it yet: it is the handle the report change
needs, it costs one column on a join that already runs, and adding it later would be a second
contract break for the same query.

### The preview is a search parameter on the capture route, not a route of its own

`/inspections/$id/capture?preview=1`. A separate path would duplicate the `$id` resolution and
split "the screen that shows this inspection's questions" across two folders for a difference
that is a mode, not a resource. The parameter is validated (`z.literal('1').optional()`), so a
hand-typed value either means preview or is ignored.

**The branch is taken before anything else runs** — before the field-package query, before
`findDraft`, before `openDraft`. That ordering is the whole guarantee: the preview cannot
create a draft because the code that creates drafts is not on its path. The alternative,
threading a `readOnly` flag down through the existing loaders, would leave `openDraft` one
early-return away from running on a month that has not opened, and ADR-001's "one owner, one
device" is not something to protect with an `if` in the middle of a query function.

This does not weaken the offline-capture requirement that capture is refused on a device that
is not field-ready. The preview is not capture: it answers nothing, saves nothing, and signs
nothing. The spec delta says so explicitly rather than leaving the exception implied.

### The preview shows every item, including the conditional ones

`evaluateVisibility(document, {})` hides every item behind a `visible_when`, because nothing
has been answered. Rendering that would tell an inspector the walk is shorter than it is —
precisely the wrong lie for someone deciding whether they have time to do it today. So the
preview walks `sectionsInDocumentOrder` unfiltered.

It does **not** mark which items are conditional. Marking them is more honest still, but it
needs a vocabulary for "only if" that does not exist and would be invented here for one
screen; showing the full set is the better of the two available answers, and the narrower one
can be added without changing what this screen means.

### The preview reads the document online when the device does not have it

`storedTemplateVersion(id)` first, then `GET /scheduled-inspections/:id/template-version`. The
point of the preview is an assignment that has not been downloaded — usually a future month —
so the stored copy is normally absent.

Rejected: having the preview call `prefetchInspection` and keep what it fetched. It would make
the next month field-ready as a side effect of looking at it, which changes what "Ready for
the field" means on the home screen — the inspector would have downloaded a package by
reading, and the screen would report a readiness nobody chose. Downloading stays an explicit
act with its own button.

The consequence is that the preview needs a connection. It is the one screen in the inspector's
flow that does, and it says so when it cannot load; every screen that must work offline still
does.

### The year calendar goes, and the pending months it reached go with it

`focusedAssignment` already picks what matters now — the oldest overdue, else the current
month — and the grid existed to reach the rest. Removing it means a second overdue month is
not reachable until the first is closed.

This is accepted rather than mitigated. The screen is for an inspector who owns one assignment
at a time (ADR-001); the coordinator's console is where the year is planned, and it keeps its
calendar. A backlog of three overdue months is a scheduling problem that a grid on the
inspector's phone does not solve — it only makes it possible to work them out of order, which
is the opposite of what "the oldest overdue first" is for.

## Risks / Trade-offs

- **A device with a wrong clock dates a completed inspection wrongly** → accepted, and not new:
  `signed_at` is already the clock the compliance report and every derived finding run on.
  Changing it is a change about clocks, not about this screen.
- **The preview creates a draft through some path not considered** → the branch is taken before
  any draft code runs, and a test asserts that opening the preview leaves the Dexie `drafts`
  table untouched. That test is the requirement, not a nicety.
- **`scheduledInspectionSchema` is a `strictObject`, so a stale client rejects the new fields**
  → the repo builds contracts, api and web together and ships them together; the same
  constraint applied to `created_at` in the year-calendar change.
- **The completed list grows unbounded on one payload** → 12 rows/year/rule over two sites,
  filtered client-side from a listing the home screen already fetches and caches under the same
  key. If it ever matters, the fix is a parameter on the existing endpoint.

## Immutable tables

This change touches `inspection` — an immutable table — **with `SELECT` only**. No `INSERT`,
no `UPDATE`, no `DELETE`, no DDL, no policy change, no `GRANT`. Site isolation stays with the
RLS policy `hs_apply_site_isolation` installed by migration 0009 and reached through
`DbService.withSessionClient`; no endpoint in this change filters by `site_id` (ADR-002/004).

## Migration Plan

No schema migration. The two new fields are additive projections of existing columns. Build
order is the repo's usual one: `pnpm -r build` before `pnpm typecheck`, because `apps/web` and
`apps/api` consume `@hs/contracts` through its built `dist`.
