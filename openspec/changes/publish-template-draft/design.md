# Design — Publish a template draft

## Context

See `proposal.md` — Why. What matters for the approach is what is already built and what the
engine already refuses.

**The published model is finished and immutable** (`0003_template_model.sql`). It numbers its
own versions (`hs_template_version_next`, §5, advisory lock per template, `HS002` when the
number is not the next), it projects its own item rows from the document
(`hs_template_project_items`, §6, rewritten by `0007` to carry `config` and `visible_when`), it
guards `item_key` as write-once (§7), and it makes `template_version` and
`template_version_item` immutable (§8). Its §9 revoked `INSERT` from `hs_app` with a note
naming this change: *"La etapa 8 (builder visual) concederá INSERT sobre estas tablas. Nunca
UPDATE: publicar es insertar una versión nueva."*

**The draft is finished too** (`0016`, `0017`, `0020`, `0021`). It is mutable by column, has no
`site_id` and therefore no RLS (authorisation is by role in the service), is never deleted, and
its name and key are unique among live drafts through two partial indexes.

**The conversion already exists as a pure function.** `normalizeDraft` in
`packages/forms/src/document/draft.ts` turns a draft document into a `TemplateDocument` with
positions derived from list order, and `draftIssues` reports what stands between a draft and a
publishable document — the same function the builder runs on every keystroke and the service
already runs on every read to compute `publishable`.

**This change touches an immutable table** (`openspec/config.yaml`, design rule): it grants
`INSERT` on `template`, `template_item`, `template_version` and `template_version_item`. It
grants no `UPDATE` and no `DELETE` on any of them, and installs no trigger there. An inserted
version remains as unmodifiable as one written by a seed.

## Goals / Non-Goals

**Goals:**

- Publishing writes exactly what a seed writes, through the same engine mechanisms, so that a
  seeded template and an authored one are indistinguishable once published.
- One transaction, one refusal surface: either the template, its items and its version all
  exist, or none of them do and the draft is untouched.
- One implementation of "is this publishable", shared by the device and the server (ADR-007).

**Non-Goals:**

- Version 2 of anything. The numbering trigger will happily accept it; nothing in this change
  produces a draft that could become it.
- Any new engine mechanism. No new trigger, no new function, no `SECURITY DEFINER`.
- Any weakening of immutability to make the write easier.

## Decisions

### The service inserts three rows; the engine derives the fourth

`template` → `template_item` (one per `item_key` in the document) → `template_version` with
`version` 1 and the normalised document. `template_version_item` is left to
`hs_template_project_items`.

*Alternative considered: project the item rows in the service.* Rejected for the reason `0003`
§6 gives for the trigger existing at all — a writer that inserts the document and not the rows
produces a template that renders correctly and returns nothing from the recurrence query, with
no error anywhere. Two writers would have to agree forever; one writer cannot disagree with
itself.

**Consequence for privileges**: the trigger function is not `SECURITY DEFINER` (neither in `0003`
nor after `0007` rewrote it), so it runs as `hs_app` and needs `INSERT` on
`template_version_item`. The migration grants on all four tables, which is what `0003` §9
announced anyway. `hs_make_immutable` never touched `INSERT`, so this takes nothing back.

### Version 1 is written explicitly, not computed

The `INSERT` names `version` 1 and lets `hs_template_version_next` refuse it if it is wrong. It
cannot be wrong in this change — the template row is created in the same transaction — but
reading `max(version) + 1` in the service would be a second implementation of the rule that
already exists in `0003` §5, and would race exactly where the advisory lock is there to prevent
a race.

### Publishability is `draftIssues`, and only `draftIssues`

The service refuses on `draftIssues(document).length > 0` and returns those issues in the body.
It then parses `normalizeDraft(document)` with `templateDocumentSchema` before writing, not as a
second opinion but as the guarantee `draft.ts` documents: "no issues" and "parses" are equivalent
by construction, and `draft.test.ts` fails if they drift. A parse failure at that point is a bug,
not a refusal the author can act on, and surfaces as the generic 400 the save path already uses
for impossible documents.

### Publishing consumes the draft, and the row is kept

`published_at` and `template_version_id` on `template_draft`. Every read of a live draft gains
`published_at IS NULL` alongside the `discarded_at IS NULL` it already has.

*Alternative considered: leave the draft live so that editing and publishing again produces v2.*
Rejected: it makes a draft a permanent shadow of a frozen record, free to drift from it in
silence, and it contradicts the requirement that a draft is scratch work and not a version.
Revising a published template is a change of its own, and it will seed a **new** draft from the
latest version — which is also what makes `item_key` preservation an explicit act rather than an
accident of a row that happened to survive.

*Alternative considered: reuse `discarded_at`.* Rejected: "discarded" already means the author
threw the work away. A row where publishing and discarding are indistinguishable erases the only
trace of where a version came from.

### The two partial unique indexes gain `published_at IS NULL`

Otherwise a published draft keeps holding its name and key against new drafts, and the message
the author gets names a draft that no longer exists instead of the template that does. After
publication the authoritative holder is `template.key` — a `UNIQUE` across every published
template, seeded or authored — and `isNameTaken` already reads both populations.

### `site_ids` stops at publication

`template` carries no plant by design (`0003` §1: a `site_id` there would duplicate the same
inspection twice with two sets of `item_key`, and "the same guard is missing at both plants"
would stop being a question the data can answer). The scope's entire effect — which shared
location each section could name — is already written into the document being frozen.

*Alternative considered: a `template_site` table so that scheduling only offers a template where
it is meant to be used.* Rejected for this change: it is a new table, a new requirement, and a
change to the scheduling list, none of which publishing needs. It is a coherent follow-up if
offering every template at every plant turns out to bother the coordinator in practice.

### Error codes

- `template_draft_not_publishable` (409) — carries `issues`.
- `template_key_taken` (409) — the `UNIQUE` on `template.key`, translated from `23505`.
- `template_item_key_taken` (409) — an `item_key` already registered, translated from the same
  SQLSTATE on a different constraint. Astronomically unlikely (the editor mints 12 characters
  from a 36-symbol alphabet) but `item_key` is a **global** primary key, and the alternative to
  translating it is a 500.
- `template_draft_not_found` (404) — a draft that is discarded, published, or never existed. For
  the caller they are the same fact: there is no live draft with that id.
- `template_draft_forbidden` (403) — unchanged, and reused rather than given a publish-specific
  twin: for every role but one, a draft does not exist.

### The interface asks before publishing, and says what cannot be undone

The Publish button lives in `DraftHeader` next to Save, enabled only when the draft is saved and
has no issues — a dirty draft cannot publish, because publishing what is on the server while the
screen shows something else is the worst possible reading of that button. The confirmation dialog
follows `TemplatesRoute/DiscardDraftDialog.tsx` (mounted from the route so it survives query
invalidation) and states plainly that a published version cannot be edited and that this draft
will close, rather than implying an undo that does not exist yet.

## Risks / Trade-offs

- **A published template cannot be corrected through the interface until revision exists.** →
  Accepted, and named in the dialog. The seed path still works, and this is strictly better than
  today, where nothing can be published at all.
- **`GRANT INSERT` widens what a compromised `hs_app` can write.** → It can add a version; it
  still cannot alter or remove one, cannot rewrite an `item_key`, and cannot delete a template.
  The audit trail of a spurious version is the version itself, with its `published_by`.
- **Every published template is offered at every plant.** → The consequence of the `site_ids`
  decision, stated as a requirement so it reads as a choice. Mitigation if it bites: the
  `template_site` follow-up above.
- **A draft whose author never publishes stays live forever.** → Unchanged by this change, and
  discarding already covers it.

## Migration Plan

`0025_publish_template_from_builder.sql`, in this order:

1. `GRANT INSERT ON template, template_item, template_version, template_version_item TO hs_app`.
   No `UPDATE`, no `DELETE`.
2. `ALTER TABLE template_draft` — add `published_at timestamptz` and `template_version_id uuid
   REFERENCES template_version (id)`, plus a check that the two are both set or both absent and a
   check that `discarded_at` and `published_at` are not both set.
3. Rewrite the by-column `GRANT UPDATE` on `template_draft` whole, adding the two columns — the
   convention `0016` §4 → `0020` §4 → `0021` §2 follows, so the current list is always readable
   in one place.
4. Drop and recreate `template_draft_key_live_idx` and `template_draft_name_live_idx` with
   `WHERE discarded_at IS NULL AND published_at IS NULL`.

Forward-only, like every migration in this repo. Rollback is a new migration; nothing here
destroys data, and the grant can be revoked on its own if publishing has to be turned off.
