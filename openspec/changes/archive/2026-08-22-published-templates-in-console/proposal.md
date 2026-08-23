# Published templates in the template console

## Why

**Publishing works now, and its result is invisible.** `publish-template-draft` closed etapa 8's
second half: the coordinator publishes a draft and the draft leaves the list. Where the template
went, the interface does not say. `/templates` lists drafts and only drafts; the only place a
published template appears in the whole client is inside a `<select>` in `/scheduling`, when the
coordinator is already doing something else.

The result reads like a bug even though every part works: you publish, the row you were working on
disappears, and nothing takes its place. The coordinator has no way to answer the two questions he
will have five minutes later — *did that publish?* and *what version is this template on?* —
without opening the scheduling console and reading a dropdown.

This closes etapa 8 as an experience rather than as a mechanism. It adds no capability to the
system: everything it shows, `GET /templates` already answers.

## Lo que este change NO es

- **It is not a viewer for a published document.** Reading back the questions of a frozen version
  is a real need and a bigger screen — it needs an endpoint that returns the document, and it
  raises the question of which version you are reading. It belongs with revision, which is the
  change that will need it anyway.
- **It is not retiring or editing a published template.** No template is deactivated, renamed or
  corrected from this console. `template.deactivated_at` stays outside `hs_app`'s privileges.
- **It is not a version history.** The console names the current version, not every version ever
  published. With no way to publish a second version yet, a history would be a list of one.
- **It is not a second endpoint.** `GET /templates` already answers "which templates are
  published"; asking the same question twice with two shapes is how the two answers start
  disagreeing.

## What Changes

- **`/templates` gains a second block: the published templates.** Name, key, current version and
  when that version was published, ordered by name. It sits below the drafts, because this console
  is where work is done and published templates are the finished output of it.
- **`GET /templates` reports two more fields** — the template's `key` and the `published_at` of the
  version it is naming. The key is the identifier seeds reference and the one the coordinator sees
  on every draft row; a console that showed it while a template is being written and hid it once
  published would be hiding it exactly where it is most durable. The date answers "when did this
  change", which is the question a version number alone never answers.
- **The empty state says where templates come from.** An organisation whose only templates arrived
  by seed still sees them here; one with none is told that publishing a draft is what fills this
  list.
- **Two stale docblocks go.** `TemplatesRoute/index.tsx` still says publishing "no existe ningún
  endpoint que lo haga", which stopped being true when `publish-template-draft` was applied.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: the requirement *"The templates offered for scheduling are those with a published
  version"* gains the two fields the list reports. One requirement is added for what the authoring
  console shows, so that "the coordinator can see what he published" is a stated behaviour and not
  an accident of which screen happens to call the endpoint.

## Impact

- **No migration.** No column, no privilege, no trigger. Everything shown is already stored and
  already readable by `hs_app`.
- `packages/contracts/src/templates.ts`: `key` and `latest_published_at` on `templateOptionSchema`.
- `apps/api/src/templates/templates.service.ts`: two more columns in the `list` query, both from
  rows the query already joins. `published-version.sql.ts` is untouched — the version resolved is
  still the one the scheduler freezes, which is the property that requirement exists to protect.
- `apps/web/src/routes/TemplatesRoute/`: a `PublishedTemplates.tsx` block and its rows, the
  `presentation.ts` for its ordering and labels, and the route test. `SchedulingRoute` needs no
  change: it reads the fields it always read.
- **Unblocked**: nothing. This is a screen that pays off work already done.
