## Why

The scheduling console renders every owed period as a full card with its own form, so a year with
several requirements becomes a wall of repeated selectors and actions instead of an annual plan.
The frequency work completed after the original year calendar also made monthly wording, summary
counts and the relationship between requirements and periods misleading for quarterly,
semiannual and annual schedules.

This change does not close a new stage of requisitos-v1.2 §7. It corrects and makes usable the
scheduling and compliance-planning surface delivered for stage 7: the underlying recurrence,
opening, assignment and cancellation behavior already exists, but the coordinator cannot scan or
operate it reliably as one annual schedule.

## What Changes

- Replace the repeated period-card grid with an annual schedule workspace: a requirement-by-month
  matrix on larger screens and a genuinely compact operational list, with the list as the default
  on small screens.
- Open one focused period dialog from a matrix cell or list row for assignment, early opening,
  cancellation or rescheduling instead of rendering a form in every projected period.
- Present inspection requirements as compact rows and move creation, default-inspector changes and
  deactivation into focused dialogs. Creating a requirement can name its optional default inspector
  in the same operation and previews the resulting annual cadence before confirmation.
- Add year-scoped summary filters for completed, missed, unassigned and unopened work. The
  unassigned notice refers only to the visible year, and cancelled periods are no longer described
  or counted as assigned.
- Distinguish failures to load templates or inspector candidates from legitimate empty lists, and
  prevent an operation whose supporting data could not be loaded.
- Correct monthly-only copy so all labels describe periods and requirements accurately for the
  supported frequencies.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `inspections`: the scheduling surface gains an annual matrix/list presentation, year-scoped
  operational summaries and filters, focused requirement and period operations, creation with an
  optional default inspector, and explicit supporting-data failure states.

## Impact

- `apps/web/src/routes/SchedulingRoute/`: route composition, requirement management, annual
  projection presentation, period operations and route/presentation tests.
- `apps/web/src/index.css`: scheduling workspace, matrix, compact list, dialogs, responsive layout
  and semantic status presentation.
- Existing web API functions and contracts are reused. `CreateInspectionSchedule` already accepts
  `default_inspector_id`; no endpoint or contract change is required.
- No database schema, migration, RLS policy, job or immutable-table permission changes.
- ADR-002/ADR-004 continue to constrain immutable schedule and period fields; ADR-005 continues to
  constrain period opening and template-version freezing.
