## ADDED Requirements

### Requirement: Capture does not start for an inspection the account is not assigned

The system SHALL refuse to start a draft for a scheduled inspection that is not assigned to the
account holding the device, and SHALL name the reason on the screen instead of presenting the
walkthrough. An inspection assigned to nobody SHALL be refused the same way.

The refusal SHALL be resolvable with no network: the assignment SHALL be read from what the
device already downloaded for that inspection, never from a request made at the moment of
opening. A device that has not downloaded the inspection SHALL continue to report it as not
field-ready, which is a separate refusal with its own reason.

The refusal SHALL be the device declining to begin work, not a claim about what the server would
accept. The server SHALL keep refusing a submission from an account that is not the assigned
inspector regardless of what the device allowed.

#### Scenario: An inspection assigned to someone else does not open for capture

- **GIVEN** a device holding the field package of an inspection assigned to inspector A
- **WHEN** account B, signed in on that device, opens that inspection for capture
- **THEN** no draft is created and the walkthrough is not shown
- **AND** the screen states that the inspection is assigned to someone else

#### Scenario: An unassigned inspection does not open for capture

- **GIVEN** a device holding the field package of an inspection whose inspector is `null`
- **WHEN** any account opens that inspection for capture
- **THEN** no draft is created
- **AND** the screen states that the inspection has no inspector assigned

#### Scenario: The refusal holds with no network

- **GIVEN** a device with no connectivity holding the field package of an inspection assigned
  to another account
- **WHEN** that inspection is opened for capture
- **THEN** the refusal is shown without any request being made

#### Scenario: The assigned inspector captures as before

- **GIVEN** a device holding the field package of an inspection assigned to the signed-in
  account
- **WHEN** the inspector opens it for capture
- **THEN** the draft opens and the walkthrough is shown

### Requirement: A draft whose inspection is no longer the account's cannot be signed

The system SHALL refuse to sign a draft whose inspection is no longer assigned to the account
that holds it, and SHALL state on the review screen why signing is unavailable.

The draft, its answers, its findings and its photos SHALL remain readable on the device. The
system SHALL NOT discard them, and SHALL NOT sign or queue them.

#### Scenario: Reassignment mid-capture blocks signing and keeps the work

- **GIVEN** a draft captured by account A for an inspection that is then reassigned to
  inspector B, and a device that has downloaded the reassignment
- **WHEN** A opens the review screen for that draft
- **THEN** signing is refused and the screen states that the inspection is now assigned to
  someone else
- **AND** the draft and its answers remain readable on the device

#### Scenario: The work is not discarded by the refusal

- **GIVEN** a draft that cannot be signed because its inspection was reassigned
- **WHEN** the device is reopened later
- **THEN** the draft is still listed and still readable

## MODIFIED Requirements

### Requirement: A draft belongs to one device, one owner and one signer

The system SHALL treat a draft as owned by the account that created it on the device that holds
it. The system SHALL NOT merge, replicate or reconcile a draft across devices, and SHALL NOT
attempt to resolve concurrent edits of the same inspection. Signing SHALL be part of the capture
on that device. Once a submission is accepted, the device SHALL treat the inspection as closed and
SHALL NOT allow it to be re-opened for editing.

A queued submission SHALL belong to the same account as the draft it came from. The system SHALL
send a queued submission only while that account is the one signed in, and SHALL NOT show one
account the queue of another. A submission SHALL NEVER be sent under a session other than its
owner's, so that the account holding the device cannot become the signer of work it did not sign.

#### Scenario: A different account does not see another's draft

- **GIVEN** a draft created by account A on a device
- **WHEN** account B signs in on that same device
- **THEN** account A's draft is not listed or readable to B

#### Scenario: A different account does not send another's queued submission

- **GIVEN** a signed submission of account A waiting in the queue on a device
- **WHEN** account B signs in on that device and the queue runs
- **THEN** the submission is not sent
- **AND** it stays in the queue, unchanged, until A signs in again

#### Scenario: An accepted submission cannot be edited

- **GIVEN** an inspection whose submission the server accepted
- **WHEN** the inspector opens it
- **THEN** it is presented read-only
- **AND** no new draft or submission is created for it

#### Scenario: A second device does not receive the draft

- **GIVEN** a draft on device 1 for a scheduled inspection
- **WHEN** the same account opens that scheduled inspection on device 2
- **THEN** device 2 shows no draft content from device 1
