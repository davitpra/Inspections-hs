## ADDED Requirements

### Requirement: Registering a site grants its scope to the account that registered it

The system SHALL, in the same transaction that registers a `site`, store an active
`user_site_scope` row whose `user_id` is the registering account and whose `site_id` is the
registered site. The registration and the grant SHALL be atomic: neither SHALL be stored without
the other.

The system SHALL grant that scope to the registering account only. It SHALL NOT alter the scope of
any other account as a consequence of a site registration.

#### Scenario: The registrant reaches the site it registered

- **WHEN** an HS coordinator registers a site
- **THEN** a `user_site_scope` row exists whose `user_id` is that account and whose `site_id` is the
  registered site
- **AND** its `revoked_at` is null
- **AND** its `granted_at` is set

#### Scenario: The registrant's next request carries the new site

- **GIVEN** an HS coordinator has registered a site
- **WHEN** that account's session scope is resolved for its next request
- **THEN** the registered site is among the sites the session reaches

#### Scenario: A failed grant leaves no site behind

- **WHEN** the `user_site_scope` insert cannot complete after the `site` row has been inserted
- **THEN** the transaction rolls back
- **AND** no `site` row with the submitted `code` is stored
- **AND** no `user_site_scope` row for the submitted site is stored

#### Scenario: No other account gains the new site

- **GIVEN** a second account whose role is `hs_coordinator` and whose scope covers St. Thomas only
- **WHEN** another HS coordinator registers a site
- **THEN** the second account's active `user_site_scope` rows are unchanged
- **AND** the registered site is absent from the second account's site list

#### Scenario: The grant is recorded on the new site's chain

- **WHEN** an HS coordinator registers a site
- **THEN** an `audit_log` entry whose `event_type` is `user.scope_granted` exists
- **AND** its `site_id` is the registered site
- **AND** its payload carries the registering account as its `account_id`
