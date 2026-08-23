## ADDED Requirements

### Requirement: A publishable draft becomes version 1 of a new template

The system SHALL publish a live draft on the HS coordinator's request, writing in one
transaction the `template` row carrying the draft's `key` and `name`, one `template_item` row
per `item_key` the document declares, and one `template_version` row carrying `version` 1 and
the draft document with its positions derived from list order.

The `template_version_item` rows SHALL NOT be written by the publishing request: they are
derived from the document by the engine, so that a template published from a draft and a
template loaded by a seed are projected by the same rule and cannot disagree.

The system SHALL record on the version the account that published it, and SHALL report to the
publisher the identity of the template, the identity of the version, and its version number,
so that the interface can name what was created rather than only that something was.

#### Scenario: Publishing writes the template, its items and its version

- **GIVEN** a live draft whose document is publishable, with two sections of two questions each
- **WHEN** the HS coordinator publishes it
- **THEN** a `template` row exists carrying the draft's `key` and `name`
- **AND** a `template_version` row exists for that template with `version` 1
- **AND** its `document` holds the four questions
- **AND** a `template_item` row is registered for each of the four `item_key` values
- **AND** the response names the `template_id`, the `template_version_id` and `version` 1

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

### Requirement: Order at publication is the order of the draft's elements

The system SHALL assign, when a draft is published, section positions in list order starting
at one and, within each section, item positions in list order starting at one. The draft
carries no position of its own, so the order the author sees is the order that is frozen.

#### Scenario: List order becomes position

- **GIVEN** a live draft whose second section holds three questions
- **WHEN** it is published
- **THEN** that section's `template_version_item` rows carry positions 1, 2 and 3 in the order
  the author arranged them
- **AND** the published document declares the same positions

### Requirement: An unpublishable draft is refused and writes nothing

The system SHALL refuse to publish a draft whose document is not publishable, SHALL report the
refusal as `template_draft_not_publishable` carrying the same issues that reading the draft
reports, and SHALL leave the draft live and unchanged.

The publishability of a draft SHALL be decided by the same shared rules that decide it when the
draft is read, so that a draft the interface reports as ready is never refused at publication
and a draft it reports as incomplete is never accepted.

#### Scenario: A draft with an empty section is refused

- **GIVEN** a live draft with a section that has no questions
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused as `template_draft_not_publishable`
- **AND** the refusal carries the issue naming that section
- **AND** no `template`, `template_item` or `template_version` row is written
- **AND** the draft is still live

#### Scenario: An empty draft is refused

- **GIVEN** a live draft whose document has no sections
- **WHEN** the HS coordinator publishes it
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
- **WHEN** the HS coordinator publishes it again
- **THEN** the request is refused as `template_draft_not_found`
- **AND** the number of `template` and `template_version` rows is unchanged

#### Scenario: A published draft cannot be discarded

- **GIVEN** a draft that has been published
- **WHEN** it is discarded
- **THEN** the request is refused as `template_draft_not_found`
- **AND** its `discarded_at` is still absent

### Requirement: Publishing releases the name and key the draft held

The system SHALL stop counting a published draft among the live drafts for the purpose of name
and key uniqueness, because from the moment it is published the authoritative holder of that key
is the `template` row it created, whose `key` is unique across every published template.

A new draft SHALL therefore be refused the name of a published template on the same grounds it is
refused the name of a live draft, and not because the consumed draft still holds it.

#### Scenario: A published draft no longer holds its name against a new draft

- **GIVEN** a draft named `Monthly general inspection` that has been published
- **WHEN** a coordinator creates a draft named `Monthly general inspection`
- **THEN** the request is refused
- **AND** the refusal names the published template rather than a live draft

### Requirement: A key already held by a published template is refused at publication

The system SHALL refuse a publication whose derived key already belongs to a published template,
report it as `template_key_taken`, and leave the draft live and unchanged with no partial record
written.

The check when a draft is named is a courtesy so that the author learns early; it cannot be a
guarantee, because a template may be published under that key between the naming and the
publication. The refusal at publication is the authoritative one.

#### Scenario: Publishing under a key a seeded template already holds is refused

- **GIVEN** a seeded template whose `key` is `monthly-general-inspection`
- **AND** a live publishable draft whose derived key is `monthly-general-inspection`
- **WHEN** the HS coordinator publishes the draft
- **THEN** the request is refused as `template_key_taken`
- **AND** the draft is still live
- **AND** no new `template` row exists

### Requirement: Publication is all or nothing

The system SHALL write the template, its registered items and its version in a single
transaction, so that a refusal at any point leaves no trace: no template without a version, no
registered `item_key` belonging to a template that does not exist, and no draft marked as
published.

A template row without a version would be invisible to every reader of published templates and
would hold its key forever, which is the worst of both outcomes: the coordinator could neither
schedule it nor publish it again under the same name.

#### Scenario: A refused publication leaves no template row

- **GIVEN** a live publishable draft whose derived key already belongs to a published template
- **WHEN** the HS coordinator publishes it
- **THEN** the number of `template`, `template_item` and `template_version` rows is unchanged
- **AND** the draft's `published_at` is absent

#### Scenario: An item_key already registered stops the whole publication

- **GIVEN** a live publishable draft one of whose `item_key` values is already registered in
  `template_item`
- **WHEN** the HS coordinator publishes it
- **THEN** the request is refused
- **AND** no `template` row exists carrying the draft's `key`
- **AND** the draft is still live

### Requirement: Publishing a template is the HS coordinator's

The system SHALL restrict publishing a template draft to the HS coordinator, and SHALL refuse
every other role as `template_draft_forbidden`, the same code the other acts on a draft use: for
every role but one, a draft is a document that does not exist.

#### Scenario: A non-coordinator cannot publish

- **WHEN** an account whose role is `supervisor` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template` or `template_version` row is written

### Requirement: A published template is offered for scheduling immediately

The system SHALL offer a template published from a draft in the list of templates available for
scheduling, on the same terms as a seeded one, with the version number and version identity of
the version just published.

#### Scenario: The template appears in the scheduling list

- **GIVEN** a live publishable draft
- **WHEN** it is published and the templates available for scheduling are listed
- **THEN** the list includes it with `latest_version` 1
- **AND** its `latest_version_id` is the version the publication produced

### Requirement: The plants a draft named do not travel to the published template

The system SHALL NOT record a draft's `site_ids` on the template it publishes. A template
carries no `site_id` and no row-level policy, and the scope stated while authoring is a
statement about where the template was being written for, not a property of the record it
becomes.

The scope SHALL have already had its whole effect on the document: it decided which shared
locations each section could name, and those codes are written into the document that is frozen.
A published template SHALL therefore be offered for scheduling at every plant, exactly as a
seeded template is.

#### Scenario: A single-plant draft publishes to an unscoped template

- **GIVEN** a live publishable draft whose `site_ids` names only St. Thomas
- **WHEN** it is published
- **THEN** the `template` row carries no plant
- **AND** the templates available for scheduling include it for an account scoped to Glencoe

## MODIFIED Requirements

### Requirement: Authoring a template is the HS coordinator's

The system SHALL restrict reading, creating, saving, discarding and publishing a template draft
to the HS coordinator, and SHALL refuse every other role with a code the interface can act on
rather than a message it must parse.

The restriction SHALL be by role and not by site scope, because a template carries no `site_id` by
design and a draft's `site_ids` describes where it is intended to be used rather than whose data
it is. A draft remains organisation reference content, and restricting visibility by plant would
reintroduce the per-plant duplication the model exists to avoid.

#### Scenario: A non-coordinator cannot read drafts

- **WHEN** an account whose role is `jhsc_member` lists the template drafts
- **THEN** the request is refused as `template_draft_forbidden`

#### Scenario: A non-coordinator cannot save a draft

- **WHEN** an account whose role is `supervisor` saves an existing draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** the stored draft is unchanged

#### Scenario: A non-coordinator cannot publish a draft

- **WHEN** an account whose role is `jhsc_member` publishes a draft
- **THEN** the request is refused as `template_draft_forbidden`
- **AND** no `template_version` row is written

#### Scenario: Drafts do not depend on the requester's site scope

- **WHEN** two coordinator accounts whose scopes cover different plants list the drafts
- **THEN** both receive the same entries

### Requirement: A draft is a working document, not a version

The system SHALL keep an in-progress template as a `template_draft` record, separate from
`template_version` in every respect: it is mutable, it may be incomplete, it carries no version
number, and it is not reachable from any inspection, finding or record.

A draft SHALL carry its own `name`, a `key` derived from it, and a `document` holding the
sections and items being authored. Creating or saving a draft SHALL NOT write to `template`,
`template_item`, `template_version` or `template_version_item`: a draft that has never been
published SHALL be invisible to every reader of published templates, including the list offered
for scheduling.

Publishing a draft SHALL be the only act that writes those rows, and SHALL end the draft's life
as a working document rather than turning the draft into the version. The `template_draft` row
that was published SHALL name the `template_version` it produced, so that the version's origin is
recorded, and SHALL remain a separate record from it.

The two SHALL NOT be conflated. A published version is the record an inspection is bound to and a
regulator reads; a draft is scratch work. Storing a draft as a version — even a version marked
"unpublished" — would make the immutable table mutable, which is the one thing the model exists to
prevent.

#### Scenario: A draft is not offered for scheduling

- **GIVEN** a saved draft whose `document` is complete
- **WHEN** the templates available for scheduling are listed
- **THEN** the draft is not in the list
- **AND** no `template` row exists carrying the draft's `key`

#### Scenario: Saving a draft leaves the published model untouched

- **WHEN** a draft is created and then saved three times
- **THEN** the number of `template`, `template_item`, `template_version` and
  `template_version_item` rows is unchanged

#### Scenario: A draft is edited in place, not versioned

- **GIVEN** a draft whose `document` has one section
- **WHEN** a second section is added and the draft is saved
- **THEN** reading the draft returns both sections
- **AND** only one `template_draft` row exists for that draft

#### Scenario: A published draft and its version are two records

- **WHEN** a live draft is published
- **THEN** the `template_draft` row and the `template_version` row both exist
- **AND** the draft row names the version through `template_version_id`

### Requirement: A draft is discarded, never deleted

The system SHALL retire a draft by setting `discarded_at` rather than by deleting it. A discarded
draft SHALL be absent from the list of drafts, and deleting a `template_draft` row SHALL be refused
by the engine for every role.

Discarding and publishing SHALL be mutually exclusive ends for a draft, and the engine SHALL
refuse a row that records both. They are different facts about the same work — one says the author
threw it away, the other says it became a frozen record — and a row that claimed both would leave
no way to tell which happened.

#### Scenario: Discarding hides the draft and keeps the row

- **WHEN** a draft is discarded
- **THEN** it is absent from the list of drafts
- **AND** its `template_draft` row still exists with `discarded_at` set

#### Scenario: Deletion is refused by the engine

- **WHEN** a `template_draft` row is deleted as the application role
- **THEN** the statement fails
- **AND** deleting it as the migration role fails on the guard trigger

#### Scenario: The key of a draft cannot be rewritten

- **WHEN** `template_draft.key` is updated as the application role
- **THEN** the statement fails on insufficient privilege

#### Scenario: A row cannot record both ends

- **WHEN** a `template_draft` row is written with both `discarded_at` and `published_at` set
- **THEN** the statement fails on a check constraint
