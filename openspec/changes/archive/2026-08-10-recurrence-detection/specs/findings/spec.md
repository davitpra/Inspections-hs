## ADDED Requirements

### Requirement: A derived finding is marked with its recurrence at the moment it is created

The system SHALL write, for every finding derived from an inspection answer, exactly one
`finding_recurrence` row inside the same transaction that inserts the `finding`. The row SHALL
record `prior_count` — how many earlier findings within the window share the finding's `item_key`
and `location_id` — `prior_count_site_wide` — how many share its `item_key` alone across the site
— the `window_months` used, and `first_prior_occurred_at`, the `occurred_at` of the oldest of
those earlier findings or null when there are none. `is_recurrent` SHALL be derived by the engine
as `prior_count > 0` and SHALL NOT be writable by any caller. An accepted submission SHALL NOT be
committed with a derived finding that has no `finding_recurrence` row.

#### Scenario: The fourth failure of the same item at the same place knows it is the fourth

- **GIVEN** a site with three earlier findings for `dock.guards` at `pack-line-3` inside the
  window
- **WHEN** a submission producing a fourth finding for `dock.guards` at `pack-line-3` is accepted
- **THEN** one `finding_recurrence` row references the created finding
- **AND** its `prior_count` is `3`
- **AND** its `is_recurrent` is true
- **AND** its `first_prior_occurred_at` is the `occurred_at` of the oldest of the three

#### Scenario: The first failure is marked as not recurrent, not left unmarked

- **WHEN** a submission produces the first finding ever for `exit.signage` at `shipping-bay`
- **THEN** one `finding_recurrence` row references it
- **AND** its `prior_count` is `0` and its `is_recurrent` is false

#### Scenario: The same item at a new location is recurrent site-wide only

- **GIVEN** three earlier findings for `dock.guards` at `pack-line-3` inside the window
- **WHEN** a submission produces a finding for `dock.guards` at `shipping-bay`
- **THEN** its `prior_count` is `0`
- **AND** its `prior_count_site_wide` is `3`

#### Scenario: A submission with no mark does not commit

- **WHEN** a `finding` row with a non-null `item_key` is inserted and the transaction commits
  without inserting its `finding_recurrence` row
- **THEN** the commit fails
- **AND** neither the finding nor the inspection exists

#### Scenario: The mark counts only the site's own findings

- **GIVEN** three findings for `dock.guards` at a Glencoe location inside the window
- **WHEN** a St. Thomas submission produces a finding for `dock.guards`
- **THEN** its `prior_count` and `prior_count_site_wide` are both `0`

### Requirement: The recurrence mark is a fact of the moment and is never recomputed

The system SHALL treat `finding_recurrence` as immutable: the mark records what was true when the
finding was created and SHALL NOT be updated when later findings extend the series, when a
template version is published, or when the window used by a report differs from the one stored.
Reading a finding SHALL return its stored mark. A recurrence report SHALL compute its series from
the findings themselves for the window requested, and SHALL NOT read `prior_count` to build them,
so that a report over a window of 24 months is not limited by a mark computed over 12.

#### Scenario: A later finding does not change an earlier mark

- **GIVEN** a finding whose `prior_count` is `1`
- **WHEN** two further findings of the same `item_key` and `location_id` are created afterwards
- **THEN** the first finding's `prior_count` is still `1`

#### Scenario: A mark cannot be corrected in place

- **WHEN** the application role updates any column of a `finding_recurrence` row
- **THEN** the update is rejected

#### Scenario: A report over a wider window is not capped by the stored marks

- **GIVEN** findings for `dock.guards` at `pack-line-3` occurring 3, 8 and 20 months ago, each
  marked with `window_months` `12`
- **WHEN** recurrence series are requested with `window_months` `24`
- **THEN** the series for `dock.guards` at `pack-line-3` has `occurrence_count` `3`

#### Scenario: Reading a finding returns its mark

- **WHEN** a derived finding is read by id
- **THEN** the response carries its `prior_count`, `prior_count_site_wide`, `window_months`,
  `first_prior_occurred_at` and `is_recurrent`

### Requirement: A manually entered finding carries no recurrence mark

The system SHALL NOT create a `finding_recurrence` row for a finding whose `item_key` is null, and
SHALL report such a finding's recurrence as absent rather than as false. Without a stable item
concept there is no series to belong to, and reporting `is_recurrent` false would assert that the
hazard was checked against the history when it was not.

#### Scenario: A manual finding has no mark

- **WHEN** a supervisor reports a manual finding
- **THEN** no `finding_recurrence` row references it
- **AND** reading it returns its recurrence as null, not as `is_recurrent` false

#### Scenario: A mark cannot be attached to a finding without an item key

- **WHEN** a `finding_recurrence` row is inserted for a finding whose `item_key` is null
- **THEN** the insert fails on the engine's constraint

#### Scenario: A finding cannot carry two marks

- **WHEN** a second `finding_recurrence` row is inserted for a finding that already has one
- **THEN** the insert fails with a unique violation on `finding_id`
