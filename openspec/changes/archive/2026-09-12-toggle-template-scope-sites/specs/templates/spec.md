## MODIFIED Requirements

### Requirement: The scope choices offered by the builder are the active plants

The authoring interface SHALL offer, as scope choices for a draft, only the plants of the
account's scope that are still active. A removed plant SHALL NOT appear among them, whether
or not the draft being edited already names it.

Each offered plant SHALL be an independent toggle labelled with that plant's name. Turning a
toggle on SHALL add that plant to `site_ids`, and turning a toggle off SHALL remove that plant
without changing the other selected plants. The interface SHALL NOT allow the author to turn
off the final selected active plant.

The choices SHALL be derived from the available active plants rather than from predefined
plant combinations, so an additional active plant in the account's scope appears as another
toggle without replacing or combining the existing choices.

The interface SHALL keep naming a removed plant wherever it is describing a scope that
already names it — the scope summary, the scope notice, and the per-plant location resolution
of a section — so that a stored `site_ids` always reads as a plant name and never as a bare
identifier. Offering and naming are separate jobs: a removed plant is still a name the
interface has to be able to pronounce, and is no longer an answer the author can pick.

When removing a plant leaves the account with a single active plant, the interface SHALL stop
drawing the scope control altogether, on the same grounds it already does for an organisation
configured with one plant: there is nothing left to choose.

This is an interface affordance, not a guarantee. The authoritative refusal is the save, which
rejects a `site_ids` naming a removed plant.

#### Scenario: Each active plant is an independent scope choice

- **GIVEN** an account whose scope covers St. Thomas and Glencoe
- **WHEN** the author opens a draft scoped to both plants
- **THEN** the scope control shows pressed toggles named St. Thomas and Glencoe
- **AND** no combined scope choice is shown

#### Scenario: One plant is removed from a multi-plant scope

- **GIVEN** a draft whose `site_ids` names St. Thomas and Glencoe
- **WHEN** the author turns off the Glencoe scope toggle
- **THEN** the edited `site_ids` names only St. Thomas

#### Scenario: The final selected plant cannot be removed

- **GIVEN** a draft whose `site_ids` names only St. Thomas while another active plant is available
- **WHEN** the author views the scope control
- **THEN** the St. Thomas toggle cannot be turned off
- **AND** the author can turn on another plant before turning off St. Thomas

#### Scenario: A newly available plant becomes a scope choice

- **GIVEN** an account whose active scope covers St. Thomas, Glencoe, and Windsor
- **WHEN** the author opens a draft
- **THEN** the scope control shows one independent toggle for each of the three plants

#### Scenario: A removed plant is not among the scope choices

- **GIVEN** an account whose scope covers St. Thomas and Glencoe, with a third plant removed
- **WHEN** the author opens a draft
- **THEN** the scope choices name St. Thomas and Glencoe and no removed plant

#### Scenario: The scope control disappears when one active plant is left

- **GIVEN** an account whose scope covers St. Thomas and Glencoe
- **WHEN** Glencoe is removed and the author opens a draft
- **THEN** no scope control is shown

#### Scenario: A stored scope naming a removed plant still reads as a name

- **GIVEN** a draft whose stored `site_ids` names Glencoe, which has been removed
- **WHEN** the author opens the draft
- **THEN** the scope summary names Glencoe rather than its identifier
