## Purpose

Groups findings into series across template versions so that the same hazard failing month after
month is visible as one pattern rather than as unrelated rows, using the stable item concept and
the closed location catalogue as the grouping keys, over a configurable window of time.

Reports, per site and per monthly period, which inspections were completed and which were missed,
and turns that coverage into evidence: a frozen report whose canonical JSON payload carries a
SHA-256 digest printed on every page of the rendered PDF. The digest covers the payload and never
the file, because a document produced by a headless browser is not reproducible byte for byte
while its payload is.

## Requirements

### Requirement: Findings group into series by the stable item concept, never by the published row

The system SHALL group findings into recurrence series by `finding.item_key` — the stable concept
of the item — and SHALL NEVER group by `finding.template_version_item_id`, which identifies the
published row of one template version. Editing an item's wording, moving it to another section,
reordering it or changing its response type SHALL NOT split a series, because none of those
operations changes `item_key`. A series SHALL report how many distinct
`template_version_item_id` values it spans, so that a reader can see the series crossed a
template edit.

#### Scenario: Three template versions with realistic edits yield one series of four

- **GIVEN** a template item created in version `1` producing one finding
- **AND** version `2` of the same template, where the item's `prompt` was rewritten, its
  `section_key` changed and its `position` moved, producing two findings
- **AND** version `3`, where the item's `response_type` changed from `yes_no` to `yes_no_na`,
  producing one finding
- **WHEN** the site's recurrence series are read
- **THEN** exactly one series is returned for that `item_key`
- **AND** its `occurrence_count` is `4`
- **AND** its `template_version_item_count` is `3`

#### Scenario: Grouping by the published row is not offered

- **WHEN** recurrence series are requested with any combination of parameters
- **THEN** no result groups two findings of the same `item_key` into different series because
  their `template_version_item_id` values differ

### Requirement: Two grouping keys answer two different questions

The system SHALL support exactly two recurrence groupings, selected by a `group_by` parameter:
`item_location`, which groups by `item_key` and `location_id` together, and `item`, which groups
by `item_key` alone across every location of the site. The default SHALL be `item_location`. A
series produced with `group_by` `item` SHALL report a null `location_id` and SHALL report how many
distinct locations it spans. A `group_by` value outside those two SHALL be rejected.

#### Scenario: The same item failing at two locations is two series by default

- **GIVEN** a site with three findings for `dock.guards` at `pack-line-3` and two for
  `dock.guards` at `shipping-bay`
- **WHEN** recurrence series are requested without a `group_by` parameter
- **THEN** two series are returned
- **AND** one carries `location_id` `pack-line-3` with `occurrence_count` `3`
- **AND** the other carries `location_id` `shipping-bay` with `occurrence_count` `2`

#### Scenario: The same findings collapse into one systemic series

- **GIVEN** the same five findings
- **WHEN** recurrence series are requested with `group_by` `item`
- **THEN** one series is returned for `dock.guards`
- **AND** its `occurrence_count` is `5`
- **AND** its `location_id` is null
- **AND** its `location_count` is `2`

#### Scenario: An unknown grouping is refused

- **WHEN** recurrence series are requested with `group_by` `template_version`
- **THEN** the request is rejected with the code `validation_failed`

### Requirement: The window is a parameter measured on the compliance clock

The system SHALL accept a `window_months` parameter between `1` and `60`, defaulting to `12`, and
SHALL include in a series only findings whose `occurred_at` falls within that many months before
the moment of the request. The window SHALL be evaluated against `occurred_at` — the device clock
at signing, which §5 risk C fixed as the compliance clock — and SHALL NOT be evaluated against
`recorded_at`, so that an inspection walked in October and synchronised in November counts in
October. A `window_months` outside the accepted range SHALL be rejected.

#### Scenario: A finding older than the window falls out of its series

- **GIVEN** a site with findings for `dock.guards` occurring 3, 8 and 20 months ago
- **WHEN** recurrence series are requested with `window_months` `12`
- **THEN** the series for `dock.guards` has `occurrence_count` `2`

#### Scenario: Widening the window brings it back

- **WHEN** the same series is requested with `window_months` `24`
- **THEN** its `occurrence_count` is `3`

#### Scenario: A late synchronisation counts in the period it was walked

- **GIVEN** a finding whose `occurred_at` is inside the window and whose `recorded_at` is outside
  it
- **WHEN** recurrence series are requested
- **THEN** the finding is counted in its series

#### Scenario: A window outside the range is refused

- **WHEN** recurrence series are requested with `window_months` `0`
- **THEN** the request is rejected with the code `validation_failed`
- **AND** the same happens for `window_months` `61`

### Requirement: A series is two occurrences or more, and reports its span

The system SHALL return as a recurrence series only a group of two or more findings within the
window; a single finding is an occurrence and not a pattern, and SHALL NOT be returned. Each
series SHALL carry its `item_key`, its `location_id` or null, its `occurrence_count`, the
`first_occurred_at` and `last_occurred_at` of its findings within the window, the number of
distinct `template_version_item_id` values it spans, and the identifiers of its findings ordered
from most to least recent. Series SHALL be ordered by `occurrence_count` descending and then by
`last_occurred_at` descending.

#### Scenario: A single finding is not a series

- **GIVEN** a site whose only finding for `exit.signage` occurred once within the window
- **WHEN** recurrence series are requested
- **THEN** no series is returned for `exit.signage`

#### Scenario: A series reports its span and its findings

- **GIVEN** a series of three findings for `dock.guards` at `pack-line-3`
- **WHEN** the series is read
- **THEN** its `first_occurred_at` is the `occurred_at` of the oldest of the three
- **AND** its `last_occurred_at` is the `occurred_at` of the most recent of the three
- **AND** it lists the three `finding` identifiers, most recent first

#### Scenario: The worst repetition comes first

- **GIVEN** one series with `occurrence_count` `2` and one with `occurrence_count` `5`
- **WHEN** recurrence series are requested
- **THEN** the series with `occurrence_count` `5` is returned first

### Requirement: Manually entered findings are outside every series and the report says so

The system SHALL exclude from every recurrence series any finding whose `item_key` is null, which
is every manually entered finding, and SHALL report alongside the series the count of findings
within the window that were excluded for that reason. Reporting the count is required so that an
empty series list is readable as "nothing repeated" and never mistaken for "nothing was looked
at".

#### Scenario: A manual finding describing the same hazard does not join the series

- **GIVEN** a site with two derived findings for `dock.guards` at `pack-line-3` and one manual
  finding describing the same hazard at the same location
- **WHEN** recurrence series are requested
- **THEN** the series for `dock.guards` at `pack-line-3` has `occurrence_count` `2`
- **AND** the response reports `excluded_manual_count` `1`

#### Scenario: A site with only manual findings reports none and says why

- **GIVEN** a site whose findings within the window are all manually entered
- **WHEN** recurrence series are requested
- **THEN** no series is returned
- **AND** `excluded_manual_count` equals the number of those findings

### Requirement: Recurrence is read within the reader's site scope

The system SHALL return recurrence series only for the sites in the session's scope, enforced by
the row level security policies on `finding` and `finding_recurrence` and not by a `WHERE site_id`
clause written in the endpoint. Series SHALL never mix findings of two sites into one group, even
when the reader's scope covers both. Reading recurrence SHALL be available to the HS coordinator,
JHSC members, supervisors, management and external auditors within their scope.

#### Scenario: A JHSC member of one site does not see the other's patterns

- **GIVEN** recurring findings for `dock.guards` in St. Thomas and in Glencoe
- **WHEN** a JHSC member scoped to St. Thomas requests recurrence series
- **THEN** only series built from St. Thomas findings are returned

#### Scenario: A reader scoped to both sites gets two series, not one

- **GIVEN** three findings for `dock.guards` in St. Thomas and three in Glencoe
- **WHEN** the HS coordinator, scoped to both sites, requests recurrence series with `group_by`
  `item`
- **THEN** two series are returned, each with `occurrence_count` `3`
- **AND** each carries its own `site_id`

#### Scenario: An external auditor reads within the granted scope

- **WHEN** an external auditor whose scope is St. Thomas and whose grant has not expired requests
  recurrence series
- **THEN** the St. Thomas series are returned, built only from St. Thomas findings

### Requirement: The site view lists the recurring findings without interpreting them

The system SHALL present, per site, the recurrence series for the selected window and grouping,
each showing the item prompt of the most recent template version it was answered in, the location
when the grouping carries one, the occurrence count, the first and last occurrence, and the
findings of the series with their current risk classification or the fact that they have none.
The view SHALL NOT render charts, trend lines, projections or any predicted value, and SHALL NOT
compute an aggregate score for a series.

#### Scenario: The coordinator reads a pattern and its findings

- **GIVEN** a series of four findings for `dock.guards` at `pack-line-3`
- **WHEN** the HS coordinator opens the recurrence view for that site
- **THEN** the series is listed with its prompt, its location, `occurrence_count` `4`, its first
  and its last occurrence
- **AND** expanding it lists the four findings with their current `risk_level` or as unclassified

#### Scenario: Changing the window and the grouping re-reads the same data

- **WHEN** the reader changes `window_months` from `12` to `24` and `group_by` from
  `item_location` to `item`
- **THEN** the view lists the series for the new parameters
- **AND** the parameters in use are visible in the view
