## Context

See proposal.md — Why. What shapes the approach:

- A period is a row in `scheduled_inspection`, and the only thing that creates one
  automatically is `OpenPeriodService`, which resolves `currentPeriodStart(now)` and therefore
  only ever writes the month in progress (ADR-005).
- That row is immutable. Migration 0008 grants `UPDATE` on `inspector_id`, `cancelled_at` and
  `cancellation_reason` and nothing else; `template_version_id` in particular can never be
  moved once written (ADR-002/004).
- `GET /inspections/scheduled-inspections` returns every period the session can see, ordered
  `period_start DESC`. `GET /inspections/schedules` returns the rules. Both are already
  fetched by the route; site isolation is RLS, and neither query filters by year.
- `POST /inspections/scheduled-inspections` already exists, is coordinator-only, and accepts
  any `period_start` on the first of a month — including a future one. `apps/web` has no
  client function for it.
- The route was recently reorganised into `apps/web/src/routes/SchedulingRoute/` with
  `presentation.ts` holding the pure logic and `groupByYear` already grouping the existing
  periods by year (`presentation.ts`). This change replaces that grouping rather than adding
  to it.

## Goals / Non-Goals

**Goals:**

- The year is a **projection computed in the client** from two lists it already fetches: the
  rules say what is owed, the periods say what exists.
- The projection is pure and lives in `presentation.ts`, testable without rendering.
- An empty month is an actionable place, not a blank: it is where the coordinator opens the
  period ahead of the job.

**Non-Goals:**

- No new read endpoint and no year parameter on the server. The whole site's periods already
  arrive in one payload for two sites and monthly rules; paginating by year would add a
  round-trip per arrow press to save nothing.
- No change to `OpenPeriodService`, its cron, or its idempotency.
- No storage of "the year being viewed". It is local state, lost on reload, and correctly so.

## Decisions

### The year is projected in the client, not materialised in the database

Alternative considered and rejected: teach the opening job to open twelve months ahead. It
would make the calendar fall out of the existing listing with no client work at all, and it is
the wrong trade for one reason: `template_version_id` freezes the version published *at insert
time* and the row cannot be corrected. Opening January 2027 today binds it to whatever is
published today, and every publication between now and then is silently lost for that
inspection. The freeze is the point of ADR-005, so the fix is not to weaken it but to keep the
automatic path unchanged and let the coordinator — who can see the consequence — choose to pay
it for one specific month.

Second alternative, also rejected: a server-side projection endpoint returning the twelve
slots. It would put a calendar in SQL, where the version freeze and the RLS scope are, and buy
nothing: the client already holds both inputs.

### The rule's owing window comes from `created_at` and `deactivated_at`

`inspection_schedule` has no effective-from column, but it has `created_at` (the row exists in
the table, it is simply not in `inspectionScheduleSchema`). Adding `created_at` to
`SCHEDULE_SELECT`, `ScheduleRow`, `toSchedule` and the Zod schema is the whole server change.

Without it, the projection has to assume every rule owed every month of every year, and
browsing back to 2024 would invent a wall of "missed" months for a plant that had no rule yet.
The window closes symmetrically on `deactivated_at`.

Both are timestamps and the month has to be resolved in `America/Toronto`, the same calendar
`currentPeriodStart` uses — otherwise a rule created at 20:00 on March 31 owes April. The
client cannot import `apps/api/src/inspections/period.ts`, so `civilDate`'s `Intl` one-liner is
reimplemented in `presentation.ts`. It is three lines and copying them is cheaper than a
package; the pair is pinned by a test on that exact boundary case on both sides.

### One entry per rule per owed month, and existing periods win

The projection is built by keying the fetched periods on `(template_id, period_start)` and
walking the twelve months of the year for each rule inside its window. A month with a row shows
the row. A month without one is an `unopened` slot carrying only what it needs to become one:
`site_id`, `template_id`, `period_start`.

Periods that no rule claims — scheduled off-calendar, or left behind by a deactivated rule —
are appended to their month rather than dropped. The projection may only *add* months; a period
that exists is never hidden by a rule that does not explain it. `groupByYear` disappears and
`currentRules` (one row per template) becomes the input that decides which rules to walk.

### `template_version` is not shown on an unopened month, and that is deliberate

An opened period names the version it is frozen to. An unopened one has no version — and must
not display the currently published one, because that is a promise the system does not keep:
if it opens next month, it binds to whatever is published then. The slot says the month is not
opened and nothing more.

## Risks / Trade-offs

- **The coordinator opens a year of periods ahead "to be organised", freezing a stale template
  version across twelve rows that cannot be fixed** → the action is per month, never bulk, and
  the confirmation names the version it is about to freeze. The UI makes the cost visible at
  the moment it is paid; it does not prevent the choice.
- **A missing `created_at` on rules created before this change** → the column is `NOT NULL`
  with `defaultNow()` and has always been written; every existing row has a real value.
- **The whole site's periods in one payload grows without bound** — 12 periods/year/rule, two
  sites → the same payload the route already fetches today, and the year filter is applied
  after. If it ever matters, the fix is a year parameter on the existing endpoint, and the
  projection does not have to change to accept one.
- **The client and the server now each resolve a civil month** → pinned by tests on the DST
  boundary on both sides; ADR-007 forbids the shared package from doing it (`Intl` is fine but
  the ownership is not `packages/forms`').

## Migration Plan

No schema migration. `created_at` is additive on the rule listing: an older client ignores an
unknown field, and `inspectionScheduleSchema` is a `strictObject`, so contracts, api and web
must be built together — which the repo already does (`pnpm -r build` before typecheck).
