## Context

See `proposal.md` for motivation. The builder currently generates one choice per single plant
plus one choice containing all plants. The draft already stores scope as `site_ids`, and the
server already enforces that the list is non-empty and contains active plants in the account's
scope.

This change is limited to the web builder. It does not touch an immutable table or alter the
database guarantees described by ADR-002 and ADR-004.

## Goals / Non-Goals

**Goals:**

- Represent each selectable plant directly, regardless of how many plants are available.
- Preserve the non-empty scope invariant before a save is attempted.
- Preserve the existing handling and naming of removed plants in stored drafts.

**Non-Goals:**

- Change how `site_ids` is persisted or validated by the API.
- Change the wording used to summarize a complete scope.
- Show plants outside the current account's scope or plants that have been removed.

## Decisions

The presentation helper will continue to own active-plant filtering and ordering, but each
option will contain exactly one plant ID and its configured name. This keeps offering separate
from naming while removing the fixed combinations. Generating every possible combination was
rejected because it grows exponentially and does not behave like independent toggles.

The picker will derive the currently selected active IDs and update only the toggled ID. The
last selected active toggle will be disabled, making the non-empty rule visible and preventing
an invalid local edit. A click that adds an active plant will build the next value from the
selectable IDs, which also gives an old draft a path away from a removed stored plant.

The control will retain `aria-pressed`; these buttons still apply an immediate document edit.
The disabled state on the final selected toggle expresses that it cannot currently be removed.

## Risks / Trade-offs

- [A disabled selected toggle could look less prominent under global disabled styles] → Keep the
  existing selected class, whose specificity preserves the selected appearance while the cursor
  communicates that the button is unavailable.
- [A draft naming only a removed plant has no selected active toggle] → Allow any available toggle
  to be activated; the resulting scope contains that active plant and drops unavailable choices.

## Migration Plan

Deploy the web change without data migration. Rollback restores the previous combination picker;
the persisted `site_ids` format remains compatible in both directions.
