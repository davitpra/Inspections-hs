# Publish a template draft

## Why

**This is the second half of etapa 8**, and the half that makes the first one worth
anything. Today the coordinator can write a template end to end — sections, questions,
response types, prescriptions, plant scope — and then cannot do the one thing the whole
screen exists for. `PublishReadiness.tsx` says it in the interface: *"This template will be
publishable once publishing is available."* `TemplateDrafts.tsx` says it again: *"Publishing
a template so it can be scheduled is not available yet."*

Until it is, a template still enters the system exactly one way — an SQL seed run by
`hs_migrator` — and etapa 8's promise, *"el coordinador deja de depender del desarrollador"*,
is not kept: rewording one question is still a code change, a migration review and a deploy.

The split was deliberate. `2026-08-19-template-draft-authoring` wrote down why: a draft is
rewritten a hundred times and a published version is frozen forever, and mixing them would
put a mutable table and a `GRANT INSERT` on the immutable model into one review. That same
proposal wrote down what remains: *"the second half of etapa 8 is the `GRANT INSERT` that
`0003` §9 has been waiting for, plus `item_key` registration — and nothing else."* This
change is that, and nothing else.

## Lo que este change NO es

- **It is not a revision.** A draft publishes as **version 1** of a new template. Seeding a
  draft from the latest published version — v2 out of v1, preserving `item_key` — is the
  next change. It is a separate subject: publishing is about writing a first frozen record,
  revising is about carrying identity forward across two of them, and the second one is
  worth reviewing on its own.
- **It is not retiring a template.** `template.deactivated_at` and
  `template_item.deactivated_at` stay outside `hs_app`'s privileges, exactly as `0003` §9
  left them. Nothing here grants `UPDATE` on the published model, ever.
- **It is not site scope on a published template.** A draft's `site_ids` stated where the
  template was being *written for*, and its whole consequence — which shared location each
  section could name — is already written into the document. `template` still carries no
  `site_id`, still has no policy, and is still organisation reference content (`0003` §1).
- **It is not an approval workflow.** There is no reviewer, no second signature (out of
  scope in v1), and no "pending publication" state. The coordinator publishes, and the
  version is frozen the moment the row lands.
- **It is not a new publishability rule.** `draftIssues` in `packages/forms` already decides
  what stands between a draft and a version, and the builder already runs it on every
  keystroke. Publishing runs the same function and the same `templateDocumentSchema`
  (ADR-007). A second implementation is exactly how the screen ends up saying a template is
  ready while the server says it is not.

## What Changes

- **One new endpoint, `POST /templates/drafts/:id/publish`**, the HS coordinator's like the
  other five. In one transaction it writes the `template` row with the `key` the draft
  reserved, one `template_item` row per `item_key` in the document, and the `template_version`
  row carrying the normalised document as version 1. `template_version_item` it does not
  write: the projection trigger of `0003` §6 derives it, and that is the point of the
  trigger.
- **Publishing consumes the draft.** The row gains `published_at` and `template_version_id`,
  leaves the list of live drafts, and stops accepting saves and discards. A draft is scratch
  work; once it has produced a frozen version, editing it further would be editing something
  that no longer describes anything. The row is kept — never deleted — and it is what records
  which version this piece of scratch work became.
- **A published draft releases its name and its key.** The two partial unique indexes that
  keep live drafts distinct (`0016` §4, `0017` §1) stop covering it, because from that moment
  the authoritative holder of the key is `template.key` — a `UNIQUE` that spans every
  published template, seeded or authored.
- **An unpublishable draft is refused with what it lacks.** The refusal carries the same
  `issues` the builder is already showing, so the two never disagree about why.
- **The interface grows a Publish button and a confirmation.** It is the point of no return
  for a template the way submission is for an inspection: after it, correcting the template
  means publishing another version, and in this change that path does not exist yet. The
  dialog says so plainly rather than implying an undo.
- **`GRANT INSERT` on the four tables of the published model** — the grant `0003` §9
  announced by name. Never `UPDATE`: publishing is inserting a new version.

## Capabilities

### New Capabilities

None. Publishing is `templates`' own subject; the capability has described the published
version since `2026-08-07-template-versioning-item-identity` and the draft since
`2026-08-19-template-draft-authoring`. What has never been specified is the act that turns
one into the other.

### Modified Capabilities

- `templates`: the capability gains publication as an act — who may perform it, what it
  writes, what it refuses, and what it does to the draft it consumes. Three existing
  requirements are amended, none of them about what a published version *is*: *"Authoring a
  template is the HS coordinator's"* adds publishing to the acts it governs; *"A draft is a
  working document, not a version"* gains the published draft — creating and saving still
  write nothing to the published model, which is what that requirement actually guarantees;
  *"A draft is discarded, never deleted"* gains the fact that discarded and published are
  distinct and mutually exclusive ends for a draft.

## Impact

- **One migration, `0025_publish_template_from_builder.sql`**, and it **does touch the
  immutable model**: `GRANT INSERT ON template, template_item, template_version,
  template_version_item TO hs_app`. `hs_make_immutable` never touched `INSERT`, so nothing
  about immutability changes — an inserted version still cannot be updated or deleted by any
  role. On `template_draft` it adds `published_at` and `template_version_id`, rewrites the
  by-column `GRANT UPDATE` list whole (the convention `0016` §4 → `0020` → `0021` follows),
  and recreates the two partial unique indexes so that a published draft no longer holds its
  name and key.
- `apps/api/src/db/schema/templates.ts`: the two new columns, mirrored by hand —
  `drizzle-kit generate` is not used in this repo (ADR-004).
- `packages/contracts/src/templates.ts`: the publication response and the new error codes.
  No new document schema: `normalizeDraft` and `templateDocumentSchema` already exist in
  `packages/forms` and are re-exported.
- `apps/api/src/templates/`: a `publish` on controller, service and repository, and the
  errors for a draft that is not publishable, a key already taken by a published template,
  and an `item_key` already registered elsewhere. `findDraft` / `findDrafts` gain
  `published_at IS NULL`. ADR-008 holds: `templates` still calls no other module.
- `apps/web`: `publishTemplateDraft` in `api/templates.ts`, `canPublishTemplates` in
  `permissions/`, the button in `TemplateDraftRoute/DraftHeader.tsx` with its confirmation
  dialog, and the two copy blocks that currently promise something that does not exist.
  Publication invalidates both `templateDrafts()` and `templates()` — the query keys are
  kept apart precisely for this.
- **Unblocked**: revising a published template. Once a draft can become version 1, seeding a
  draft from the latest version — preserving `item_key` so the recurrence series survives —
  is the only thing standing between the coordinator and a template he can correct himself.
