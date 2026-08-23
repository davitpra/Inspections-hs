## ADDED Requirements

### Requirement: The authoring console lists the published templates

The system SHALL show, in the console where templates are authored, the templates that have a
published version, separately from the drafts and clearly distinguished from them: a draft is
work in progress and a published template is a frozen record, and a list that mixed them would
invite the coordinator to treat one as the other.

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

### Requirement: Publishing moves a template from the drafts to the published list

The system SHALL, when a draft is published, remove it from the drafts and show the template it
produced among the published templates without requiring the console to be reopened, so that the
act and its result are visible in one place.

#### Scenario: The console reflects a publication

- **GIVEN** the HS coordinator is looking at the template console with one live draft
- **WHEN** that draft is published
- **THEN** the drafts no longer include it
- **AND** the published templates include the template it produced

## MODIFIED Requirements

### Requirement: The templates offered for scheduling are those with a published version

The system SHALL expose the templates available to be scheduled, each carrying its `id`, its
`key`, its `name`, and the `version` number, `template_version_id` and publication timestamp of
its highest published version.

A template with no `template_version` row SHALL NOT be offered, because a schedule rule on such a
template is refused as `template_not_publishable`: a list that offered it would be offering a
rejection.

The version reported SHALL be resolved by **the same expression** the scheduler uses to freeze a
newly opened inspection, so that the version the list names and the version an inspection is bound
to cannot disagree. Reporting a version the scheduler would not choose would be silent: the
coordinator would read `2` on the screen and the inspection would open against `3`. The publication
timestamp reported SHALL be that of the same version, for the same reason.

The list SHALL NOT be restricted by site scope, because a template carries no `site_id` by design —
one monthly inspection for the organisation, not one per plant, which is what makes "the same guard
is missing at both plants" a question that can be asked at all. The response is therefore identical
for every requester.

#### Scenario: A template with no published version is not offered

- **GIVEN** a template with no `template_version` row
- **WHEN** the templates available for scheduling are listed
- **THEN** that template is not in the list
- **AND** creating a schedule rule for it is rejected as `template_not_publishable`

#### Scenario: The version reported is the version the scheduler freezes

- **GIVEN** a template whose highest published version is `3`
- **WHEN** the templates are listed and a period is then opened for a rule on that template
- **THEN** the listed `version` is `3`
- **AND** the created scheduled inspection's `template_version_id` is the listed
  `template_version_id`

#### Scenario: The key and the publication date name the same version

- **GIVEN** a template whose highest published version is `2`
- **WHEN** the templates are listed
- **THEN** the entry carries the template's `key`
- **AND** the reported publication timestamp is that of version `2`

#### Scenario: Publishing a new version moves the offer, not the frozen inspection

- **GIVEN** a scheduled inspection already open against version `2`
- **WHEN** version `3` is published and the templates are listed again
- **THEN** the listed version is `3`
- **AND** the existing scheduled inspection still reports `template_version_id` for version `2`

#### Scenario: The list does not depend on the requester's site scope

- **WHEN** two accounts whose scopes cover different plants list the templates
- **THEN** both receive the same entries
