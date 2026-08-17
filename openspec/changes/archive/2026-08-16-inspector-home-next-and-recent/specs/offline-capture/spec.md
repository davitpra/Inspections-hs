## ADDED Requirements

### Requirement: An assignment can be previewed read-only without becoming a draft

The system SHALL let an inspector open an assignment in a preview that presents the frozen
template's sections and questions and accepts no input: no answer is recorded, no finding is
opened, no photo is captured and no signature is taken.

The preview SHALL create nothing on the device. Opening it SHALL NOT create a draft, SHALL NOT
mark the assignment as started, and SHALL NOT change whether the assignment is ready for the
field. An inspector who previews an assignment and returns SHALL find that assignment
described exactly as before.

The preview SHALL be available for an assignment whose field package is not on the device,
which is its purpose: the month that has not opened yet is the one an inspector wants to look
at before committing to it. Where the device already holds the frozen template, the preview
SHALL use it; otherwise it SHALL request it, and where it can do neither it SHALL say so
rather than present a partial walk.

The preview SHALL present every question of the template, including those a condition would
hide while nothing is answered, so that it does not describe a shorter walk than the one the
inspector will actually make.

Previewing is not capturing, and the requirement that capture is refused on a device that is
not field-ready is unaffected: an inspector who previews an assignment SHALL still have to
download it before any answer can be recorded.

#### Scenario: Previewing writes nothing to the device

- **GIVEN** an assignment with no draft on the device
- **WHEN** the inspector opens it as a preview
- **THEN** the template's sections and questions are presented
- **AND** no draft is created for that assignment
- **AND** the assignment is still reported as not started

#### Scenario: A month that has not been downloaded can still be previewed

- **GIVEN** an assignment whose field package is not on the device
- **WHEN** the inspector opens it as a preview and the template can be retrieved
- **THEN** the questions are presented read-only
- **AND** the assignment is still reported as needing to be downloaded

#### Scenario: The preview accepts no answer

- **GIVEN** an assignment presented as a preview
- **WHEN** the inspector attempts to answer one of its questions
- **THEN** the answer is not accepted and nothing is recorded

#### Scenario: A conditional question is shown in the preview

- **GIVEN** a template with a question shown only when an earlier one is answered negatively
- **WHEN** the inspector opens the assignment as a preview, with nothing answered
- **THEN** that question is presented among the others

#### Scenario: The template cannot be reached

- **GIVEN** an assignment whose template is neither on the device nor retrievable
- **WHEN** the inspector opens it as a preview
- **THEN** the screen states that the preview could not be loaded
- **AND** no partial set of questions is presented
