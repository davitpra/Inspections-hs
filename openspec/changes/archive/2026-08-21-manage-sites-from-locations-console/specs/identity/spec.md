## ADDED Requirements

### Requirement: Site deactivation preserves historical account scope

The system SHALL NOT delete or revoke `user_site_scope` rows when a site is deactivated. Existing
scope rows SHALL remain available for resolving historical records, while active Locations views
SHALL rely on the site's non-null `deactivated_at` to omit the site from active management.

#### Scenario: Deactivation does not revoke an account's site scope

- **GIVEN** an account has an active `user_site_scope` row for a site
- **WHEN** the site is deactivated
- **THEN** the `user_site_scope` row remains present
- **AND** its `revoked_at` remains null

#### Scenario: Historical access still resolves the deactivated site

- **GIVEN** an account has an active scope for a deactivated site
- **WHEN** a historical record references that site
- **THEN** the site can still be resolved by its `id`, `code`, `name` and `deactivated_at`

#### Scenario: Deactivation changes no other account scopes

- **WHEN** an HS coordinator deactivates a site
- **THEN** no `user_site_scope` row for any account is inserted, deleted or revoked as a side effect
