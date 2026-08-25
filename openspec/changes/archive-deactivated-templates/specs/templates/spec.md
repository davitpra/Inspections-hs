## ADDED Requirements

### Requirement: A deactivated published template can be archived without losing anything

The system SHALL allow the HS coordinator to archive a published template only when its
`deactivated_at` is non-null. Archiving SHALL set `template.archived_at` and SHALL NOT delete the
`template` row, change any `template_version` document, or alter the schedule rules, scheduled
inspections and submitted inspections that name it: a template retired months ago is still the
reference of every inspection made with it, and archiving is a decision about a table, not about
the record.

An attempt to archive a template that is still active SHALL be refused with a stated reason, and
so SHALL an attempt to archive one that is already archived. Archiving SHALL be restricted to the
HS coordinator, on the same grounds as retiring one: it is the authoring console, and the
restriction is by role, not by site scope.

#### Scenario: A retired template is archived

- **GIVEN** a published template whose `deactivated_at` is non-null and whose `archived_at` is null
- **WHEN** the HS coordinator archives it
- **THEN** its `archived_at` is set
- **AND** its `deactivated_at` and its published versions are unchanged

#### Scenario: An active template cannot be archived

- **GIVEN** a published template whose `deactivated_at` is null
- **WHEN** the HS coordinator attempts to archive it
- **THEN** the request is refused with a stated reason
- **AND** its `archived_at` remains null

#### Scenario: Archiving does not touch what was inspected with it

- **GIVEN** a retired template with a submitted inspection frozen against one of its versions
- **WHEN** the template is archived
- **THEN** that inspection still resolves the same `template_version_id` and document
- **AND** the version is still readable by its own identifier

#### Scenario: Only the HS coordinator archives

- **WHEN** an account that is not the HS coordinator attempts to archive a retired template
- **THEN** the request is refused
- **AND** the template's `archived_at` is unchanged

### Requirement: Archived templates are hidden by default and are restored before being reactivated

The console SHALL omit templates whose `archived_at` is non-null from the default published list,
and SHALL offer the HS coordinator a control to show them. A shown archived template SHALL be
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
- **WHEN** the HS coordinator opens the template console
- **THEN** the published list shows the active one
- **AND** the archived one is omitted

#### Scenario: The coordinator shows and restores an archived template

- **GIVEN** an archived published template
- **WHEN** the HS coordinator shows archived templates and restores it
- **THEN** its `archived_at` is cleared
- **AND** its `deactivated_at` remains non-null
- **AND** it returns to the default list as `Deactivated`

#### Scenario: An archived template cannot be reactivated in one act

- **GIVEN** an archived published template
- **WHEN** the HS coordinator attempts to reactivate it
- **THEN** the request is refused with a stated reason
- **AND** both its `archived_at` and its `deactivated_at` remain set

#### Scenario: Archiving does not change what can be scheduled

- **GIVEN** a retired template that is then archived
- **WHEN** the templates available for scheduling are listed
- **THEN** the list is the same as before the template was archived

#### Scenario: A reader is offered no archive controls

- **WHEN** an account that is not the HS coordinator opens the template console
- **THEN** no control to show archived templates is offered
- **AND** no archive or restore act is offered

## MODIFIED Requirements

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

The console SHALL show the published templates to the HS coordinator only, on the same grounds
the drafts are: it is the authoring console, and the restriction is by role, not by site scope.

#### Scenario: A published template appears in the console

- **GIVEN** a template published from a draft
- **WHEN** the HS coordinator opens the template console
- **THEN** the published templates include it with its `key` and version `1`
- **AND** it is not listed among the drafts

#### Scenario: A seeded template appears the same way

- **GIVEN** a template loaded by a seed file
- **WHEN** the HS coordinator opens the template console
- **THEN** it appears among the published templates
- **AND** nothing distinguishes it from one published through the interface

#### Scenario: A draft is not listed as published

- **GIVEN** a live draft whose document is publishable
- **WHEN** the HS coordinator opens the template console
- **THEN** it appears among the drafts
- **AND** it does not appear among the published templates

#### Scenario: An organisation with nothing published is told what fills the list

- **GIVEN** no template has a published version
- **WHEN** the HS coordinator opens the template console
- **THEN** the published templates section states that publishing a draft is what fills it

#### Scenario: An archived template is not counted among the published

- **GIVEN** one published template that is archived
- **WHEN** the HS coordinator opens the template console
- **THEN** the published templates section does not list it
- **AND** the count it reports does not include it
