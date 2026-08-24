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

### Requirement: Coverage counts the periods the site owed, at the frequency its rules declare

The system SHALL derive the periods a site owed from `inspection_schedule` rather than from the
scheduled inspections that exist, so that a period the opening job never opened still appears in
the report. A rule SHALL contribute one owed period per period of its own series — one every
`frequency_months` months, counted from `anchor_month` — and not one per month. Every
`scheduled_inspection` in the range SHALL be added to that set, so that a period opened outside the
calendar, or left behind by a rule that has since been deactivated, is still reported.
`required_count` SHALL be the number of owed periods.

The range of a report SHALL select periods by the month in which they begin.

#### Scenario: A year covered by a quarterly rule reports four required periods

- **GIVEN** a site whose only active rule has `frequency_months` `3` and `anchor_month` `1`
- **AND** all four quarters of 2026 were inspected
- **WHEN** the compliance report for 2026 is generated
- **THEN** `required_count` is `4` and `completed_count` is `4`
- **AND** the document reads "4 of 4 required periods completed"

#### Scenario: A quarter the opening job never opened is still counted as owed

- **GIVEN** a site whose only active rule is quarterly and anchored in January
- **AND** no scheduled inspection exists for the quarter starting `2026-07-01`
- **WHEN** the compliance report for 2026 is generated
- **THEN** the quarter starting `2026-07-01` appears with status `missed`
- **AND** `required_count` is `4`

#### Scenario: An owed quarterly period reports the end of its third month

- **GIVEN** a site whose only active rule is quarterly and anchored in January
- **WHEN** the compliance report for 2026 is generated
- **THEN** the first period reports `period_start` `2026-01-01` and `period_end` `2026-03-31`

#### Scenario: Rules of different frequencies are both counted

- **GIVEN** a site with an active monthly rule and an active annual rule
- **WHEN** the compliance report for 2026 is generated
- **THEN** `required_count` is `13`

#### Scenario: A completed period names its inspection and its inspector

- **GIVEN** a period whose scheduled inspection was submitted
- **WHEN** the compliance report is read
- **THEN** that period's entry carries its `inspection_id`, its `submitted_by` and the
  `occurred_at` of the submission
- **AND** it carries the `template_version_id` the scheduled inspection was bound to

#### Scenario: A range that does not start on the first of a month is refused

- **WHEN** compliance is requested with `range_start` `2026-01-15`
- **THEN** the request is rejected with the code `validation_failed`

### Requirement: A frozen report stays readable after the payload shape changes

The system SHALL keep every compliance report payload exactly as it was hashed, and SHALL be able
to read a payload produced by any shape version it has ever written. The length of a period SHALL
be optional in the payload, and its absence SHALL mean the report was frozen when every period was
monthly.

#### Scenario: A report frozen before frequencies existed still validates

- **GIVEN** a stored report whose payload has `schema_version` `1` and whose periods carry no
  `period_months`
- **WHEN** the report is read back
- **THEN** it validates against the current contract
- **AND** its stored digest still verifies against its stored payload

#### Scenario: An unknown shape version is refused

- **WHEN** a payload with a `schema_version` the contract has never written is validated
- **THEN** validation fails

### Requirement: The exported document names each period unambiguously

The system SHALL write, for every period of the exported document, both a human-readable name of
the period and its exact first and last day. The name SHALL use a calendar shorthand only when the
period coincides with that calendar unit, so that a period which does not align with the civil
quarter, half or year is written as its two endpoints instead.

#### Scenario: An aligned quarter is named by its shorthand

- **WHEN** a period starting `2026-01-01` with length `3` is written to the document
- **THEN** it is named `Q1 2026`
- **AND** the exact range `2026-01-01` – `2026-03-31` is shown alongside it

#### Scenario: A quarter that does not align with the civil quarter is named by its endpoints

- **WHEN** a period starting `2026-02-01` with length `3` is written to the document
- **THEN** it is named `Feb–Apr 2026` rather than `Q1 2026`

#### Scenario: A period that crosses the year names both years

- **WHEN** a period starting `2026-09-01` with length `12` is written to the document
- **THEN** it is named `Sep 2026–Aug 2027` rather than `2026`

### Requirement: A period has exactly four states and the open one is never counted as missed

The system SHALL classify every period in the range as exactly one of `completed`, `missed`,
`cancelled` or `open`. A period SHALL be `completed` when an `inspection` exists for its
`scheduled_inspection`; `cancelled` when the scheduled inspection carries a `cancelled_at`, and
its entry SHALL carry the `cancellation_reason`; `missed` when its `period_end` is already past,
it was not cancelled and no `inspection` exists; and `open` when its `period_end` has not yet
passed and no `inspection` exists. A period that is still `open` SHALL NOT be counted in
`missed_count`, because a month that has not ended is not a month that was skipped. The boundary
between `open` and `missed` SHALL be evaluated in the `America/Toronto` calendar and not in UTC.

#### Scenario: The current month is open, not missed

- **GIVEN** a scheduled inspection for the current period with no submission
- **WHEN** compliance is requested for a range that includes the current month
- **THEN** that period's `status` is `open`
- **AND** `missed_count` does not include it

#### Scenario: A past month without a submission is missed

- **GIVEN** a scheduled inspection for a period whose `period_end` has passed, not cancelled and
  with no submission
- **WHEN** the compliance report is read
- **THEN** that period's `status` is `missed`

#### Scenario: A cancelled period is neither completed nor missed, and says why

- **GIVEN** a scheduled inspection cancelled with the reason `plant shutdown`
- **WHEN** the compliance report is read
- **THEN** that period's `status` is `cancelled`
- **AND** its entry carries the `cancellation_reason` `plant shutdown`
- **AND** it is counted in `cancelled_count` and in neither `completed_count` nor `missed_count`

#### Scenario: The last day of a month is still open in Ontario

- **GIVEN** a period whose `period_end` is `2026-08-31` and a server clock reading
  `2026-09-01T01:00:00Z`, which is `2026-08-31` in `America/Toronto`
- **WHEN** the compliance report is read
- **THEN** that period's `status` is `open`

### Requirement: A generated report freezes its payload and is never recomputed on read

The system SHALL, when a compliance report is generated, build the complete report payload, store
it verbatim in `compliance_report.payload`, and store its digest in
`compliance_report.payload_hash` together with `site_id`, `range_start`, `range_end`,
`generated_by` and `generated_at`. Reading a stored report SHALL return the stored payload and
SHALL NOT recompute any of its figures from current data, so that a report generated in July
keeps reporting what was true in July. `compliance_report.payload_hash` SHALL be 64 lowercase
hexadecimal characters and SHALL be rejected by the engine otherwise.

#### Scenario: A report read months later reports what it reported when generated

- **GIVEN** a report generated for a range in which `completed_count` was `11`
- **AND** the missing period's inspection is submitted late, afterwards
- **WHEN** the stored report is read
- **THEN** its payload still reports `completed_count` `11`
- **AND** its `payload_hash` is unchanged

#### Scenario: A digest that is not a SHA-256 hex digest is refused

- **WHEN** a `compliance_report` row is inserted with a `payload_hash` of `abc`
- **THEN** the insert fails with a check violation on `payload_hash`

#### Scenario: A report without its payload is refused

- **WHEN** a `compliance_report` row is inserted without `payload`
- **THEN** the insert fails with a not-null violation

### Requirement: The digest is computed over the canonical JSON payload and never over the PDF bytes

The system SHALL compute `payload_hash` as the SHA-256 digest of the report payload serialised
with the JSON Canonicalization Scheme of RFC 8785 — object keys sorted by UTF-16 code unit, no
insignificant whitespace, numbers in their canonical form — encoded as UTF-8. The system SHALL
NOT compute, store or present any digest of the rendered PDF file, because PDF generation through
a headless browser is not reproducible byte for byte and such a digest could not be verified
again later. Serialising the same payload twice SHALL produce byte-identical output and therefore
the same digest, in any process and at any time.

#### Scenario: The same payload always yields the same digest

- **GIVEN** a stored report payload
- **WHEN** the payload is canonicalised and hashed again in a separate process
- **THEN** the digest equals the stored `payload_hash`

#### Scenario: Key order in the source object does not change the digest

- **GIVEN** two in-memory objects with the same entries inserted in a different order
- **WHEN** both are canonicalised
- **THEN** the two serialisations are byte-identical

#### Scenario: A payload that cannot be canonicalised is refused rather than hashed loosely

- **WHEN** a payload containing a non-finite number is canonicalised
- **THEN** the operation fails and no report is stored

#### Scenario: No digest of the file is offered anywhere

- **WHEN** a stored report and its renders are read
- **THEN** no field carries a digest of the PDF file

### Requirement: The report payload carries coverage, findings, recurrence and open actions, with a declared shape version

The system SHALL build the report payload with `schema_version`, the site, the range, the
`generated_at`, the coverage counts, the period entries, the findings that occurred within the
range with their current risk classification or the fact that they have none, the recurrence
series of the range as defined by this capability, and the corrective actions of the range that
are open, with those already past their due date marked. Arrays SHALL be ordered
deterministically — periods by `period_start` ascending, findings by `occurred_at` descending,
series by `occurrence_count` descending — so that two payloads of the same data are the same
payload. `schema_version` SHALL be incremented whenever the shape changes, because a shape change
changes every digest computed after it.

#### Scenario: The payload carries every section and its version

- **WHEN** a report is generated for a site and a range
- **THEN** its payload carries `schema_version`, the site, the range, `generated_at`, the coverage
  counts, the period entries, the findings, the recurrence series and the open corrective actions

#### Scenario: Ordering does not depend on how the rows came back

- **GIVEN** the same underlying data
- **WHEN** the payload is built twice
- **THEN** the period entries appear in `period_start` ascending order in both
- **AND** the two canonical serialisations are byte-identical

#### Scenario: The report says what did not repeat as well as what did

- **GIVEN** a range whose findings within the site are all manually entered
- **WHEN** a report is generated
- **THEN** its payload carries no recurrence series
- **AND** it carries the count of findings excluded from every series for having no `item_key`

### Requirement: Only the HS coordinator generates a report, and generating one is a recorded act

The system SHALL restrict the generation of a compliance report to the HS coordinator within the
sites of their scope. Management, JHSC members, supervisors and external auditors SHALL be able
to read the compliance view and the reports already generated for the sites in their scope, and
SHALL NOT be able to generate one. A generation request for a site outside the session's scope
SHALL be refused, enforced by the row level security policy on `compliance_report` and not by a
`WHERE site_id` clause written in the endpoint.

#### Scenario: The coordinator generates a report for their site

- **WHEN** the HS coordinator requests a report for St. Thomas within their scope
- **THEN** a `compliance_report` row is stored with `generated_by` set to their account

#### Scenario: A supervisor reads but does not generate

- **WHEN** a supervisor requests the generation of a report
- **THEN** the request is refused
- **AND** the same supervisor can read the reports already generated for their site

#### Scenario: A report cannot be generated for another site

- **WHEN** the HS coordinator scoped only to Glencoe requests a report for St. Thomas
- **THEN** the request is refused by the policy

#### Scenario: An external auditor reads reports within the granted scope

- **WHEN** an external auditor whose scope is St. Thomas and whose grant has not expired lists
  compliance reports
- **THEN** only the St. Thomas reports are returned

### Requirement: A report is rendered to PDF asynchronously and every attempt is recorded as a row

The system SHALL render the PDF of a stored report in a background job rather than within the
request that generates it, and SHALL respond to the generation request with the stored report and
its `payload_hash` before any render has run. Every render attempt SHALL insert one
`compliance_report_render` row carrying `report_id`, `site_id`, `outcome` — `succeeded` or
`failed` — `rendered_at`, the `object_key` of the stored file when it succeeded, and the error
description when it failed. A render row SHALL carry an `object_key` exactly when its `outcome` is
`succeeded`. A report SHALL expose its most recent successful render, and SHALL be readable with
no render at all.

#### Scenario: The report exists before the PDF does

- **WHEN** the HS coordinator generates a report
- **THEN** the response carries the report and its `payload_hash`
- **AND** the report is readable with no successful render yet

#### Scenario: A failed render does not lose the report

- **GIVEN** a stored report whose render attempt failed
- **WHEN** the report is read
- **THEN** it is returned with its payload and `payload_hash`
- **AND** one `compliance_report_render` row carries `outcome` `failed` and its error

#### Scenario: A retried render adds a row and keeps the digest

- **GIVEN** a report with one failed render
- **WHEN** the render is retried and succeeds
- **THEN** a second `compliance_report_render` row carries `outcome` `succeeded` and an
  `object_key`
- **AND** the report's `payload_hash` is the one it had before

#### Scenario: A render row cannot claim a file it does not have

- **WHEN** a `compliance_report_render` row is inserted with `outcome` `succeeded` and a null
  `object_key`
- **THEN** the insert fails with a check violation
- **AND** the same happens for `outcome` `failed` with a non-null `object_key`

### Requirement: The rendered document prints the digest and its provenance on every page

The system SHALL print, in the footer of every page of the rendered PDF, the `payload_hash` of the
report, the site name, the range, the `generated_at` and the report identifier, together with the
page number and the page count. The footer SHALL appear on every page and not once at the end, so
that a single page separated from the document still declares which document it came from. The
document SHALL state in its own text that the digest covers the report payload and not the file.

#### Scenario: Every page carries the digest

- **GIVEN** a report whose rendered document spans four pages
- **WHEN** the PDF is rendered
- **THEN** each of the four pages carries the `payload_hash`, the site, the range, the
  `generated_at` and the report identifier in its footer
- **AND** each page carries its page number and the page count

#### Scenario: The document says what the digest covers

- **WHEN** the rendered document is read
- **THEN** it states that the digest is computed over the report payload and not over the file

#### Scenario: Two renders of the same report print the same digest

- **GIVEN** a report rendered twice
- **WHEN** both files are read
- **THEN** both print the same `payload_hash`

### Requirement: The rendered file is stored in the versioned bucket and served by a short-lived signed link

The system SHALL store the rendered PDF in the object storage bucket under a key derived by the
server from the site, the report and the render attempt, never from a value supplied by the
caller, so that a second render of the same report writes a second object instead of overwriting
the first, in a bucket with versioning enabled and with no deletion path available to the
application. The system SHALL serve
the file to a reader within the site's scope through a short-lived signed download link rather
than by streaming the bytes through the application. A download request for a report outside the
session's scope, or for a report with no successful render, SHALL be refused.

#### Scenario: The stored key is derived by the server

- **WHEN** a render succeeds
- **THEN** its `object_key` is under the prefix of the report's site and the report identifier
- **AND** no part of the key comes from the generation request

#### Scenario: A second render does not overwrite the first file

- **GIVEN** a report with one successful render
- **WHEN** the report is rendered again and succeeds
- **THEN** the second render's `object_key` differs from the first's

#### Scenario: Downloading yields a signed link, not the bytes

- **WHEN** the HS coordinator requests the PDF of a rendered report
- **THEN** the response directs the reader to a signed link that expires

#### Scenario: A report with no successful render has nothing to download

- **WHEN** the PDF of a report whose only render failed is requested
- **THEN** the request is refused with the code `not_found`

#### Scenario: A reader outside the scope downloads nothing

- **WHEN** a reader scoped only to Glencoe requests the PDF of a St. Thomas report
- **THEN** the request is refused

### Requirement: The compliance view shows the grid, the fraction and the digest without interpreting them

The system SHALL present, per site, the periods of the selected range as a grid showing each
period's status, the coverage as a fraction of completed over required periods, and the list of
reports already generated with their `generated_at`, their `generated_by`, their `payload_hash`
shown in full and copyable, and a download for those with a successful render. The view SHALL NOT
render charts, trend lines, projections or any compliance score, and SHALL NOT hide the digest
behind a truncation, because a truncated digest cannot be checked.

#### Scenario: The coordinator reads coverage and generates the evidence

- **GIVEN** a site with eleven of twelve periods completed in the range
- **WHEN** the HS coordinator opens the compliance view for that site
- **THEN** the twelve periods are shown with their statuses and the coverage is shown as `11/12`
- **AND** generating a report adds it to the list with its digest shown in full

#### Scenario: No score is shown

- **WHEN** the compliance view is read
- **THEN** no percentage score, chart or trend line is presented
