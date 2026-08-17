# Risk classification console

## Why

Etapa 4 shipped the engine and left the console empty. `finding`, `finding_photo` and
`finding_risk_assessment` exist, the risk matrix is written twice and compared cell by cell,
`FindingsService.classify` checks the coordinator's role, and four endpoints answer:
`GET /findings`, `GET /findings/:id`, `POST /findings` and `POST /findings/:id/risk-assessments`.

**Nothing in `apps/web` calls any of them.** There is no `api/findings.ts`, no query key, no
route, no menu entry. A finding derived from an accepted submission is born unclassified and
there is no screen from which the HS coordinator can classify it, so R2 of §3 stops one step
short of the state that etapa 5 consumes: `actions` derives a corrective action's due date from
the finding's **severity**, and a finding nobody could classify has none.

This change closes **no new etapa**: it closes the console half of **etapa 4**, whose server was
archived in `2026-08-10-findings-and-risk-classification`. It also completes task 10.1 of that
change — the end-to-end verification of R2 — which is the one item its `tasks.md` left unchecked,
because there was no screen to verify it from.

## Lo que este change NO es

- **It is not the manual finding.** `POST /findings` stays without a caller. Reporting a hazard
  seen outside an inspection needs a site picker, a location catalogue, an upload flow and a
  classification in one screen; it is a capture problem, not a classification problem, and
  bundling it would hide the screen this change is actually for.
- **It is not photo viewing.** A finding's photos are stored as object keys and `uploads` only
  presigns `PUT`. The screen **counts** the photos and says so, exactly as
  `InspectionReportRoute` already does. Reading them back is its own change and it has to decide
  about expiry and prefix authorization.
- **It is not a location catalogue.** There is no `GET /locations` and this change does not add
  one. The finding is read with its location's name attached, which is the whole of what the
  screen needs.
- **It is not a second risk matrix.** The level the form shows while the coordinator picks is a
  **preview**. The value that gets recorded is still computed by the `hs_risk_level` generated
  column, and `risk_level` still never travels in a request (D5 of the archived design).

## What Changes

- **A new `/findings` screen** lists the findings within the reader's site scope, filtered by
  default to the unclassified ones and ordered by urgency: unclassified first, then by risk level
  descending. The filter defaults that way because the screen exists to answer "what is waiting
  for me", and a list that opens on everything answers it only after the reader sorts it.
- **A new `/findings/$id` screen** shows the finding — description, location, origin, dual
  identity when it has one, dates, recurrence mark, photo count — and, for the HS coordinator,
  the classification form: probability, severity and control level, with the resulting risk level
  shown before saving.
- **Reclassifying uses the same form and the same endpoint.** When a current assessment exists,
  the form requires the reason the migration's `CHECK` already requires, and the `409
  already_reclassified` that a concurrent classification produces is shown as a readable notice
  instead of a raw error.
- **The form is the coordinator's; the list is everyone's.** `FindingsService.list` checks no
  role and RLS already narrows what a reader sees, so the menu entry is unconditional and only
  the form is gated — the same split `/scheduling` already makes, and for the same reason.
- **A finding is read with its location's display name.** The only server-visible change: the
  read gains `location_name`, so a reader is not handed a uuid for the one field that says
  *where*.
- **The inspection report links to the finding.** Each finding block in `InspectionReportRoute`
  gains its risk level and a link, so the classification is reachable from the record that
  produced it and not only from the menu.

## Capabilities

### New Capabilities

None. The console reads and writes through the surface `findings` already specifies.

### Modified Capabilities

- `findings`: a finding is read with the display name of its location and not only its
  identifier; and the capability gains the console obligations it never had — what the list
  presents first, that the risk level of a pair is visible before it is recorded, that replacing
  a classification states its reason and that a concurrent replacement is reported as one, and
  who is offered the form. No existing requirement changes: this change adds a projection to the
  read and no new write, state or rule.

## Impact

- **No migration.** No immutable table is touched: `hs_app` already holds `SELECT` on `location`
  and `hs_apply_site_isolation` is already applied to it (ADR-002 / ADR-004). The server change
  is one `JOIN` inside an existing `SELECT`.
- `packages/contracts/src/findings.ts`: `location_name` on `findingSchema`. It is a
  `strictObject`, so contracts, api and web build together — which the repo already does
  (`pnpm -r build` before typecheck).
- `apps/api/src/findings/findings.service.ts`: `FINDING_SELECT` gains the join and the column,
  and it is shared by `list`, `get`, `readOne` and `findingsForInspection`, so all four reads
  gain the name at once. ADR-008 stands: `findings` still calls no other module.
- `apps/web`: new `api/findings.ts`, two query keys, `canClassifyFinding` in `permissions/`,
  `presentation/findings.ts` for the label tables, a shared `RiskBadge`, and two route folders —
  `FindingsRoute/` and `FindingRoute/`.
- `apps/web/src/app/`: one entry in `NAV_ITEMS`, two in `TITLES`, one route pair in `router.tsx`.
- `apps/web/src/index.css`: the risk pill classes, built from the existing semantic tokens —
  `check-tokens.mjs` fails the build on a literal colour.
- **Unblocked**: nothing new depends on this, but etapa 5's premise — that a corrective action
  hangs off a **classified** finding — becomes reachable through the interface for the first
  time.
