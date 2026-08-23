# Design — Published templates in the template console

## Context

See `proposal.md` — Why. What shapes the approach is that everything this screen needs already
exists: `GET /templates` resolves the published templates through `LATEST_PUBLISHED_VERSION_CTE`,
`/templates` is already the coordinator-only console, and `publish-template-draft` already
invalidates the `templates()` query key on publication precisely so a screen like this can react.

## Goals / Non-Goals

**Goals:**

- One question, one endpoint, one resolved version — the console and the scheduler cannot name
  different versions of the same template.
- The console shows the result of publishing in the place where publishing was initiated.

**Non-Goals:**

- Reading back a frozen document, version history, retirement, renaming.
- Any change to how a version is resolved. `published-version.sql.ts` is not touched.

## Decisions

### Extend `GET /templates` instead of adding a console endpoint

The scheduling dropdown and the console are asking the same question — *which templates are
published, and on what version* — and they must never get different answers. Two endpoints over
the same CTE would be two places to keep in step for no gain.

*Alternative considered: `GET /templates/published` shaped for the console.* Rejected: it would
duplicate the join and, worse, invite a second resolution of "the current version" that could
drift from the one the scheduler freezes. That drift is exactly what the existing requirement was
written to prevent.

The two new fields are additive on a `strictObject` the scheduling forms already parse; they read
what they always read.

### `latest_published_at` comes from the same row as the version

Not `max(published_at)`, and not `template.created_at`: the timestamp must describe the version
being named. Taking it from anywhere else would produce a row that says "version 3, published in
March" where March belongs to version 1.

### The date is rendered with `formatDay`, not a relative age

`src/presentation/dates.ts` trims the ISO string on purpose — a record that is defended in front
of a regulator is read in the timezone it was stored in. "Published 12 Mar 2026" is a fact;
"published 5 months ago" is a fact about today, and it is the wrong one for a frozen record.

### The block is a card below the drafts, not a tab

The console's subject is authoring, and the drafts are where the work happens. A tab would hide
one behind the other and cost a click to answer "did that publish" — which is the question this
change exists for. Two cards on one page answer it by scrolling.

*Alternative considered: put the published templates first.* Rejected: the coordinator opens this
console to write, and the finished output is reference. The order follows what the screen is for.

### The empty state names publishing, not seeding

A coordinator who has published nothing yet is not going to run a seed file. The empty state says
that publishing a completed draft is what fills this list; it does not mention `hs_migrator`,
which is true and useless to the reader.

## Risks / Trade-offs

- **Two fields added to a DTO the scheduling forms parse.** → Additive and covered by the existing
  contract tests; the forms name the fields they read.
- **The console does not say what a published template asks.** → Accepted and named in the
  proposal: a document viewer is its own change. The version number and date are what this screen
  promises, and it keeps that promise fully.
- **A template retired by `hs_migrator` disappears from the console with no explanation.** →
  Pre-existing behaviour of `GET /templates`, which filters `deactivated_at IS NULL`. Retirement is
  not reachable from the application, so no reader can produce the state; when retirement gets an
  interface, that change owns the explanation.
