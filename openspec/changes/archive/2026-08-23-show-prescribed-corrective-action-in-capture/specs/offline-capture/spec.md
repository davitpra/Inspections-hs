## ADDED Requirements

### Requirement: A negative answer shows the corrective action its question prescribes

The system SHALL show the `corrective_action` of the answered question's `finding` block
alongside the finding details, as soon as an answer is entered as negative, on the same
screen and without any network request. The text SHALL be shown exactly as it was frozen
into the published document — the device holds it from the field package and never asks
for it.

The system SHALL show the prescription as reading only: it SHALL NOT be editable, and it
SHALL NOT prefill or alter the description the inspector writes. What the author decided
months ago about the question and what the inspector saw today are two different records,
and a prescription copied into the inspector's own words would be signed as an observation
nobody made.

The system SHALL show nothing at all when the answered question carries no `finding`
block: no placeholder, no empty heading, and no statement that no corrective action is
defined.

The system SHALL NOT show the `fails_when` threshold of the `finding` block. The engine
does not read that threshold, and showing it during the walkthrough would present a value
the system never applies as if it governed the answer.

#### Scenario: A negative answer shows what the template prescribes

- **GIVEN** an inspection open with the network disabled
- **AND** a `yes_no` question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers that question `false`
- **THEN** the prescribed `corrective_action` is shown for that item
- **AND** the description field for that item is still empty
- **AND** no network request is made

#### Scenario: A question that prescribes nothing shows nothing

- **GIVEN** a `yes_no` question that carries no `finding` block
- **WHEN** the inspector answers it `false`
- **THEN** the description field, and the camera control are shown for that item
- **AND** no corrective action text is shown for that item

#### Scenario: The prescription is not the inspector's description

- **GIVEN** a question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers it `false` and signs without typing a description
- **THEN** the inspection is refused as incomplete for that item
- **AND** the prescribed text is not submitted as the finding's description

#### Scenario: `na` shows no prescription

- **GIVEN** a `yes_no_na` question whose `finding` block prescribes a `corrective_action`
- **WHEN** the inspector answers it `na`
- **THEN** no corrective action text is shown for that item
