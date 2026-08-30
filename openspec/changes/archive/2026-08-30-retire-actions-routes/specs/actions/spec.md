## ADDED Requirements

### Requirement: Corrective actions are not an independent application destination

The system SHALL NOT expose an authenticated navigation entry, workspace, inspection-grouped
listing, or independent detail route for corrective actions. Removing those application routes
SHALL NOT remove the site-scoped action reads, event history, transitions, evidence, escalation,
or audit behavior used by findings and server workflows. The immutable event history SHALL remain
available through the action API as source data, but the findings-only reading SHALL present the
business decisions represented by that data rather than an event timeline.

#### Scenario: The application has no corrective actions navigation entry

- **WHEN** an authenticated account reads the application navigation
- **THEN** no corrective actions workspace entry is presented

#### Scenario: A retired action URL does not resolve

- **WHEN** an account requests `/actions`, `/actions/inspection/$inspectionId`, or `/actions/$id`
- **THEN** the application returns its not-found experience
- **AND** it does not redirect the account to another route

#### Scenario: Non-inspection actions have no v1 application surface

- **GIVEN** a corrective action belongs to a manual finding or an incident investigation
- **WHEN** an authenticated account uses the v1 application
- **THEN** the application offers no route that lists or opens that action
- **AND** the action and its immutable records remain stored and available to server workflows

#### Scenario: Removing the detail route does not remove the immutable record

- **GIVEN** a corrective action has creation, completion and verification events
- **WHEN** the independent action detail route is retired
- **THEN** `GET /actions/:id` continues to return its complete event and evidence history
- **AND** the findings-only reading translates applicable records into decisions instead of an event timeline
