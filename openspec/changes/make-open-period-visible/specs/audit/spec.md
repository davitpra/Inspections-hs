## ADDED Requirements

### Requirement: Advancing scheduled inspection visibility is audited

The system SHALL append one `inspection.visibility_advanced` entry when `scheduled_inspection.visible_early` advances from `false` to `true`. The entry SHALL identify the `scheduled_inspection_id`, `site_id`, `period_start`, `period_end`, `template_id`, `template_version_id`, and the acting account resolved by the audit mechanism.

#### Scenario: Making a future period visible appends one audit entry

- **WHEN** an `hs_coordinator` advances `visible_early` from `false` to `true`
- **THEN** exactly one `inspection.visibility_advanced` entry is appended for that `scheduled_inspection_id`
- **AND** its actor is the requesting account

#### Scenario: A rejected visibility request is not audited

- **WHEN** an early-visibility request is rejected without changing `visible_early`
- **THEN** no `inspection.visibility_advanced` entry is appended
