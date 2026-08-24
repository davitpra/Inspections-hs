# templates

## ADDED Requirements

### Requirement: Revising a published template seeds a draft from its latest version

The system SHALL create, on the HS coordinator's request over a published template, a
`template_draft` bound to that template through `template_draft.template_id`, whose `document`
is the document of the template's latest published version with its positions dropped, whose
`key` and `name` are the template's own, and whose `site_ids` are the active plants of the
requesting account.

Every `item_key` the latest version declares SHALL appear unchanged in the seeded draft, because
carrying the concept forward is the whole point of revising rather than starting over.

The request SHALL be refused as `template_not_found` when the template does not exist or has been
deactivated, and as `template_version_not_found` when it has no published version. It SHALL be
restricted to the HS coordinator and refused to every other role as `template_draft_forbidden`.

#### Scenario: The seeded draft repeats the published document

- **GIVEN** a template published at version 2 with two sections of two questions each
- **WHEN** the HS coordinator revises it
- **THEN** a draft exists whose `template_id` is that template
- **AND** its document declares the same four `item_key` values in the same order
- **AND** its `key` and `name` are the template's `key` and `name`

#### Scenario: The seeded draft carries no position

- **GIVEN** a template whose published document declares positions
- **WHEN** the HS coordinator revises it
- **THEN** the stored draft document declares no `position` on any section or item

#### Scenario: The published model is untouched by seeding

- **WHEN** a template is revised
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A non-coordinator cannot revise

- **WHEN** an account whose role is `supervisor` revises a published template
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_draft` row is written

#### Scenario: A template with no published version cannot be revised

- **GIVEN** a `template` row with no `template_version`
- **WHEN** the HS coordinator revises it
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
- **WHEN** the HS coordinator revises that template again
- **THEN** the response names the draft that already exists
- **AND** only one live `template_draft` row has that `template_id`

#### Scenario: A second live revision is rejected by the engine

- **WHEN** a second `template_draft` row is inserted with the `template_id` of a template that
  already has a live revision draft
- **THEN** the insert fails with a unique violation

#### Scenario: A discarded revision frees the template

- **GIVEN** a template whose revision draft has been discarded
- **WHEN** the HS coordinator revises that template
- **THEN** a new draft is created

### Requirement: A revision draft carries the identity of its template

The system SHALL treat `template_draft.template_id` as write-once and SHALL NOT offer any way to
change it: a draft does not change which template it revises halfway through.

A revision draft SHALL hold the `key` and the `name` of its template deliberately, and SHALL NOT
count against the uniqueness of a live draft's key or name. The authoritative holder of that key
is the `template` row, whose `key` is unique across every published template; counting the
revision as a second holder would refuse the coordinator the correction of his own template.

The system SHALL refuse a save that changes a revision draft's `name`, reporting it as
`template_draft_name_locked`. A published template's `name` is not modifiable by any role, so a
name the editor accepted and the publication ignored would leave two answers to the same
question in the record.

#### Scenario: The revision does not block a new draft by another name

- **GIVEN** a live revision draft of the template named `Monthly general inspection`
- **WHEN** a coordinator creates a draft named `Weekly forklift check`
- **THEN** the request succeeds

#### Scenario: Renaming a revision is refused

- **GIVEN** a live revision draft named `Monthly general inspection`
- **WHEN** a save is submitted for it carrying the name `Monthly plant inspection`
- **THEN** the request is refused as `template_draft_name_locked`
- **AND** the stored draft is unchanged

#### Scenario: The editor does not offer the name for editing

- **WHEN** a revision draft is opened in the builder
- **THEN** the template name is shown as read-only alongside the key
- **AND** the screen states which template is being revised

### Requirement: A publishable draft becomes the next version of its template

The system SHALL publish a live draft on the HS coordinator's request, writing in one
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
- **WHEN** the HS coordinator publishes it
- **THEN** a `template` row exists carrying the draft's `key` and `name`
- **AND** a `template_version` row exists for that template with `version` 1
- **AND** a `template_item` row is registered for each of the four `item_key` values
- **AND** the response names the `template_id`, the `template_version_id` and `version` 1

#### Scenario: Publishing a revision writes only a version

- **GIVEN** a template published at version 1 and a publishable revision draft of it
- **WHEN** the HS coordinator publishes the revision
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
- **WHEN** the HS coordinator publishes it
- **THEN** one `template_version_item` row exists for every question of the document
- **AND** each row carries the `item_key`, `section_key`, `prompt`, `response_type` and
  `required` the document declared

#### Scenario: The version records who published it

- **WHEN** a coordinator publishes a draft
- **THEN** the `template_version` row's `published_by` names that account
- **AND** its `published_at` is set

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
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused as `template_item_key_taken`
- **AND** no `template_version` row is written for the template being revised
- **AND** the draft is still live

#### Scenario: A deactivated key stops the publication

- **GIVEN** a revision draft declaring an `item_key` whose `template_item` row carries
  `deactivated_at`
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused as `template_item_deactivated`
- **AND** the refusal names that `item_key`
- **AND** the draft is still live

### Requirement: A question removed from a revision is absent, not retired

The system SHALL, when a revision omits a question the previous version declared, leave that
question out of the new version and change nothing else. The `template_item` row SHALL keep its
`deactivated_at` absent, the `template_version_item` rows of the versions that declared it SHALL
still resolve it, and grouping findings by `item_key` SHALL still return its series, now ended.

Removing a question from the next version and retiring the concept are two different decisions.
Deleting a row in the editor states the first, not the second.

#### Scenario: The omitted question keeps its history

- **GIVEN** a template published at version 1 with a finding recorded against
  `guards.packaging-lines`
- **WHEN** a revision that omits that question is published as version 2
- **THEN** no version 2 `template_version_item` row carries `guards.packaging-lines`
- **AND** the `template_item` row for it has `deactivated_at` absent
- **AND** grouping findings by `item_key` still returns its series with a count of 1

### Requirement: A published version offers the revision that corrects it

The system SHALL offer the HS coordinator, on the screen that shows a published version, the
single action that can correct it: starting a revision of its template. The action SHALL lead to
the editor for the seeded draft, and SHALL lead to the live revision draft when one already
exists rather than announcing a conflict.

The action SHALL NOT be offered to any other role, and its presence SHALL NOT make the version
itself editable: what the screen shows stays frozen, and the correction happens in a draft.

#### Scenario: The coordinator starts a revision from the version

- **GIVEN** the HS coordinator reading a published version
- **WHEN** the revision action is used
- **THEN** the editor opens on a draft seeded from that template's latest version

#### Scenario: The revision action leads to the work in progress

- **GIVEN** a template with a live revision draft
- **WHEN** the HS coordinator uses the revision action on that template's published version
- **THEN** the editor opens on that same draft

#### Scenario: An inspector is offered no revision

- **WHEN** an account whose role is `inspector` reads a published version
- **THEN** no revision action is offered

### Requirement: The builder names the version a publication will create

The system SHALL report on a draft the number the version it publishes will carry, and the
interface SHALL name that number where it asks the coordinator to confirm the publication,
rather than always naming version 1.

A coordinator confirming a point of no return is entitled to know which record he is about to
write. The number SHALL be read when the draft is read: it is what the next publication would
produce, not a reservation.

#### Scenario: The confirmation names version 2

- **GIVEN** a revision draft of a template published at version 1
- **WHEN** the coordinator is asked to confirm the publication
- **THEN** the confirmation names version 2

#### Scenario: The confirmation of a first publication names version 1

- **GIVEN** a live draft that names no template
- **WHEN** the coordinator is asked to confirm the publication
- **THEN** the confirmation names version 1

## MODIFIED Requirements

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
- **WHEN** the HS coordinator publishes it
- **THEN** the number of `template`, `template_item` and `template_version` rows is unchanged
- **AND** the draft's `published_at` is absent

#### Scenario: An item_key registered to another template stops the whole publication

- **GIVEN** a live publishable draft one of whose `item_key` values is already registered in
  `template_item` under a different template
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused
- **AND** no `template` row exists carrying the draft's `key`
- **AND** the draft is still live

#### Scenario: A refused revision leaves the template at its previous version

- **GIVEN** a template published at version 1 and a revision draft that is refused at publication
- **WHEN** the HS coordinator publishes it
- **THEN** the highest `template_version` for that template is still 1
- **AND** the draft's `published_at` is absent

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
- **WHEN** the HS coordinator publishes the draft
- **THEN** the request is refused as `template_key_taken`
- **AND** the draft is still live
- **AND** no new `template` row exists

#### Scenario: A revision publishes under the key it holds

- **GIVEN** a publishable revision draft whose `key` is `monthly-general-inspection`, the key of
  the template it revises
- **WHEN** the HS coordinator publishes it
- **THEN** the request succeeds
- **AND** the number of `template` rows is unchanged

### Requirement: Publishing releases the name and key the draft held

The system SHALL stop counting a published draft among the live drafts for the purpose of name
and key uniqueness, because from the moment it is published the authoritative holder of that key
is the `template` row, whose `key` is unique across every published template.

A revision draft SHALL never have counted, for the same reason read the other way round: the
`template` row already holds that key and that name, and the draft is a correction of that very
row.

A new draft SHALL therefore be refused the name of a published template on the same grounds it
is refused the name of a live draft, and not because a consumed draft or a revision still holds
it.

#### Scenario: A published draft no longer holds its name against a new draft

- **GIVEN** a draft named `Monthly general inspection` that has been published
- **WHEN** a coordinator creates a draft named `Monthly general inspection`
- **THEN** the request is refused
- **AND** the refusal names the published template rather than a live draft

#### Scenario: A revision does not hold its name against a new draft either

- **GIVEN** a live revision draft of the template named `Monthly general inspection`
- **WHEN** a coordinator creates a draft named `Monthly general inspection`
- **THEN** the request is refused
- **AND** the refusal names the published template rather than a live draft

### Requirement: A draft is a working document, not a version

The system SHALL keep an in-progress template as a `template_draft` record, separate from
`template_version` in every respect: it is mutable, it may be incomplete, it carries no version
number, and it is not reachable from any inspection, finding or record.

A draft SHALL carry its own `name`, a `key`, and a `document` holding the sections and items
being authored. It SHALL also carry `template_id`, naming the published template it revises when
it revises one and absent when it will create one; that column decides what publishing it means
and nothing else about how it is written, saved or discarded.

Creating or saving a draft SHALL NOT write to `template`, `template_item`, `template_version` or
`template_version_item`: a draft that has never been published SHALL be invisible to every reader
of published templates, including the list offered for scheduling, whether it revises a template
or not.

The two SHALL NOT be conflated. A published version is the record an inspection is bound to and a
regulator reads; a draft is scratch work. Storing a draft as a version — even a version marked
"unpublished" — would make the immutable table mutable, which is the one thing the model exists to
prevent.

#### Scenario: A draft is not offered for scheduling

- **GIVEN** a saved draft whose `document` is complete
- **WHEN** the templates available for scheduling are listed
- **THEN** the draft is not in the list
- **AND** no `template` row exists carrying the draft's `key`

#### Scenario: A revision does not change what is offered for scheduling

- **GIVEN** a template published at version 1 with a live revision draft
- **WHEN** the templates available for scheduling are listed
- **THEN** the template is listed with `latest_version` 1

#### Scenario: Saving a draft leaves the published model untouched

- **WHEN** a draft is created and then saved three times
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A draft is edited in place, not versioned

- **GIVEN** a draft whose `document` has one section
- **WHEN** a second section is added and the draft is saved
- **THEN** reading the draft returns both sections
- **AND** only one `template_draft` row exists for that draft

### Requirement: The published version is offered as reading, never as editing

The system SHALL present a published version as a read-only record. The interface that shows it
SHALL NOT offer any way to change its questions, its order, its response types or its prescribed
corrective actions, and SHALL state that what is shown is frozen and that correcting a template
means publishing a new version.

It SHALL offer the HS coordinator the act that statement names — starting a revision — and
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

## REMOVED Requirements

### Requirement: A publishable draft becomes version 1 of a new template

**Reason**: Publishing is no longer restricted to creating a template. A draft becomes the next
version of its template, which is version 1 only when the draft names no template.

**Migration**: Replaced by `### Requirement: A publishable draft becomes the next version of its
template`, which keeps every scenario of the removed requirement — the derived
`template_version_item` rows, the recorded publisher, and the first publication writing
`template`, `template_item` and `version` 1 — and adds the revision branch.
