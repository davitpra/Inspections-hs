## MODIFIED Requirements

### Requirement: The document conforms to a shared schema

The system SHALL validate every template document against a single shared schema definition
that lists, for each item, its `item_key`, `prompt`, `section_key`, `section_title`, `position`
and `response_type`. `response_type` SHALL be one of `yes_no`, `yes_no_na`, `scale`, `text`,
`number`, `single_choice`, `multi_choice`, `photo` or `signature`. The schema SHALL be a
discriminated union on `response_type`: each response type declares exactly the configuration
fields it needs, and a configuration field belonging to another response type SHALL be rejected.
Any document that does not conform SHALL be rejected at load time rather than at inspection time.

New sections and items authored in the editor SHALL receive an opaque 12-character lower-case
alphanumeric `section_key` or `item_key` at creation time. The editor SHALL NOT expose either key
as an editable field or derive it from user-entered text. A newly authored section SHALL also carry
the `organization_location_code` selected from the organization catalog. Historical documents
created before the organization catalog may omit that field and remain readable.

A section's `section_title` SHALL be offered to the author as editable text. Selecting an
organization location SHALL seed that title with the catalog entry's name, and the editor SHALL
NOT overwrite a title the author wrote: when a section's `organization_location_code` changes,
the new catalog name SHALL be written only if the current `section_title` is empty or still
equals the catalog name of the code the section named before. A section SHALL still name at
most one `organization_location_code`, and findings SHALL continue to be grouped by that code
rather than by the title text.

#### Scenario: Rewording does not change an opaque item identity

- **WHEN** an author changes the prompt of an existing item
- **THEN** its `item_key` remains unchanged
- **AND** no key field is shown in the editor

#### Scenario: A section uses a catalog location

- **WHEN** an author selects an organization location for a section whose `section_title` is empty
- **THEN** the draft stores its code as `organization_location_code`
- **AND** the draft stores the catalog name as `section_title`

#### Scenario: An author writes a section title of their own

- **WHEN** an author replaces a section's `section_title` with text of their own
- **THEN** the draft stores that text as `section_title`
- **AND** the section's `organization_location_code` is unchanged

#### Scenario: Changing the location keeps a title the author wrote

- **GIVEN** a section naming an organization location whose catalog name is `Shipping dock`
- **AND** whose `section_title` the author has rewritten as `Docks and aisles`
- **WHEN** the author selects a different organization location for that section
- **THEN** the section's `organization_location_code` becomes the newly selected code
- **AND** its `section_title` remains `Docks and aisles`

#### Scenario: Changing the location re-seeds a title that was still the catalog name

- **GIVEN** a section naming an organization location whose catalog name is `Shipping dock`
- **AND** whose `section_title` is `Shipping dock`
- **WHEN** the author selects an organization location whose catalog name is `Boiler room`
- **THEN** its `section_title` becomes `Boiler room`

#### Scenario: Clearing the location keeps a title the author wrote

- **GIVEN** a section whose `section_title` the author has rewritten as `Docks and aisles`
- **WHEN** the author clears the section's organization location
- **THEN** the section no longer names an `organization_location_code`
- **AND** its `section_title` remains `Docks and aisles`

#### Scenario: A section left with no title is reported and cannot be published

- **WHEN** an author empties a section's `section_title`
- **THEN** the draft is saved with that empty `section_title`
- **AND** the draft reports that section as having no title
- **AND** publication of that draft is refused

#### Scenario: A malformed seed document fails the build

- **WHEN** the validation suite parses every template document shipped as a seed
- **AND** one document declares an item with no `item_key`
- **THEN** validation fails and reports the offending template and item

#### Scenario: An unknown response type is rejected

- **WHEN** a document declares an item with `response_type` `"rating_stars"`
- **THEN** validation fails and names `response_type` as the offending field

#### Scenario: A configuration field from another response type is rejected

- **WHEN** a document declares an item with `response_type` `"text"` that also carries `options`
- **THEN** validation fails and names `options` as a field the `text` response type does not accept

#### Scenario: Duplicate positions within a section are rejected

- **WHEN** a document declares two items in the same `section_key` with the same `position`
- **THEN** validation fails and names the section and the duplicated `position`
