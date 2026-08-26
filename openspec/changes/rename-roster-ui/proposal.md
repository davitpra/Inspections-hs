## Why

“Roster” is ambiguous for the people who administer the application and does not make clear that the view manages both workplace people and their access. The interface should use direct language that preserves the distinction between a person and a user account.

## What Changes

- Rename the navigation item from “Roster” to “People”.
- Rename the page heading to “People & Access”.
- Replace user-facing “roster” wording in actions, status summaries, dialogs, empty states and supporting account-management messages with people-centered wording.
- Keep `/roster`, API paths, contracts, error codes and internal identifiers unchanged.
- This change does not close a stage of requisitos-v1.2 §7; it exists to clarify the terminology of the already implemented identity administration stage without changing its scope.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `identity`: Clarify the user-facing language required for the site people and access administration view.

## Impact

- Affects visible copy and accessibility labels in `apps/web`.
- Affects web tests that assert the previous wording.
- Does not affect APIs, persistence, authorization, offline packages or external dependencies.
