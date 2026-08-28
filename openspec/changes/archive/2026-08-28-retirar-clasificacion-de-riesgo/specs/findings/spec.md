## MODIFIED Requirements

### Requirement: A finding can be entered by hand and then has no item key

The system SHALL accept a manually entered finding — a hazard seen outside an inspection — from a
supervisor, manager or the HS coordinator, carrying its site, description, location and photos. A
manually entered finding SHALL have `inspection_id`, `template_version_item_id` and `item_key` all
null, and a derived finding SHALL have all three set; the engine SHALL enforce that exactly one of
the two origins holds. A manually entered finding SHALL therefore be absent from any grouping by
`item_key`, which is the accepted consequence recorded in §4 and risk F.

#### Scenario: A supervisor reports a hazard seen outside an inspection

- **WHEN** a supervisor posts a finding with a site, a description, a `location_id` and one object
  key
- **THEN** a `finding` row is created with `origin` `manual`
- **AND** its `inspection_id`, `template_version_item_id` and `item_key` are null

#### Scenario: A manual finding carrying a classification is refused

- **WHEN** a supervisor posts a manual finding carrying a `classification`
- **THEN** the request is rejected and no `finding` row is created

#### Scenario: A half-derived finding cannot exist

- **WHEN** a `finding` row is inserted with an `inspection_id` but no `item_key`
- **THEN** the insert fails on the origin check constraint

#### Scenario: A manual finding is outside recurrence

- **GIVEN** a site with two derived findings for `dock.guards` and one manual finding describing
  the same hazard
- **WHEN** the site's findings are grouped by `item_key`
- **THEN** the manual finding is in no group

### Requirement: Findings are read within the reader's site scope

The system SHALL return findings only for the sites in the session's scope, enforced by the row
level security policy on `finding` and `finding_photo` and not by a `WHERE site_id` clause in the
endpoint. A listing SHALL carry, for each finding, its origin, its description, its location and
its photos. A request for a finding outside the session's scope SHALL be answered exactly as one
for a finding that does not exist.

#### Scenario: A JHSC member of one site does not see the other's findings

- **GIVEN** findings in St. Thomas and in Glencoe
- **WHEN** a JHSC member scoped to St. Thomas lists findings
- **THEN** only the St. Thomas findings are returned

#### Scenario: The coordinator sees both sites

- **WHEN** the HS coordinator, scoped to both sites, lists findings
- **THEN** findings of both sites are returned

#### Scenario: A finding of the other site is indistinguishable from a missing one

- **WHEN** a JHSC member scoped to St. Thomas requests a Glencoe finding by id
- **THEN** the response is `finding_not_found`
- **AND** the body reveals nothing about its site, location or description

#### Scenario: A listing carries no classification

- **GIVEN** a finding of the reader's site
- **WHEN** it is listed
- **THEN** the finding carries no `assessment`, `risk_level`, `probability` or `control_level`

## REMOVED Requirements

### Requirement: Classification is an append-only chain, never an edit

**Reason**: Evaluating the risk of a finding is withdrawn from the system before any deployment
carrying production data. With no classification there is no chain to keep append-only.

**Migration**: None. The `finding_risk_assessment` table is dropped and
`POST /findings/:id/risk-assessments` no longer exists. The `finding.classified` links already
written in `audit_log` are neither deleted nor rewritten.

### Requirement: The risk level is computed by the engine from probability and severity

**Reason**: The 5×5 matrix is withdrawn together with the classification it computed. No surviving
behaviour reads `risk_level`.

**Migration**: None. The `hs_risk_level` SQL function and its pure twin are dropped, and the
`probability`, `severity`, `risk_level` and `control_level` scales leave the shared contracts.

### Requirement: A classification records the level of the control hierarchy proposed

**Reason**: The control hierarchy level was recorded only as part of a classification; the
prescribed level had already been withdrawn from the template document.

**Migration**: None. No surviving read path exposed `control_level`.

### Requirement: Only the HS coordinator classifies

**Reason**: There is no act of classifying left to authorise.

**Migration**: None. Who may report a manual finding and who may open a corrective action are
unchanged and stated by their own requirements.
