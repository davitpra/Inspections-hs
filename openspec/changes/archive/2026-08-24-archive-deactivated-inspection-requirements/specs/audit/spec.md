## ADDED Requirements

### Requirement: Inspection requirement archive changes are auditable

The system SHALL append `inspection_schedule.archived` when `inspection_schedule.archived_at` changes from null to non-null and SHALL append `inspection_schedule.restored` when it changes from non-null to null. Each event SHALL belong to the requirement's site chain and SHALL identify the `inspection_schedule_id`, `site_id`, `template_id`, and resulting `archived_at`.

#### Scenario: Archiving appends an audit entry
- **WHEN** an inspection requirement's `archived_at` changes from null to non-null
- **THEN** an `inspection_schedule.archived` entry is appended to that site's audit chain
- **AND** its payload carries the resulting `archived_at`

#### Scenario: Restoring appends an audit entry
- **WHEN** an inspection requirement's `archived_at` changes from non-null to null
- **THEN** an `inspection_schedule.restored` entry is appended to that site's audit chain
- **AND** its payload carries a null `archived_at`
