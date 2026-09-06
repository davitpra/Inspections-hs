## Context

See `proposal.md` for the motivation. Migration `0036` added `scheduled_inspection.visible_early` as an insert-only decision; the pending query already treats it as the override that exposes a future assignment. This change touches the immutable `scheduled_inspection` table and therefore must preserve the engine-enforced model of ADR-002 and ADR-004.

The HTTP path remains `controller → service → database` under ADR-008. The route already keeps dialog state above period rows because row state can change after a mutation.

## Goals / Non-Goals

**Goals:**

- Represent making a future assignment visible as one explicit, irreversible operation.
- Enforce monotonicity, closed-record protection and site isolation in PostgreSQL.
- Keep the confirmation and any request failure attached to the selected period.

**Non-Goals:**

- Hiding an inspection after it becomes visible.
- Making unassigned periods appear in any pending list.
- Changing the automatic period-opening job or the normal date-based visibility rule.

## Decisions

### Use an action endpoint without a boolean body

`POST /scheduled-inspections/:id/make-visible` expresses the only legal transition. A generic visibility patch would expose `false` as an apparent supported value and make the irreversible contract less clear. The response reuses `ScheduledInspection`.

### Grant one update column and guard the transition in PostgreSQL

A new migration grants `UPDATE (visible_early)` to `hs_app` and replaces `hs_scheduling_guard()` with branches that reject `true → false`, cancelled rows and rows with an accepted submission. RLS remains unchanged and supplies site isolation. This follows ADR-002 and ADR-004 rather than relying on the service's eligibility checks.

### Restrict the operation to an assigned future period

The service checks the current Ontario civil month, assignment, cancellation and completion before writing. The database independently protects the irreversible and historical constraints. Assignment is required because setting the flag on an unassigned row would still leave it invisible and would make the UI claim an effect that did not occur.

### Audit the transition in the existing trigger

The migration adds an `inspection.visibility_advanced` branch to `hs_scheduled_inspection_audit()`. Audit remains coupled to the persisted change, so failed requests cannot produce false history.

### Keep confirmation at route scope

`RequirementPeriodRow` contributes the menu action, while `ScheduleRequirementRoute` owns the selected entry and renders `MakeVisibleDialog`. On success the dialog invalidates scheduled and pending queries; on failure it remains open and names the server error.

## Risks / Trade-offs

- [The guard function is replaced as a whole and can omit a previous branch] → Base the migration on the latest definitions from `0030`, `0036` and subsequent migrations, then cover version advancement, cancellation and visibility in integration tests.
- [An inspector may download the package immediately and work offline] → Make the transition irreversible and require explicit confirmation.
- [UI and server clocks could cross a month boundary] → Treat the server as authoritative; retain its rejection in the dialog and refresh only after success.

## Migration Plan

1. Deploy the SQL migration before the API that invokes the new update.
2. Deploy contracts, API and web together.
3. Rollback application code by removing the endpoint and UI action; leave the monotonic database permission and audit history in place rather than attempting to erase persisted facts.
