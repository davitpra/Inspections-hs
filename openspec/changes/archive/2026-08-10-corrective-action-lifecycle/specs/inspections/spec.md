## MODIFIED Requirements

### Requirement: The HS coordinator is notified when a period is opened

The system SHALL create, for every site where the opening job created at least one scheduled
inspection, one `notification` row per active `hs_coordinator` account whose site scope includes
that site, with `kind` `inspection_period_opened` and a payload naming the period and the
inspections opened. The notification SHALL be delivered in the application; the system SHALL NOT
depend on outbound email. At most one such notification SHALL exist per recipient, site and
period, enforced by the database, so that a repeated job run does not produce a second one. A
recipient SHALL be able to mark a notification as read, and `read_at` SHALL be the only value a
notification ever changes.

`inspection_period_opened` SHALL be one of several notification kinds, and the shape of
`notification.payload` SHALL be determined by `kind`: a reader SHALL NOT assume that every
notification carries the period payload. A reader that does not recognise a `kind` SHALL fail
loudly rather than render an unknown payload, because the set of kinds is closed and adding one is
a change that has to state how it is shown.

#### Scenario: Opening a period notifies the coordinator

- **GIVEN** an active `hs_coordinator` account whose site scope includes St. Thomas
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** a `notification` row exists for that account with `kind` `inspection_period_opened`
- **AND** its payload names the period and the inspections opened

#### Scenario: A repeated run does not notify twice

- **WHEN** the opening job runs a second time in the same period
- **THEN** the coordinator still has exactly one `inspection_period_opened` notification for that
  site and period

#### Scenario: A job run that opens nothing notifies nobody

- **GIVEN** every rule of a site already has its inspection for the current period
- **WHEN** the opening job runs
- **THEN** no notification is created for that site

#### Scenario: A notification body cannot be rewritten

- **WHEN** any role attempts to update a notification's `payload`, `kind`, `user_id` or `site_id`
- **THEN** the statement fails
- **AND** setting `read_at` on the same row succeeds

#### Scenario: A coordinator outside the site scope is not notified

- **GIVEN** an active `hs_coordinator` account whose site scope covers only Glencoe
- **WHEN** the opening job creates the St. Thomas inspection for the current period
- **THEN** no notification for St. Thomas is created for that account

#### Scenario: The inbox carries notifications of several kinds together

- **GIVEN** a coordinator with one `inspection_period_opened` notification and one
  `corrective_action_overdue_supervisor` notification
- **WHEN** the inbox is read
- **THEN** both are returned
- **AND** each carries the payload of its own `kind`

#### Scenario: An unknown kind is not silently rendered

- **WHEN** a notification whose `kind` is outside the closed list is read
- **THEN** the read fails rather than returning a notification with an unrecognised payload
