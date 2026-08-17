## Why

The inspector's home screen answers "what do I owe this month?" and then, below the fold,
answers a question nobody asked: it repeats the coordinator's year calendar — year arrows, a
grid/list toggle, a card per pending month and a stats bar — on a screen whose reader owns one
assignment at a time. The two questions an inspector actually has next are "what comes after
this one?" and "what did I already close?", and the screen answers neither: it cannot name a
completion date and it cannot show a past inspection, because the server exposes neither.

This change closes **no etapa of §7** — etapas 0 through 7 are archived and only etapa 8, the
visual builder, remains. It exists because the shipped screen diverged from the design it was
built against (`docs/mock/inspeccion sin asignacion mensual desktop.png`) in the one place the
divergence is load-bearing: `apps/web/src/routes/PendingRoute/RecentInspections.tsx` carries a
comment naming the gap — *"Sin fecha de cierre ni link al reporte: el servidor no expone
ninguna de las dos todavía"* — and this is the change that closes the first half of it.

## What Changes

- A listed scheduled inspection carries **`inspection_id`** and **`completed_at`** when it has
  been submitted. Both are projections of the `LEFT JOIN inspection` the listing query already
  performs to derive `status`; `completed_at` is `inspection.signed_at`.
- The inspector's home replaces the year calendar with two cards: the **next assignment** —
  the month, site, inspector and when it opens — and **recent inspections**, a table of what
  this account has completed, each row dated by its completion.
- An inspector can open **any assignment read-only**, including one whose field package is not
  on the device: the questions and the frozen template are shown, nothing is answered, and no
  draft is created.
- A new screen lists **every** inspection this account has completed, not just the last three.
- **Not** changing: the opening job, the field package endpoints, the submission ingestion, or
  any write path. Every server change here is a `SELECT` projection over columns that already
  exist.

## Lo que este change NO es

- **It is not the per-inspection report.** Every row of the recent-inspections table carries a
  "View report" affordance that is deliberately **inert** in this change — it is drawn and
  disabled, so the table matches the design without promising a screen that does not exist.
  Reading a submitted inspection's answers back from the server is its own change, and it is
  the one that has to decide about photo access.
- **It is not an offline archive.** The completed list and the read-only preview both read
  from the server. ADR-010 budgets the device for in-flight work on a 7-day assumption, not
  for accumulating closed inspections.
- **It is not a template viewer.** The read-only preview is scoped to an inspection this
  account is assigned; it is not a way to browse templates, which is etapa 8.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inspections`: a listed scheduled inspection must say **when** it was completed and not only
  **that** it was, so a reader can date the record without a second request. The listing
  surface for an inspector gains two obligations it did not have: naming the next assignment
  before it opens, and listing what the account has completed.
- `offline-capture`: the capture screen refuses to start on a device that is not field-ready,
  and that requirement stands. It gains a bounded exception: an assignment may be **previewed**
  read-only, which is not capture — it creates no draft, writes nothing to the device, and
  therefore does not need the field package at all.

## Impact

- `packages/contracts/src/inspections.ts`: two nullable fields on `scheduledInspectionSchema`.
  It is a `strictObject`, so contracts, api and web build together — which the repo already
  does (`pnpm -r build` before typecheck).
- `apps/api/src/inspections/inspections.service.ts`: two columns on `SCHEDULED_SELECT` and two
  lines in `toScheduled`. **No migration**: `hs_app` already holds `SELECT` on `inspection`
  (migration 0009) and `hs_apply_site_isolation` is already applied to it.
- `apps/web/src/routes/PendingRoute/`: the year section, its toolbar, its stats bar and
  `PendingRow.tsx` are removed; `RecentInspections.tsx` is rewritten as a table and moves out
  of the aside; `NoAssignment.tsx` loses its duplicated next-assignment block; a new
  `NextAssignment.tsx`.
- `apps/web/src/routes/CaptureRoute/`: a preview mode, in its own subcomponent.
- `apps/web/src/routes/PastInspectionsRoute/`: new.
- ADR-001 (one owner, one device), ADR-002/004 (immutability and RLS) and ADR-010 (the device
  storage budget) constrain the design and are not modified.
