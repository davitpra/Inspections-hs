## ADDED Requirements

### Requirement: People administration uses clear user-facing terminology

The system SHALL label the site people administration destination as “People” in navigation and “People & Access” in its page heading. User-facing actions, summaries, dialogs, empty states and account-management messages in that destination SHALL refer to people rather than a roster, while preserving the distinction between a person and an account.

#### Scenario: Coordinator opens people administration

- **WHEN** an H&S coordinator opens the site people administration destination
- **THEN** the navigation item is labeled “People”
- **AND** the page heading is “People & Access”

#### Scenario: Coordinator manages the people list

- **WHEN** an H&S coordinator imports, adds, searches or manages access for people at a site
- **THEN** the visible action and status text refers to people and access without using “roster” as the name of the destination or list

#### Scenario: Internal roster identifiers remain compatible

- **WHEN** the people administration terminology is displayed
- **THEN** the existing `/roster` route and roster API contracts remain unchanged
