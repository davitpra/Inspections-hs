## ADDED Requirements

### Requirement: Compliance coverage is reported per site and per monthly period

The system SHALL report, for a site and a range of monthly periods, one entry per period the site
owed an inspection under its schedule rules — whether or not a `scheduled_inspection` was ever
opened for it — each carrying its `period_start`, its `period_end`, its `status`, the
`template_id` and `template_version_id` the period's inspection was bound to, and — when the
period was completed — the `inspection_id`, its `submitted_by` and its `occurred_at`. Alongside
the entries the system SHALL report `required_count`, `completed_count`, `missed_count`,
`cancelled_count` and `open_count`, so that the coverage of a site over a range is a fraction of
counted rows and never an estimate. The range SHALL be expressed as `range_start`, the first
calendar day of the first month, and `range_end`, the last calendar day of the last month, and a
range whose `range_start` is not the first day of a month or whose `range_end` precedes it SHALL
be rejected with the code `validation_failed`.

#### Scenario: A full year of coverage is reported as twelve entries and a fraction

- **GIVEN** a site with twelve scheduled inspections over the twelve months of `2026`, of which
  eleven were submitted
- **WHEN** compliance is requested for `range_start` `2026-01-01` and `range_end` `2026-12-31`
- **THEN** twelve period entries are returned
- **AND** `required_count` is `12` and `completed_count` is `11`

#### Scenario: A completed period names its inspection and its inspector

- **GIVEN** a period whose scheduled inspection was submitted
- **WHEN** the compliance report is read
- **THEN** that period's entry carries its `inspection_id`, its `submitted_by` and the
  `occurred_at` of the submission
- **AND** it carries the `template_version_id` the scheduled inspection was bound to

#### Scenario: A range that does not start on the first of a month is refused

- **WHEN** compliance is requested with `range_start` `2026-01-15`
- **THEN** the request is rejected with the code `validation_failed`

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
