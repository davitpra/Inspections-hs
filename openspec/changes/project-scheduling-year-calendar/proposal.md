## Why

The scheduling console can only show a period that already exists as a `scheduled_inspection`
row, and the opening job only ever creates the **current** month. A coordinator opening the
console in August sees the handful of months the job has opened so far, with no way to look at
the rest of the year, at next year, or at what the site will owe — which is precisely the
question the console exists to answer. The obligation is known a year in advance (it is a
monthly rule), but the screen can only describe the past.

Etapa 7 de §7 (recurrencia y cumplimiento). It closes the planning half of the scheduling
console: the automatic opening and the assignment of an open period already work, but the
coordinator still cannot see or plan a period the job has not reached yet.

## What Changes

- The scheduled inspections section becomes a **year calendar**: twelve month slots per
  active schedule rule, for one year at a time, navigable backwards and forwards.
- A slot the job (or the coordinator) has already opened shows the real inspection — its
  status and its inspector — exactly as today. A slot with no row is shown as an explicit
  gap, not omitted: the site owes that month, it simply has not been opened yet.
- The coordinator can open a future month from its gap, on demand, and assign an inspector to
  it — using the existing `POST /inspections/scheduled-inspections`, which the web client does
  not currently call at all.
- **Not** changing: the opening job keeps opening only the current month. Materialising a
  future period stays an explicit coordinator action, never an automatic one (see design).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inspections`: the scheduling surface must describe the periods a site owes for a whole
  year, including the months no row exists for yet, and must distinguish a period that has
  not been opened from one that was never owed or was cancelled. Scheduling outside the
  automatic calendar gains a stated purpose — planning a future month — and with it the
  requirement that a period opened ahead of the job is indistinguishable from one the job
  opened, and does not cause the job to open a second one.

## Impact

- `apps/web/src/routes/SchedulingRoute/`: `PeriodsSection.tsx`, `presentation.ts` and their
  tests; a new subcomponent for the empty slot and its "schedule this month" action.
- `apps/web/src/api/inspections.ts`: expose the existing create endpoint.
- `apps/api`: no schema migration, no job change. Server work only if the year projection
  needs a field the listing does not already return.
- ADR-005 (opening and version freezing) and ADR-002/004 (immutability) constrain the design
  and are not modified.
