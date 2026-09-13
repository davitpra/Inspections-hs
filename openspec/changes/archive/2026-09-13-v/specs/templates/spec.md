## RENAMED Requirements

- FROM: `### Requirement: Publishing a template is the HS coordinator's`
- TO: `### Requirement: Publishing a template is the coordinator's`

- FROM: `### Requirement: Authoring a template is the HS coordinator's`
- TO: `### Requirement: Authoring a template is the coordinator's`


## MODIFIED Requirements

### Requirement: A publishable draft becomes the next version of its template

The system SHALL publish a live draft on the coordinator's request, writing in one
transaction the `template_version` row carrying the draft document with its positions derived
from list order, and, when the draft names no template, the `template` row carrying the draft's
`key` and `name` first.

The `version` written SHALL be one greater than the template's highest published version, and
SHALL be one when the template has none. The number SHALL be decided by the engine: the request
computes it, and the trigger that guards `template_version` recomputes it under a lock over the
template and rejects a number that is not the next one.

The `template_version_item` rows SHALL NOT be written by the publishing request: they are
derived from the document by the engine, so that a template published from a draft and a
template loaded by a seed are projected by the same rule and cannot disagree.

The system SHALL record on the version the account that published it, and SHALL report to the
publisher the identity of the template, the identity of the version, and its version number,
so that the interface can name what was created rather than only that something was.

#### Scenario: Publishing a first draft writes the template, its items and version 1

- **GIVEN** a live draft that names no template, whose document is publishable, with two
  sections of two questions each
- **WHEN** the coordinator publishes it
- **THEN** a `template` row exists carrying the draft's `key` and `name`
- **AND** a `template_version` row exists for that template with `version` 1
- **AND** a `template_item` row is registered for each of the four `item_key` values
- **AND** the response names the `template_id`, the `template_version_id` and `version` 1

#### Scenario: Publishing a revision writes only a version

- **GIVEN** a template published at version 1 and a publishable revision draft of it
- **WHEN** the coordinator publishes the revision
- **THEN** a `template_version` row exists for that template with `version` 2
- **AND** the number of `template` rows is unchanged
- **AND** the `template` row still carries the `key` and `name` it had
- **AND** the response names the same `template_id` and `version` 2

#### Scenario: The reworded question keeps its row identity separate from its concept

- **GIVEN** a template published at version 1 declaring `guards.packaging-lines`
- **WHEN** a revision rewords that question and is published as version 2
- **THEN** the version 2 `template_version_item` row carries the new `prompt`
- **AND** its `item_key` is `guards.packaging-lines`
- **AND** its `id` differs from the version 1 row's `id`

#### Scenario: The item rows are derived, not sent

- **GIVEN** a live draft whose document is publishable
- **WHEN** the coordinator publishes it
- **THEN** one `template_version_item` row exists for every question of the document
- **AND** each row carries the `item_key`, `section_key`, `prompt`, `response_type` and
  `required` the document declared

#### Scenario: The version records who published it

- **WHEN** a coordinator publishes a draft
- **THEN** the `template_version` row's `published_by` names that account
- **AND** its `published_at` is set

### Requirement: An unpublishable draft is refused and writes nothing

The system SHALL refuse to publish a draft whose document is not publishable, SHALL report the
refusal as `template_draft_not_publishable` carrying the same issues that reading the draft
reports, and SHALL leave the draft live and unchanged.

The publishability of a draft SHALL be decided by the same shared rules that decide it when the
draft is read, so that a draft the interface reports as ready is never refused at publication
and a draft it reports as incomplete is never accepted.

#### Scenario: A draft with an empty section is refused

- **GIVEN** a live draft with a section that has no questions
- **WHEN** the coordinator publishes it
- **THEN** the request is refused as `template_draft_not_publishable`
- **AND** the refusal carries the issue naming that section
- **AND** no `template`, `template_item` or `template_version` row is written
- **AND** the draft is still live

#### Scenario: An empty draft is refused

- **GIVEN** a live draft whose document has no sections
- **WHEN** the coordinator publishes it
- **THEN** the request is refused as `template_draft_not_publishable`
- **AND** the draft is still live

### Requirement: Publishing consumes the draft

The system SHALL, on a successful publication, record `published_at` and the
`template_version_id` of the version it produced on the `template_draft` row, and SHALL from
then on treat that draft as no longer live: it is absent from the list of drafts, and saving,
discarding or publishing it again SHALL be refused.

The row SHALL be kept. A draft that produced a version is the record of where that version came
from, and deleting it would erase that trace; but continuing to edit it would be editing scratch
work that no longer describes anything, because the document it describes is frozen.

A draft SHALL NOT be both discarded and published. The two are distinct ends: one says the
author threw the work away, the other says it became a record.

#### Scenario: A published draft leaves the list

- **WHEN** a live draft is published
- **THEN** it is absent from the list of drafts
- **AND** its `template_draft` row still exists with `published_at` and `template_version_id` set

#### Scenario: A published draft cannot be saved

- **GIVEN** a draft that has been published
- **WHEN** a save is submitted for it
- **THEN** the request is refused as `template_draft_not_found`
- **AND** the stored draft is unchanged

#### Scenario: A published draft cannot be published twice

- **GIVEN** a draft that has been published
- **WHEN** the coordinator publishes it again
- **THEN** the request is refused as `template_draft_not_found`
- **AND** the number of `template` and `template_version` rows is unchanged

#### Scenario: A published draft cannot be discarded

- **GIVEN** a draft that has been published
- **WHEN** it is discarded
- **THEN** the request is refused as `template_draft_not_found`
- **AND** its `discarded_at` is still absent

### Requirement: A key already held by a published template is refused at publication

The system SHALL refuse a publication that would create a template whose key already belongs to
a published template, report it as `template_key_taken`, and leave the draft live and unchanged
with no partial record written.

The refusal SHALL apply to a draft that names no template. A revision draft holds its template's
key on purpose and SHALL NOT be refused for holding it: it creates no `template` row.

The check when a draft is named is a courtesy so that the author learns early; it cannot be a
guarantee, because a template may be published under that key between the naming and the
publication. The refusal at publication is the authoritative one.

#### Scenario: Publishing under a key a seeded template already holds is refused

- **GIVEN** a seeded template whose `key` is `monthly-general-inspection`
- **AND** a live publishable draft that names no template and whose derived key is
  `monthly-general-inspection`
- **WHEN** the coordinator publishes the draft
- **THEN** the request is refused as `template_key_taken`
- **AND** the draft is still live
- **AND** no new `template` row exists

#### Scenario: A revision publishes under the key it holds

- **GIVEN** a publishable revision draft whose `key` is `monthly-general-inspection`, the key of
  the template it revises
- **WHEN** the coordinator publishes it
- **THEN** the request succeeds
- **AND** the number of `template` rows is unchanged

### Requirement: Publication is all or nothing

The system SHALL write the template, its registered items and its version in a single
transaction, so that a refusal at any point leaves no trace: no template without a version, no
registered `item_key` belonging to a template that does not exist, no version of a template that
did not accept its items, and no draft marked as published.

A template row without a version would be invisible to every reader of published templates and
would hold its key forever, which is the worst of both outcomes: the coordinator could neither
schedule it nor publish it again under the same name.

#### Scenario: A refused publication leaves no template row

- **GIVEN** a live publishable draft whose derived key already belongs to a published template
- **WHEN** the coordinator publishes it
- **THEN** the number of `template`, `template_item` and `template_version` rows is unchanged
- **AND** the draft's `published_at` is absent

#### Scenario: An item_key registered to another template stops the whole publication

- **GIVEN** a live publishable draft one of whose `item_key` values is already registered in
  `template_item` under a different template
- **WHEN** the coordinator publishes it
- **THEN** the request is refused
- **AND** no `template` row exists carrying the draft's `key`
- **AND** the draft is still live

#### Scenario: A refused revision leaves the template at its previous version

- **GIVEN** a template published at version 1 and a revision draft that is refused at publication
- **WHEN** the coordinator publishes it
- **THEN** the highest `template_version` for that template is still 1
- **AND** the draft's `published_at` is absent

### Requirement: A revision registers only the item keys it adds

The system SHALL, when publishing a revision, register in `template_item` only the `item_key`
values the document declares that are not registered yet, and SHALL leave the rows of the keys
it carried forward exactly as they are.

Before writing, the system SHALL refuse a document that declares an `item_key` registered to a
different template, reporting it as `template_item_key_taken`, and one whose `template_item` row
carries a non-null `deactivated_at`, reporting it as `template_item_deactivated` and naming the
key. An `item_key` is global and write-once: two templates do not share a concept, and a retired
concept is not asked again.

#### Scenario: A carried key is not registered twice

- **GIVEN** a template published at version 1 declaring `guards.packaging-lines`
- **WHEN** a revision that keeps that question and adds `guards.line-3` is published
- **THEN** a `template_item` row exists for `guards.line-3` under that template
- **AND** the `template_item` row for `guards.packaging-lines` has the `created_at` it had

#### Scenario: A key belonging to another template stops the publication

- **GIVEN** a revision draft one of whose `item_key` values is registered to a different
  template
- **WHEN** the coordinator publishes it
- **THEN** the request is refused as `template_item_key_taken`
- **AND** no `template_version` row is written for the template being revised
- **AND** the draft is still live

#### Scenario: A deactivated key stops the publication

- **GIVEN** a revision draft declaring an `item_key` whose `template_item` row carries
  `deactivated_at`
- **WHEN** the coordinator publishes it
- **THEN** the request is refused as `template_item_deactivated`
- **AND** the refusal names that `item_key`
- **AND** the draft is still live

### Requirement: Publishing a template is the coordinator's

The system SHALL restrict publishing a template draft to an administrative account —
`coordinator` or `management` — and SHALL refuse `inspector` as `template_draft_forbidden`,
the same code the other acts on a draft use: for the role that inspects, a draft is a document that
does not exist.

#### Scenario: An inspector cannot publish

- **WHEN** an account whose role is `inspector` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template` or `template_version` row is written

### Requirement: Revising a published template seeds a draft from its latest version

The system SHALL create, on the coordinator's request over a published template, a
`template_draft` bound to that template through `template_draft.template_id`, whose `document`
is the document of the template's latest published version with its positions dropped, whose
`key` and `name` are the template's own, and whose `site_ids` are the active plants of the
requesting account.

Every `item_key` the latest version declares SHALL appear unchanged in the seeded draft, because
carrying the concept forward is the whole point of revising rather than starting over.

The request SHALL be refused as `template_not_found` when the template does not exist or has been
deactivated, and as `template_version_not_found` when it has no published version. It SHALL be
restricted to an administrative account and refused to `inspector` as `template_draft_forbidden`.

#### Scenario: The seeded draft repeats the published document

- **GIVEN** a template published at version 2 with two sections of two questions each
- **WHEN** the coordinator revises it
- **THEN** a draft exists whose `template_id` is that template
- **AND** its document declares the same four `item_key` values in the same order
- **AND** its `key` and `name` are the template's `key` and `name`

#### Scenario: The seeded draft carries no position

- **GIVEN** a template whose published document declares positions
- **WHEN** the coordinator revises it
- **THEN** the stored draft document declares no `position` on any section or item

#### Scenario: The published model is untouched by seeding

- **WHEN** a template is revised
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: An inspector cannot revise

- **WHEN** an account whose role is `inspector` revises a published template
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_draft` row is written

#### Scenario: A template with no published version cannot be revised

- **GIVEN** a `template` row with no `template_version`
- **WHEN** the coordinator revises it
- **THEN** the request is refused as `template_version_not_found`

### Requirement: A template has at most one live revision

The system SHALL allow a single live revision draft per template, enforced by the engine, and
SHALL return the existing one when a template that is already being revised is revised again
rather than creating a second draft or refusing the request.

Two live revisions of one template would be two corrections that cannot see each other: the
second to publish would become the next version without containing anything the first wrote,
and there is no honest way to merge them.

A discarded or published revision SHALL stop counting, so a template can be revised again after
its previous revision ended either way.

#### Scenario: Revising twice returns the same draft

- **GIVEN** a template with a live revision draft
- **WHEN** the coordinator revises that template again
- **THEN** the response names the draft that already exists
- **AND** only one live `template_draft` row has that `template_id`

#### Scenario: A second live revision is rejected by the engine

- **WHEN** a second `template_draft` row is inserted with the `template_id` of a template that
  already has a live revision draft
- **THEN** the insert fails with a unique violation

#### Scenario: A discarded revision frees the template

- **GIVEN** a template whose revision draft has been discarded
- **WHEN** the coordinator revises that template
- **THEN** a new draft is created

### Requirement: Authoring a template is the coordinator's

The system SHALL restrict reading, creating, saving, discarding and publishing a template draft
to an administrative account — `coordinator` or `management` — and SHALL refuse `inspector`
with a code the interface can act on rather than a message it must parse.

The restriction SHALL be by role and not by site scope, because a template carries no `site_id` by
design and a draft's `site_ids` describes where it is intended to be used rather than whose data
it is. A draft remains organisation reference content, and restricting visibility by plant would
reintroduce the per-plant duplication the model exists to avoid.

#### Scenario: An inspector cannot read drafts

- **WHEN** an account whose role is `inspector` lists the template drafts
- **THEN** the request is refused as `template_draft_forbidden`

#### Scenario: An inspector cannot save a draft

- **WHEN** an account whose role is `inspector` saves an existing draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** the stored draft is unchanged

#### Scenario: An inspector cannot publish a draft

- **WHEN** an account whose role is `inspector` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_version` row is written

#### Scenario: A management account authors like the coordinator

- **WHEN** an account whose role is `management` lists, creates, saves, discards or publishes a
  template draft
- **THEN** each request is accepted on the same terms as for a `coordinator`

#### Scenario: Drafts do not depend on the requester's site scope

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries

### Requirement: The authoring console lists the published templates

The system SHALL show, in the console where templates are authored, the templates that have a
published version and are not archived, separately from the drafts and clearly distinguished from
them: a draft is work in progress and a published template is a frozen record, and a list that
mixed them would invite the coordinator to treat one as the other.

Each entry SHALL name the template, its `key`, the number of its current version and when that
version was published, so that the coordinator can answer both "did that publish" and "what
version is this on" without leaving the console.

The entries SHALL be ordered by name. Order by recency would rearrange the list under the
coordinator every time anything is published, and the list is read to find a known template far
more often than to see what changed last.

The console SHALL show the published templates to the coordinator only, on the same grounds
the drafts are: it is the authoring console, and the restriction is by role, not by site scope.

#### Scenario: A published template appears in the console

- **GIVEN** a template published from a draft
- **WHEN** the coordinator opens the template console
- **THEN** the published templates include it with its `key` and version `1`
- **AND** it is not listed among the drafts

#### Scenario: A seeded template appears the same way

- **GIVEN** a template loaded by a seed file
- **WHEN** the coordinator opens the template console
- **THEN** it appears among the published templates
- **AND** nothing distinguishes it from one published through the interface

#### Scenario: A draft is not listed as published

- **GIVEN** a live draft whose document is publishable
- **WHEN** the coordinator opens the template console
- **THEN** it appears among the drafts
- **AND** it does not appear among the published templates

#### Scenario: An organisation with nothing published is told what fills the list

- **GIVEN** no template has a published version
- **WHEN** the coordinator opens the template console
- **THEN** the published templates section states that publishing a draft is what fills it

#### Scenario: An archived template is not counted among the published

- **GIVEN** one published template that is archived
- **WHEN** the coordinator opens the template console
- **THEN** the published templates section does not list it
- **AND** the count it reports does not include it

### Requirement: A deactivated published template can be archived without losing anything

The system SHALL allow the coordinator to archive a published template only when its
`deactivated_at` is non-null. Archiving SHALL set `template.archived_at` and SHALL NOT delete the
`template` row, change any `template_version` document, or alter the schedule rules, scheduled
inspections and submitted inspections that name it: a template retired months ago is still the
reference of every inspection made with it, and archiving is a decision about a table, not about
the record.

An attempt to archive a template that is still active SHALL be refused with a stated reason, and
so SHALL an attempt to archive one that is already archived. Archiving SHALL be restricted to the
coordinator, on the same grounds as retiring one: it is the authoring console, and the
restriction is by role, not by site scope.

#### Scenario: A retired template is archived

- **GIVEN** a published template whose `deactivated_at` is non-null and whose `archived_at` is null
- **WHEN** the coordinator archives it
- **THEN** its `archived_at` is set
- **AND** its `deactivated_at` and its published versions are unchanged

#### Scenario: An active template cannot be archived

- **GIVEN** a published template whose `deactivated_at` is null
- **WHEN** the coordinator attempts to archive it
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains null

#### Scenario: Archiving does not touch what was inspected with it

- **GIVEN** a retired template with a submitted inspection frozen against one of its versions
- **WHEN** the template is archived
- **THEN** that inspection still resolves the same `template_version_id` and document
- **AND** the version is still readable by its own identifier

#### Scenario: Only the coordinator archives

- **WHEN** an account that is not the coordinator attempts to archive a retired template
- **THEN** the request is refused
- **AND** the template's `archived_at` is unchanged

### Requirement: Archived templates are hidden by default and are restored before being reactivated

The console SHALL omit templates whose `archived_at` is non-null from the default published list,
and SHALL offer the coordinator a control to show them. A shown archived template SHALL be
identified as `Archived` and SHALL offer restoration as its only act.

Restoring SHALL clear `archived_at` and SHALL leave `deactivated_at` non-null: the template returns
to the default list as `Deactivated`, from where reactivating it is a separate decision. An attempt
to reactivate an archived template SHALL be refused with a stated reason, so that a template never
becomes offerable for scheduling again through an act nobody took, and an attempt to restore one
that is not archived SHALL be refused the same way.

The templates offered for scheduling SHALL NOT be affected by archiving: they are already the
active ones, and an archived template is retired by definition.

#### Scenario: An archived template is not in the default list

- **GIVEN** one active published template and one archived published template
- **WHEN** the coordinator opens the template console
- **THEN** the published list shows the active one
- **AND** the archived one is omitted

#### Scenario: The coordinator shows and restores an archived template

- **GIVEN** an archived published template
- **WHEN** the coordinator shows archived templates and restores it
- **THEN** its `archived_at` is cleared
- **AND** its `deactivated_at` remains non-null
- **AND** it returns to the default list as `Deactivated`

#### Scenario: An archived template cannot be reactivated in one act

- **GIVEN** an archived published template
- **WHEN** the coordinator attempts to reactivate it
- **THEN** the request is refused with a stated reason
- **AND** both its `archived_at` and its `deactivated_at` remain set

#### Scenario: Archiving does not change what can be scheduled

- **GIVEN** a retired template that is then archived
- **WHEN** the templates available for scheduling are listed
- **THEN** the list is the same as before the template was archived

#### Scenario: A reader is offered no archive controls

- **WHEN** an account that is not the coordinator opens the template console
- **THEN** no control to show archived templates is offered
- **AND** no archive or restore act is offered

### Requirement: Publishing moves a template from the drafts to the published list

The system SHALL, when a draft is published, remove it from the drafts and show the template it
produced among the published templates without requiring the console to be reopened, so that the
act and its result are visible in one place.

#### Scenario: The console reflects a publication

- **GIVEN** the coordinator is looking at the template console with one live draft
- **WHEN** that draft is published
- **THEN** the drafts no longer include it
- **AND** the published templates include the template it produced

### Requirement: A published version can be read back by its own identity

The system SHALL let an authenticated account read a published template version by the
identifier of that version, without a scheduled inspection standing against it. The response
SHALL carry the frozen `document` together with the identity needed to name it: `template_id`,
`template_version_id`, the template's `key` and `name`, the `version` number and the
`published_at` timestamp of that version.

The read SHALL resolve the version whose identifier was asked for, never the highest published
version of its template. A published version's content SHALL NOT change under a stored link:
reading the same identifier twice SHALL return the same document.

The read SHALL be available on the same terms as the list of templates offered for scheduling.
A template carries no `site_id` and no row-level policy, so the response SHALL NOT depend on
which plants the reading account is scoped to, and SHALL NOT be restricted to the role that
authors templates.

#### Scenario: A published version is read by identity

- **GIVEN** a template published with `latest_version` 1 and `latest_version_id` `V`
- **WHEN** an authenticated account reads the published version `V`
- **THEN** the response carries `template_version_id` `V`, `version` 1, the template's `key`
  and `name`, and the `published_at` of that version
- **AND** the `document` is the one that was frozen at publication, section for section and
  item for item

#### Scenario: The read is not the latest version

- **GIVEN** a template whose versions `1` and `2` are both published
- **WHEN** the identifier of version `1` is read
- **THEN** the response carries `version` 1 and the document of version `1`

#### Scenario: A role that cannot author templates can still read one

- **GIVEN** a published template version
- **WHEN** an account whose role is `inspector` reads it
- **THEN** the response is the same document the coordinator reads

#### Scenario: The account's plants do not change the answer

- **GIVEN** a template published from a draft written for St. Thomas only
- **WHEN** an account scoped to Glencoe reads that version
- **THEN** the response is returned in full

#### Scenario: An unknown version is refused as not found

- **WHEN** an identifier that names no `template_version` row is read
- **THEN** the request is refused as not found
- **AND** the response carries no partial document

### Requirement: The published version is offered as reading, never as editing

The system SHALL present a published version as a read-only record. The interface that shows it
SHALL NOT offer any way to change its questions, its order, its response types or its prescribed
corrective actions, and SHALL state that what is shown is frozen and that correcting a template
means publishing a new version.

It SHALL offer the coordinator the act that statement names — starting a revision — and
nothing else. That action writes a draft; it does not make the version editable.

The settings that determine how a question is completed SHALL be legible: its `prompt`, its
`item_key`, whether it is `required`, its `response_type` and that response type's configuration.
That configuration SHALL include bounds, lengths, decimal places, selection limits, photo limits
or choice labels and values whenever the discriminated response type declares them. The interface
SHALL also show the condition under which a question is visible when it declares `visible_when`,
and the complete `finding` prescription when it carries one: its `corrective_action` and
`fails_when` threshold when present.

A section SHALL be shown with its `section_title`, in its published `position`, together with the
shared location it names when it declares one. Positions SHALL be expressed by display order
rather than by exposing their numeric values.

#### Scenario: A prescribed corrective action is shown with its question

- **GIVEN** a published version whose question carries a `finding` block with a
  `corrective_action`
- **WHEN** the version is read on screen
- **THEN** that corrective action is shown against that question

#### Scenario: Response configuration and requirement are shown

- **GIVEN** a published version whose required `multi_choice` question declares three `options`,
  `min_selected` 1 and `max_selected` 2
- **WHEN** the version is read on screen
- **THEN** the question is identified as required
- **AND** the three option labels and values and the two selection limits are shown against it

#### Scenario: A failure threshold is shown with its question

- **GIVEN** a published version whose number question carries a `finding.fails_when` with
  `operator` `gt` and `value` 80
- **WHEN** the version is read on screen
- **THEN** the threshold is shown against that question as a failure above 80

#### Scenario: A conditional question says what shows it

- **GIVEN** a published version whose question declares `visible_when`
- **WHEN** the version is read on screen
- **THEN** the question is shown together with the condition that reveals it, and not hidden

#### Scenario: No editing is offered

- **WHEN** a published version is read on screen
- **THEN** no control is offered that would rename, reorder, add, remove or retype anything in
  it
- **AND** the screen states that a published version is frozen

### Requirement: A published version offers the revision that corrects it

The system SHALL offer the coordinator, on the screen that shows a published version, the
single action that can correct it: starting a revision of its template. The action SHALL lead to
the editor for the seeded draft, and SHALL lead to the live revision draft when one already
exists rather than announcing a conflict.

The action SHALL NOT be offered to any other role, and its presence SHALL NOT make the version
itself editable: what the screen shows stays frozen, and the correction happens in a draft.

#### Scenario: The coordinator starts a revision from the version

- **GIVEN** the coordinator reading a published version
- **WHEN** the revision action is used
- **THEN** the editor opens on a draft seeded from that template's latest version

#### Scenario: The revision action leads to the work in progress

- **GIVEN** a template with a live revision draft
- **WHEN** the coordinator uses the revision action on that template's published version
- **THEN** the editor opens on that same draft

#### Scenario: An inspector is offered no revision

- **WHEN** an account whose role is `inspector` reads a published version
- **THEN** no revision action is offered
