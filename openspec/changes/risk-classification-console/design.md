## Context

See `proposal.md` — Why. What follows is only the state that shapes the approach.

The server side of etapa 4 is finished and closed. `FindingsController` exposes four routes
without a prefix; `FindingsService` holds the raw SQL, and every read goes through one shared
constant, `FINDING_SELECT`, used by `list`, `get`, `readOne` and `findingsForInspection`. The
current assessment is resolved there with a `LEFT JOIN LATERAL` over the row nothing supersedes,
so `assessment: null` means *never classified* and is not a stored status (D10 of the archived
design). `risk_level` is a generated column fed by the `IMMUTABLE` function `hs_risk_level`, and
the same matrix is written a second time in `apps/api/src/findings/risk.ts` with its 25 cells
under test (D5).

On the client, `apps/web` has never called any of it. What it does have is a settled shape for a
screen, and this change is mostly an instance of it: `api/<domain>.ts` with `parse` mandatory,
`queryKeys` in one file, `permissions/` for who is offered what, `presentation/` for what things
are called, one folder per route with a pure `presentation.ts` beside it, and `nav-items.ts` as
the single source of both the desktop tabs and the phone sheet.

Two constraints bound the design from outside. **ADR-008**: layers stay thin and `findings`
calls no other module — the location name has to come from the query, not from a call into
`catalog`. **ADR-002 / ADR-004**: immutability is the engine's, and nothing here writes, so this
change carries no migration at all.

## Goals / Non-Goals

**Goals:**

- Make an unclassified finding visible to the person who can classify it, and classifiable in
  one screen.
- Keep the recorded `risk_level` the engine's, while showing the coordinator what the pair
  produces before the append-only row exists.
- Resolve the location's name without publishing a catalogue endpoint.

**Non-Goals:**

- No read presign, no photo rendering. The photo count and the existing notice are the whole of
  it.
- No `GET /locations`. The name travels attached to the finding it belongs to and nowhere else.
- No offline behaviour. This is a console screen: it reads from the server, it fails when there
  is no network, and that is correct — ADR-001 budgets the device for capture in flight, not for
  the coordinator's backlog.
- No filter by site, origin or date. The default filter is `unclassified` and the escape hatch is
  `all`; anything more is a report, and reports are `reporting`.

## Decisions

### D1 — `location_name` is a column of `FINDING_SELECT`, not a call into `catalog`

The read gains `l.name AS location_name` and a `JOIN location l ON l.id = f.location_id AND
l.site_id = f.site_id`. It is an inner join and not a left one: `finding.location_id` is `NOT
NULL` with a composite foreign key against `(site_id, id)`, so a finding without a location
cannot exist and a `LEFT JOIN` would only invite a nullable field nothing can produce.

*Alternative considered — a `GET /locations` catalogue endpoint*, with the client resolving names
itself. Rejected: it is a second request and a second cache for a field that is already being
read, and it would publish the full catalogue of a site to answer a question about four findings.
Locations are served hanging off a scheduled inspection today precisely because nothing needed
them standalone; that is still true.

*Alternative considered — `findings` calling a `catalog` service.* Rejected by ADR-008: the
dependency direction is one-way and this would be `findings` calling out. A join inside the
module's own query is not a module dependency.

The join is added once, to the shared constant, so `findingsForInspection` gains the name too —
which is what lets `InspectionReportRoute` name the location without a second change.

### D2 — The risk level the form shows is a preview, and the matrix is duplicated a third time

`FindingRoute/presentation.ts` gets `previewRiskLevel(probability, severity)`, deriving the 1..5
indices from `PROBABILITIES.indexOf` and `SEVERITIES.indexOf` — the order of those lists **is**
the scale, which `packages/contracts/src/findings.ts` already states — and applying the same cuts
at 4, 9 and 14.

This is a third copy of a table that already exists in SQL and in TypeScript, and D5 of the
archived design accepted the second copy on the condition that a test compares them. The same
condition applies here: `presentation.test.ts` replicates the 25 cells of
`apps/api/src/findings/risk.spec.ts`, which is what keeps the three from drifting apart in
silence.

*Alternative considered — asking the server for the level.* Rejected: it would be a request per
keystroke on a `<select>`, and there is no endpoint that computes a level without recording one —
adding one would mean adding a write-shaped route that writes nothing.

*Alternative considered — showing nothing until saved.* Rejected: the matrix is the judgement
being made. A coordinator choosing `likely` and `major` is deciding this is critical, and
learning that only after an immutable row exists turns a correction into a reclassification with
a written reason.

The preview never travels. `riskAssessmentRequestSchema` is a `strictObject` without
`risk_level`, so a client that tried to send it would be rejected by the parse before reaching
the generated column.

### D3 — Two route folders, not one with a mode

`FindingsRoute/` (the list) and `FindingRoute/` (one finding). CLAUDE.md's rule is one folder per
route with no exception for size, and the two answer different questions with different data:
`GET /findings` and `GET /findings/:id`, different cache keys, different invalidation. A single
folder branching on a param would put a list's ordering rules and a form's validation rules in
one `presentation.ts`, which is exactly the file that is supposed to be pure and small.

`RiskBadge` goes to `src/components/` from the start, because both folders render it — the same
reason `StateBadge` and `SitePicker` are there, and their comments say so.

### D4 — Ordering and filtering are pure functions, not a `.sort()` in the JSX

`byUrgency`, `visibleFindings` and `tally` live in `FindingsRoute/presentation.ts` with their
tests. The ordering rule — unclassified first, then `risk_level` descending, then `recorded_at`
descending — is the reason the screen is useful, and it is the kind of rule that gets quietly
broken by a later edit if it only exists inside a `map`.

Ordering happens on the client and not in the query. `GET /findings` returns the site's findings
ordered by `recorded_at DESC` and there is no pagination; at two sites and this volume the list
is small, and pushing the order into SQL would mean a query parameter, a spec requirement about
it, and a server that has an opinion about which screen is asking.

### D5 — The role gates the form, not the read

`canClassifyFinding` joins the four predicates in `permissions/session.ts` as a fifth, rather
than reusing one of them. The file's own comment explains why they are separate: they ask
different questions and happen to agree today.

The read is not gated at all. `FindingsService.list` checks no role and RLS already narrows the
rows, so the nav entry is unconditional. This is the `/scheduling` side of the split that
`nav-items.ts` documents, not the `/roster` side: there is nothing in a finding that a JHSC
member of that site should not see — they may well be the one who described it.

### D6 — The 409 is presented as a state of the finding, not as an error string

`request.ts` throws `Error` with the server's message and drops the `code` on purpose, so
`already_reclassified` arrives as text. The form matches on the mutation's error to show a notice
and refetches the finding, so what the reader ends up looking at is the classification that is
now current — which is the thing they need in order to decide whether they still want to replace
it.

This is the only place the dropped `code` costs anything, and it is not worth changing
`request.ts` for one screen: the message is server-authored and stable, and the recovery — refetch
and re-present — is correct for any conflict on this route.

## Risks / Trade-offs

- **A third copy of the risk matrix.** → The 25-cell test in `FindingRoute/presentation.test.ts`
  mirrors `risk.spec.ts`, and the file carries a comment saying it paints a number while
  `hs_risk_level` records one. The failure mode without it is the worst kind: a screen that
  promises `high` and stores `critical`.
- **The preview could be read as the record.** → It is rendered as the same `RiskBadge` the
  saved classification uses, which is deliberate — the point is that it is the same level — so
  the form labels it as what will be recorded and the saved classification is presented
  separately, with its `assessed_at`.
- **Ordering on the client does not scale.** → True, and bounded: 2 sites, one coordinator, a
  handful of findings per inspection. When it stops being true the fix is a query parameter and a
  spec requirement, and the pure function is what makes that a move rather than a rewrite.
- **A finding whose location was deactivated still shows its name.** → Intended, and now
  specified. The alternative — hiding it — would make older records less legible than newer ones.
- **Photos are still counted and not shown.** → The screen says so in the same words
  `InspectionReportRoute` uses. A record that does not declare the evidence it holds reads as a
  record that holds none, so the notice is not optional.
- **The list is server-only and fails offline.** → Correct for this reader. The coordinator
  classifies at a desk; the device budget is for capture in flight (ADR-001, ADR-010).

## Migration Plan

None. **No migration file, no schema change, no immutable table touched.** `hs_app` already holds
`SELECT` on `location` and `hs_apply_site_isolation` is already applied to it, so the new join
returns rows under the same policies as the finding it hangs off — a location outside the
session's scope cannot be reached through it.

Deployment is the ordinary one: `packages/contracts` gains a field, and because `findingSchema`
is a `strictObject`, an api that returns the field to a web build that does not know it would be
rejected by the client's parse. The two ship together, which the repo already enforces —
`pnpm -r build` before typecheck, and CI does the same.

Rollback is reverting the commit. There is nothing to undo in the database.
