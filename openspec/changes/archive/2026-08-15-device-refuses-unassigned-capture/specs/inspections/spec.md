## MODIFIED Requirements

### Requirement: The template version served is the one the inspection is bound to

The system SHALL serve the complete frozen document of the `template_version_id` recorded on
the scheduled inspection, together with that `template_version_id`, its `version` number, the
inspection's `site_id` and the inspection's `inspector_id`.

`inspector_id` SHALL be the account the inspection is assigned to, or `null` when it is
assigned to nobody. It SHALL be served so that a device can tell whose inspection it is
after it loses network, for the same reason `site_id` is served: what the device must know
about the inspection cannot depend on asking again later.

Serving `inspector_id` SHALL NOT narrow what the read returns to whom. A read remains
resolvable by any account whose session scope reaches the inspection, whether or not it is
the assigned one.

The system SHALL NEVER resolve the template version at read time — not as the highest
published version of the template, and not as the most recent one. Publishing a newer
version of a template SHALL NOT change what an already-scheduled inspection serves.

#### Scenario: The frozen document is returned with its identifiers

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** the device reads its template version
- **THEN** the response carries the document of version `2`, its `template_version_id`, the
  number `2`, the inspection's `site_id`, and the inspection's `inspector_id`

#### Scenario: An unassigned inspection serves a null inspector

- **GIVEN** a scheduled inspection whose `inspector_id` is `NULL`
- **WHEN** the device reads its template version
- **THEN** the response carries `inspector_id` as `null`
- **AND** the document, `template_version_id`, `version` and `site_id` are served as usual

#### Scenario: An account that is not the assigned inspector still reads the package

- **GIVEN** a scheduled inspection assigned to inspector A
- **WHEN** an account within the inspection's site scope that is not A reads its template
  version
- **THEN** the read succeeds and carries A as `inspector_id`

#### Scenario: Publishing a newer version does not change what is served

- **GIVEN** a scheduled inspection bound to version `2` of a template
- **WHEN** version `3` of that template is published and the device reads the inspection's
  template version again
- **THEN** the response still carries version `2`

#### Scenario: The served document is the one the shared engine accepts

- **WHEN** the template version of a scheduled inspection is read
- **THEN** the returned document parses against the shared template document schema
- **AND** the same answers validated against it on the device and on the server reach the
  same verdict
