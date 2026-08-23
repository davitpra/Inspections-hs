## Context

See proposal.md — Why. What shapes the approach here is that `findingSchema` is a
`z.strictObject`, and that the document it belongs to is stored as JSONB in two tables with
opposite mutability rules:

- `template_draft.document` — the mutable exception declared in migration `0016 §4`; `document`
  is in the `GRANT UPDATE` list rewritten by `0021`.
- `template_version.document` — the published record. No `GRANT UPDATE`, and ADR-002 says the
  engine, not the application, is what forbids rewriting it.

Because the object is strict, dropping the key from the schema is not a no-op for data already
written: a stored document that still names `control_level` stops parsing. `saveDraft` parses the
request body with the draft schema, so an old draft would fail on its next save; the offline field
package parses the published document with `templateDocumentSchema`, so an old published version
would fail on the device.

The prescription shipped one commit ago (`8c2deb4`), so in practice the affected population is
small and, for published versions, expected to be empty. "Expected" is not "verified", which is
what §5 of the tasks is about.

## Goals / Non-Goals

**Goals:**

- One place in the system names a control level, and it is the classification of a real finding.
- No stored draft becomes unsavable.
- If a published document does carry the field, the deploy stops and says so, loudly.

**Non-Goals:**

- Rewriting a published `template_version.document`. If one carries the field, that is a decision
  to take with the record in hand, not something a migration resolves at 3 a.m.
- A transitional schema that accepts-and-ignores `control_level`. See Decisions.
- Anything about `finding_risk_assessment`, `riskAssessmentRequestSchema`, the `finding.classified`
  outbox payload, or the `CONTROL_LEVELS` enum itself. They stay exactly as they are.

## Decisions

**The key is refused, not ignored.** The alternative was to relax `findingSchema` to a loose
object so an old `control_level` would be tolerated and dropped on the next write. Rejected: a
document that still names a level would then round-trip through the editor silently losing it,
and for a while two answers to "what control level does this failure deserve" would exist in the
record — one dead, one live. `strictObject` turning it into an outright rejection is the property
that makes the migration mandatory instead of optional, which is the correct pressure.

**`control_level` leaves the block; `CONTROL_LEVELS` does not leave the package.** The enum stays
in `packages/forms/src/document/controls.ts` and stays re-exported through `@hs/contracts`. The
previous change moved it there precisely because `contracts` depends on `forms` and not the other
way round; the risk assessment still needs it, and moving it back would be a second churn for no
gain. `controls.ts` keeps its name and its comment about the hierarchy — what changes is only that
the document no longer names one.

**The migration rewrites arrays with ordinality.** `position` is derived from array order
(requirement "The order of a draft is the order of its elements"), so the rebuild of
`sections`/`items` must preserve order explicitly: `jsonb_array_elements(...) WITH ORDINALITY` and
`jsonb_agg(... ORDER BY ord)`. An unordered `jsonb_agg` would be a silent reordering of somebody's
checklist, which is the worst possible outcome of a cleanup migration.

**The migration does not touch `updated_at`.** The column means "when the author last edited this
draft". A schema repair is not an edit, and bumping it would make every draft in the plant look
freshly worked on.

**The preflight raises, it does not warn.** `RAISE EXCEPTION` inside a `DO` block aborts the
migration and therefore the deploy. A `RAISE NOTICE` would be read by nobody.

**Detection uses `jsonb_path_exists`, not a `LIKE` on the text.** `$.sections[*].items[*].finding.control_level`
says what is actually being looked for; a substring match would also fire on a corrective action
that happens to contain the words.

## Risks / Trade-offs

- **A published version carries the field** → the migration aborts and the deploy fails. That is
  the designed behaviour, not a failure mode, but it means this change cannot be deployed blind:
  run the preflight query against production first. Resolution, if it fires, is a decision between
  amending ADR-002's immutability for one row and keeping a legacy-tolerant published schema — and
  it belongs to the person holding the record, not to this document.
- **A device holds a cached field package built from an old published document** → after this
  change its `templateDocumentSchema` parse fails. Same population as above (expected empty), and
  the resolution is the same: if the preflight is clean, no such package exists.
- **A draft open in a browser tab while the migration runs** → its next save sends the old shape
  and is rejected with a validation error. ADR-001 already accepts losing drafts, and the editor
  keeps what was typed on screen (`saveErrorNotice`). Reloading the page fixes it.
- **A stored document reaches a client whose schema no longer knows one of its keys** → the draft
  becomes unopenable, not merely unsavable, and the only repair is SQL. This is the risk that
  decides the order of the migration plan, and it is worth stating precisely because it is
  asymmetric with the write path that this codebase is designed around.

  The read of a draft is not validated on the server (`templates.controller.ts`, `GET
  /templates/drafts/:id`, returns the row unparsed). It is validated in the browser:
  `apps/web/src/api/templates.ts` parses the response with `templateDraftSchema`, which carries
  `document: templateDraftDocumentSchema`. Because `findingSchema` is a `strictObject`, one
  unknown key on one item fails the parse of the whole document, the route never mounts, and the
  author is left with nothing — no document, no name, no way to reach the item that carries the
  key. The interface that could delete that item lives behind the screen that will not open.

  Compare with a rejected save, which is the case the code was designed for: the editor stays on
  screen with everything the author typed, and `saveErrorNotice` says so explicitly. A rejected
  read has no such affordance, and none can be added from inside the route.

  This change does not hit the risk, because `0024` strips the key from every stored draft before
  the new client is served. That is the whole reason the migration precedes the deploy — a
  stronger reason than the one the Migration Plan gives on its own. **Any future change that
  retires a field from the document schema inherits this**: without the data migration going
  first, the affected drafts are not merely unsavable, they are unreachable, and the fix runs
  against production by hand.

  Observed, not hypothesised: during verification a draft in the development database carried a
  `finding.severity` — a key `findingSchema` never had in any committed version, left by a manual
  experiment — and that single key made the template screen fail to open with exactly this error.
  Removing it required an UPDATE of the same shape as §2 of the migration.

## Migration Plan

1. Run the preflight query against the target database before deploying — it is the same predicate
   the migration uses. If it returns anything, stop; this change does not deploy today.
2. Deploy `0024`: it aborts if any published document carries the field, then strips the key from
   every stored draft document.
3. Deploy the application. Never before step 2: a client whose schema has already lost the key,
   reading a document that still carries it, cannot open the draft at all (see Risks). Old and new
   code cannot both be live against the same database for the drafts feature either — old code
   writes `control_level` and the new schema refuses it — but this is a single-instance
   deployment, so the window is the restart.

**Rollback**: the migration is not reversible in the sense of restoring the stripped values, and
it does not need to be — those values were never chosen by anyone. Rolling the application back
means old code writes drafts carrying `control_level` again, which the new schema will refuse
after the next roll-forward; re-running `0024` cleans them.
