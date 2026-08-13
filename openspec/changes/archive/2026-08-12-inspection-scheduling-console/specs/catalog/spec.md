## ADDED Requirements

### Requirement: An account can list the sites in its own scope

The system SHALL expose, for the requesting account, the sites its active site scope covers, each
carrying `id`, `code`, `name` and `deactivated_at`. A site outside that scope SHALL NOT be
returned, and a session that declares no scope SHALL receive an empty list.

The system SHALL apply that restriction **in the query**, and that is not a departure from the rule
that site isolation is enforced by policy rather than by the endpoint. `site` carries no row
security policy by an explicit decision recorded with the table: a policy there would create a
bootstrap circularity — inserting the first row would require declaring a site identifier in the
session scope before that identifier exists — in exchange for hiding the fact that the other plant
exists, which is not what the confidentiality requirement protects. What it protects is the
findings, and those live in tables that do carry `site_id` and a policy. Isolation begins at
`location`. There is therefore no policy being bypassed here: the scope filter is selection, in the
same category as the site filter already applied when serving an inspection's locations and roster.

A deactivated site SHALL still be returned, flagged by its `deactivated_at`, so that a rule or an
inspection belonging to a closed plant still resolves to a name rather than to an identifier.

#### Scenario: The list is exactly the session's scope

- **GIVEN** an account whose active scope covers St. Thomas only
- **WHEN** it lists the sites
- **THEN** St. Thomas is returned
- **AND** Glencoe is not returned

#### Scenario: A session with no scope receives nothing

- **WHEN** the site list is read in a session that declares no site scope
- **THEN** the list is empty

#### Scenario: A deactivated site is named, not hidden

- **GIVEN** a site in the account's scope whose `deactivated_at` is set
- **WHEN** the account lists the sites
- **THEN** the site is returned with its `deactivated_at` set

#### Scenario: Every role may name the plants it works in

- **WHEN** an account whose role is `jhsc_member` lists the sites
- **THEN** the sites of its own scope are returned
