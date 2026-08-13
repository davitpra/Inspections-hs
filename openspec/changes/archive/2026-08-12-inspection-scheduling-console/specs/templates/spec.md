## ADDED Requirements

### Requirement: The templates offered for scheduling are those with a published version

The system SHALL expose the templates available to be scheduled, each carrying its `id`, its
`name`, and the `version` number and `template_version_id` of its highest published version.

A template with no `template_version` row SHALL NOT be offered, because a schedule rule on such a
template is refused as `template_not_publishable`: a list that offered it would be offering a
rejection.

The version reported SHALL be resolved by **the same expression** the scheduler uses to freeze a
newly opened inspection, so that the version the list names and the version an inspection is bound
to cannot disagree. Reporting a version the scheduler would not choose would be silent: the
coordinator would read `2` on the screen and the inspection would open against `3`.

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

#### Scenario: Publishing a new version moves the offer, not the frozen inspection

- **GIVEN** a scheduled inspection already open against version `2`
- **WHEN** version `3` is published and the templates are listed again
- **THEN** the listed version is `3`
- **AND** the existing scheduled inspection still reports `template_version_id` for version `2`

#### Scenario: The list does not depend on the requester's site scope

- **WHEN** two accounts whose scopes cover different plants list the templates
- **THEN** both receive the same entries
