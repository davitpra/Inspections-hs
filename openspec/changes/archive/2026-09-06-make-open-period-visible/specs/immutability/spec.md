## ADDED Requirements

### Requirement: Early visibility is a monotonic database transition

The database SHALL permit the application role to update only `scheduled_inspection.visible_early` for the early-visibility operation and SHALL permit only the transition from `false` to `true`. The database SHALL reject setting `visible_early` to `false`, changing it on a cancelled scheduled inspection, or changing it after an `inspection` exists for that scheduled inspection. Existing RLS policies SHALL continue to restrict the affected row by declared site scope.

#### Scenario: Early visibility cannot be reversed

- **GIVEN** a scheduled inspection whose `visible_early` is `true`
- **WHEN** the application role attempts to set `visible_early` to `false`
- **THEN** PostgreSQL rejects the statement with the scheduling guard's dedicated SQLSTATE
- **AND** `visible_early` remains `true`

#### Scenario: A submitted inspection remains frozen

- **GIVEN** a scheduled inspection with an accepted `inspection`
- **WHEN** the application role attempts to change `visible_early`
- **THEN** PostgreSQL rejects the statement
- **AND** the submitted record is unchanged

#### Scenario: Site isolation applies to the transition

- **GIVEN** a session whose declared site scope excludes the scheduled inspection's `site_id`
- **WHEN** the application role attempts to advance `visible_early`
- **THEN** no row is updated
