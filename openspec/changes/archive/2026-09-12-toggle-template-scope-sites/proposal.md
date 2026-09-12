## Why

The template builder models plant scope as a fixed set of mutually exclusive combinations, which does not scale beyond the current two plants. Authors need to toggle each active plant independently while the interface preserves the existing non-empty scope invariant.

## What Changes

- Replace the individual-only and "Both plants" scope choices with one independent toggle per active plant.
- Prevent the author from turning off the final selected plant.
- Derive the toggles from the account's active plants so newly added plants appear without another UI change.
- Keep the existing summary wording and persisted `site_ids` representation.

This change refines stage 8 of requirements v1.2 section 7: the visual builder remains usable as the organisation adds plants without depending on a developer to add fixed scope combinations.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: The builder's active-plant scope choices become independent non-empty toggles generated from the available plants.

## Impact

- `apps/web/src/routes/TemplateDraftRoute/ScopePicker.tsx`
- Template builder presentation helpers, styles, and route tests
- No API, database, contracts, or dependency changes
