## MODIFIED Requirements

### Requirement: The subject and the witnesses are chosen without seeing a profile

The system SHALL offer the people of the reporter's site scope as `PersonOption` values —
`id`, `employee_number`, `first_name` and `last_name` and nothing else — through
`GET /incident-roster?site_id=<uuid>`, and SHALL NOT return through any incident route a person's
site, status, dates or any other roster attribute. The route SHALL return only the active people
of the requested site, ordered by `last_name` and then `first_name`. The system SHALL serve the
route to the same roles that may report an incident — `coordinator` and `management` — and SHALL
refuse it to an `inspector` with the code `forbidden`. Site isolation SHALL be applied by the
row-level policy of `person`: when `site_id` is a site outside the session's scope, the system
SHALL answer with an empty list and SHALL NOT disclose whether that site has people. When
`site_id` is missing or is not a UUID, the system SHALL reject the request with the code
`invalid_request`. Every `id` the route returns SHALL be a person that `POST /incidents` accepts
as `subject_person_id` or as a witness for an incident at a location of that site, except the
reporter's own person as subject. Witnesses SHALL be stored as `incident_witness` rows referencing
`person`, chosen through the same selector, and an incident MAY have none.

#### Scenario: The selector returns only what a selector needs

- **WHEN** an administrative account requests `GET /incident-roster` with a `site_id` of its scope
- **THEN** each entry carries exactly `id`, `employee_number`, `first_name` and `last_name`
- **AND** no other roster attribute is present in the response

#### Scenario: Deactivated people are not offered

- **GIVEN** a person whose `deactivated_at` is not null
- **WHEN** the incident roster of their site is listed
- **THEN** that person is absent from the options
- **AND** incidents that already reference them still resolve that reference

#### Scenario: The options are ordered by last name and first name

- **GIVEN** active people `Wu, Chen`, `Boivin, Alex` and `Boivin, Adam` at the same site
- **WHEN** the incident roster of that site is listed
- **THEN** the options come in the order `Boivin, Adam`, `Boivin, Alex`, `Wu, Chen`

#### Scenario: Only the people of the requested site are offered

- **GIVEN** a `coordinator` whose scope holds site A and site B, each with active people
- **WHEN** the coordinator lists the incident roster with `site_id` of site A
- **THEN** every option is a person of site A
- **AND** no person of site B is present

#### Scenario: A site outside the scope yields an empty list

- **GIVEN** a `management` account whose scope holds only site A
- **WHEN** it lists the incident roster with `site_id` of site B, which has active people
- **THEN** the response is an empty list

#### Scenario: An inspector cannot list the incident roster

- **WHEN** an account whose `role` is `inspector` requests `GET /incident-roster` with a
  `site_id` of its scope
- **THEN** the request is rejected with the code `forbidden`

#### Scenario: The site is required

- **WHEN** `GET /incident-roster` is requested without `site_id`, or with a `site_id` that is not
  a UUID
- **THEN** the request is rejected with the code `invalid_request`

#### Scenario: What the selector offers the report accepts

- **GIVEN** a person returned by the incident roster of site A who is not the reporter's own person
- **WHEN** an incident is reported at an active location of site A naming that person as
  `subject_person_id` and another returned person in `witness_person_ids`
- **THEN** the incident is created

#### Scenario: Witnesses are recorded as person references

- **WHEN** an incident is reported naming two witnesses
- **THEN** two `incident_witness` rows reference those `person_id` values
- **AND** neither witness gains an account or a notification

#### Scenario: An incident with no witnesses is valid

- **WHEN** an incident is reported with an empty witness list
- **THEN** the incident is created and carries no `incident_witness` row

## ADDED Requirements

### Requirement: The report form picks the site, the location and the people from lists

The incident report screen SHALL obtain `location_id`, `subject_person_id` and
`witness_person_ids` only from lists the server provides, and SHALL NOT ask the reporter to type
an identifier. The screen SHALL first fix a site, chosen among the active sites of the session's
scope; SHALL offer as locations only the active locations of that site; and SHALL offer as subject
and witnesses only the options of the incident roster of that site. When the scope holds a single
active site, the screen SHALL fix that site without asking. When the reporter changes the site, the
screen SHALL clear the chosen location, subject and witnesses. The subject selector SHALL let the
reporter narrow the options by `employee_number` or by name, SHALL show each option as its
`employee_number` and display name, and SHALL NOT offer the person of the reporter's own account.
The witness selector SHALL NOT offer the chosen subject, SHALL NOT allow the same person twice, and
SHALL NOT allow more than 20 witnesses. The screen SHALL keep refusing to show the form to a role
that cannot report an incident.

#### Scenario: A single site in scope is fixed without asking

- **GIVEN** a `management` account whose scope holds one active site
- **WHEN** it opens the incident report screen
- **THEN** that site is fixed without a site choice
- **AND** the location list holds the active locations of that site

#### Scenario: Changing the site clears what depended on it

- **GIVEN** a `coordinator` with two sites in scope who has chosen a location, a subject and one
  witness at site A
- **WHEN** it switches the site to site B
- **THEN** the location, the subject and the witnesses are empty
- **AND** the offered locations and people are those of site B

#### Scenario: The subject is found by employee number or by name

- **GIVEN** the incident roster of the chosen site holds `DEMO-1001 Alex Boivin` and
  `DEMO-1002 Priya Raman`
- **WHEN** the reporter types `1002` or `raman` in the subject selector
- **THEN** `DEMO-1002 Priya Raman` is offered
- **AND** `DEMO-1001 Alex Boivin` is not

#### Scenario: The reporter is not offered as subject

- **GIVEN** a reporter whose account's `personId` is a person in the incident roster of the chosen
  site
- **WHEN** the subject options are shown
- **THEN** that person is absent from them

#### Scenario: The subject is not offered as witness

- **GIVEN** the reporter has chosen a subject
- **WHEN** the witness options are shown
- **THEN** the subject is absent from them
- **AND** a person already added as witness cannot be added again

#### Scenario: The witness list stops at twenty

- **GIVEN** the reporter has added 20 witnesses
- **WHEN** the witness selector is shown
- **THEN** no further witness can be added

#### Scenario: The submitted identifiers are the chosen ones

- **WHEN** the reporter picks a location, a subject and two witnesses from the lists and submits
- **THEN** the request carries that `location_id`, that `subject_person_id` and those two ids in
  `witness_person_ids`
