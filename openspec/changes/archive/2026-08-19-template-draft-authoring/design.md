## Context

See `proposal.md` — Why. The constraints that actually shape the approach:

- **The document schema already exists and is strict.** `packages/forms/src/document/schema.ts`
  requires `items.min(1)` per section, a non-empty `prompt`, a positive `position` per element, a
  unique `item_key` per document, and every `visible_when` reference resolving strictly earlier in
  document order. It is correct for a *published* document and unusable for one being typed.
- **The published model is closed.** `0003_template_model.sql` §9 revokes `INSERT` from `hs_app` on
  all four template tables and `hs_make_immutable` is applied to `template_version` and
  `template_version_item`. §9's own comment reserves the `GRANT INSERT` for etapa 8.
- **Templates carry no `site_id`.** Stated in `0003` and repeated in `templates.service.ts`: a
  template is organisation reference content. So there is no RLS story here, and there is no
  `hs_apply_site_isolation` to apply.
- **ADR-007** puts the document's shape in `packages/forms`, with no Node built-ins, because the
  package ships inside the service worker bundle and `eslint.config.js` enforces it.
- **ADR-008** keeps `templates` at `controller → service → repository` plus pure functions, and
  keeps it calling no other module.

## Goals / Non-Goals

**Goals:**

- A draft that is safe to save at any moment, including states no published document may ever hold.
- One answer to "can this be published", computed by the same code on the device and on the server.
- Reordering that cannot produce an invalid document.
- A schema change whose blast radius is one new table.

**Non-Goals:**

- Publishing, in every sense: no `GRANT INSERT`, no `item_key` registration, no `replaces_item_key`.
  D1 below explains why the split falls here.
- Seeding a draft from a published version.
- Editing `visible_when`.
- Offline authoring. A draft is coordinator work at a desk, not field work; ADR-001's "one owner,
  one device, accept losing drafts" is a rule about *capture*, and borrowing it here would trade a
  server round trip for a lost afternoon of authoring. The editor is online-only, like `/scheduling`
  and `/roster`.

## Decisions

### D1 — The draft is a new mutable table, and this change touches no immutable table

**Declared explicitly, per the schema rule:** `0016_template_drafts.sql` creates `template_draft` and
touches nothing else. It does not alter `template`, `template_item`, `template_version` or
`template_version_item`, and it does not change one privilege on them. The `GRANT INSERT` announced
by `0003` §9 stays unwritten until the publishing change.

`template_draft` is deliberately *not* immutable: no `hs_make_immutable`, and `GRANT UPDATE` by
column on `(name, document, revision, updated_at, discarded_at)`. `key` and `created_by` are outside
that list, so the identity of a draft is write-once even though its content is not. This is the
shape `0008` uses for `inspection_schedule` (ADR-002 permits mutability where it is declared column
by column; what it forbids is mutability by default).

Deletion is still forbidden: a `BEFORE DELETE OR TRUNCATE` trigger on `hs_forbid_mutation()`, and
`discarded_at` for retirement, per the invariant.

*Alternative rejected — store the draft as a `template_version` with `published_at IS NULL`.* It
would make the one table the whole model exists to freeze into a table that gets rewritten, and the
numbering trigger and the projection trigger would both have to learn about a state they were built
to make impossible. The cost of a second table is one migration; the cost of this is the invariant.

*Alternative rejected — keep the draft in Dexie.* ADR-001 accepts losing an inspection draft because
the alternative is a sync protocol for field work with no signal. Authoring is neither: it happens
online, it can take days, and losing it has no compensating simplification.

### D2 — The draft is standalone, and its identity is the **name**

A draft carries its own `name` and `key`. Nothing about creating or editing one reaches the
published model, which is what lets D1 hold — otherwise "create a draft" would already need `INSERT`
on `template`.

**The key is derived from the name and never typed.** The first cut had the author write both, with
the key pre-filled from the name and editable. That was wrong in a way worth recording, because the
fix went somewhere unexpected: the key was never the problem. With a free-text `name` and a unique
`key`, two drafts could carry the same name and different keys — and since the name is what the list
shows, those are two rows nobody can tell apart. Renaming made it trivial to reach.

Hiding the key does not fix that. If `key = f(name)` and names are not unique, the derivation has to
disambiguate itself (`monthly-electrical-2`), which is the same divergence made invisible. **The fix
is to make the name unique** (`0017`, a partial unique index on `lower(btrim(name))`), and only then
does deriving the key become safe and hiding it defensible.

Two consequences follow, and both are deliberate:

- **The derivation never suffixes.** Two different names that produce one key is a refusal, not a
  disambiguation, so `key = f(name)` holds without exception.
- **Renaming does not move the key**, because the key is write-once (`0016` §4) — it is what seeds
  reference and what will name the published template. So a renamed draft can end up with a key that
  no longer resembles its name. That is why the key is *shown* in the editor as read-only text
  rather than hidden outright: the drift is real and has to stay legible.

Every collision is reported against the **name**, whichever index actually fires. The author has no
key field; telling them about one would be telling them about a control they do not have.

Uniqueness against *published* templates still spans two tables and can only be checked, not
constrained. That check is a courtesy — nothing stops a seed from claiming the name afterwards — and
the authoritative refusal belongs to publication, at the `UNIQUE` on `template.key`.

No `template_id` column is added for the future "new version of an existing template" case. Adding a
nullable column is a routine migration; adding one now would be a column that is always `NULL` with
no code reading it.

### D3 — A lax draft schema plus `draftIssues`, both in `packages/forms`

`packages/forms/src/document/draft.ts` adds:

- `templateDraftDocumentSchema` — same shape as the published document, with three differences:
  sections may hold zero items, `prompt` and `section_title` may be empty, and **there is no
  `position` field**. `response_type` stays a hard enum and the per-type configuration stays a
  discriminated union of `strictObject`s: a nonsense type or a stray field is a bug in the client,
  not a half-finished thought, and the spec makes that the one thing a save refuses.
- `normalizeDraft(draft)` — assigns `position` from array index, 1-based, and returns the candidate
  document.
- `draftIssues(draft)` — runs `templateDocumentSchema.safeParse(normalizeDraft(draft))` and turns
  Zod issues into `{ path, message }` naming the section or item, in English.
- `emptyDraftDocument()`.

It lives in `forms` and not in `apps/web` for the reason ADR-007 gives: publication will re-run the
same check on the server, and two implementations of "is this publishable" would eventually
disagree, with the interface saying yes and the server saying no. Pure, no clock, no randomness —
the existing lint rule covers the directory.

*Alternative rejected — validate the draft with the strict schema and keep the incomplete state in
React only.* Then a save is only possible from a complete document, and leaving a section half
written loses it. Which is exactly the failure this change exists to remove.

### D4 — Order is the array; `position` is derived

The draft document has no `position`. `normalizeDraft` assigns it. Two consequences worth the
decision: the "two items share a position" refinement in `schema.ts` becomes unreachable from the
interface rather than an error the author has to understand, and reordering is a one-line array move
with nothing to renumber.

The published document keeps `position` unchanged — it is a frozen record and its order must not
depend on array serialisation.

*Alternative rejected — store `position` and renumber on every move.* Every insert, delete and move
has to renumber a slice, and any bug in that arithmetic produces a document that fails validation
for a reason the author cannot see.

### D5 — Explicit save with an optimistic lock on `revision`

No autosave and no optimistic update: neither appears anywhere in this client, and both would fight
the lock. `revision` starts at 1 and the update is
`UPDATE template_draft SET ..., revision = revision + 1 WHERE id = $1 AND revision = $2 AND
discarded_at IS NULL` — zero rows affected means either stale or already discarded, distinguished by
a follow-up read so the author gets the right message.

This is a single-author lock, not a merge. Two windows on the same draft is the ordinary case
(D5's spec scenario), and losing an afternoon to the second one winning silently is the failure
being prevented.

### D6 — Authorisation is the role, in the service

`templates` has no RLS to lean on (`template` has no `site_id`, D1), so the service checks
`session.role !== 'hs_coordinator'` and throws, which is the pattern of `roster.service.ts`,
`actions.service.ts` and every other role-gated read in the repo. There is no `RolesGuard` to reuse
and this change does not introduce one.

`GET /templates` is left alone. It answers a different question — published templates, for anyone
scheduling — and gating it would break `/scheduling`.

Reads still go through `db.withSessionClient`, not `withSiteScope`: this is the HTTP path, and
`withSiteScope` is for seeds and server commands (CLAUDE.md). That the table has no policy does not
make the choice of method free — an endpoint that called `withSiteScope` would be manufacturing a
scope it was not given.

### D7 — The editor's document operations are pure and live in the route

`TemplateDraftRoute/edits.ts` holds `addSection`, `moveSection`, `removeSection`, `addItem`,
`moveItem`, `removeItem`, `changeResponseType`, `suggestItemKey` — all `(document, …) => document`,
all tested without rendering. They are edit operations, not presentation, so they do not go in
`presentation.ts`, and they are the builder's alone, so they do not go in `packages/forms`.

`changeResponseType` is the one with teeth: it drops the previous type's configuration and seeds the
new type's defaults. Merging instead would leave a `max_length` on a `single_choice` item, which
`strictObject` refuses — at publication, long after the author moved on. It is spec'd for that
reason.

`suggestItemKey(prompt)` proposes a slug; the field stays editable. Auto-generating without showing
it would hide the one identifier that has to survive every future edit.

## Risks / Trade-offs

- **A draft name can be taken by a published template between the check and publication** →
  Accepted, and stated in D2. The authoritative refusal is `UNIQUE` on `template.key` at publish
  time; the early check exists to make the common case pleasant, not to guarantee anything. Within
  `template_draft` there is no such gap: the two partial unique indexes fire regardless, and the
  service translates their `23505` to the same name-collision error.
- **A renamed draft carries a key that no longer matches its name** → Accepted and made visible.
  The alternative — moving the key on rename — would break the one thing the key is for. The editor
  shows the key read-only so the divergence can be read rather than discovered in a seed file.
- **`draftIssues` translates Zod issues, so a schema change can silently degrade a message** →
  `draft.test.ts` asserts one case per issue family against the strict schema's own refinements, so
  a new refinement without a matching message shows up as a failing test rather than as "Invalid
  input" on screen.
- **The lax schema can drift from the strict one** → `normalizeDraft` feeds
  `templateDocumentSchema` directly rather than reimplementing it, so drift can only be a *missing*
  field, never a contradictory rule. The round-trip test (published document → draft → normalise →
  identical document) catches the missing-field case.
- **The editor is online-only while the rest of the app is offline-first** → Declared as a Non-Goal.
  `/scheduling` and `/roster` already work this way, and `OfflineRoute` covers the failure.
- **`template_draft` is mutable, which reads as an exception to ADR-002** → It is a declared one:
  `GRANT UPDATE` by column, deletion still refused by trigger, and the record the invariant protects
  (`template_version`) is untouched. The migration says this in its header so nobody has to
  reconstruct the reasoning from the grants.

## Migration Plan

Two migrations, forward-only like every one in this repo, and neither touches an immutable table.

`0016_template_drafts.sql` creates `template_draft` and the grants on it. `0017_template_draft_name_identity.sql`
adds the partial unique index on `lower(btrim(name))` that D2 requires. Both only add, so there is
no data migration and nothing to backfill.

Rollback is `DROP TABLE template_draft` and is safe by construction: no other table references it,
and no published data was produced through it. Deploying the API before the migration fails on the
missing table at first use, not at boot — the ordinary ordering (`db:migrate` before the new API)
applies.

The Drizzle mirror in `apps/api/src/db/schema/templates.ts` is written by hand to match, as the file
header already states for the existing four tables; `drizzle-kit generate` is not used.
