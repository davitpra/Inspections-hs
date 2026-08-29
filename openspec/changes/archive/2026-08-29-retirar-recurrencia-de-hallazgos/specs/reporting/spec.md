## REMOVED Requirements

### Requirement: Findings group into series by the stable item concept, never by the published row

**Reason**: Finding recurrence is no longer a product capability; no surface groups findings into series.

**Migration**: None. The dual-identity guarantee that made the grouping correct moves to the `templates` and `findings` capabilities, where it belongs on its own terms.

### Requirement: Two grouping keys answer two different questions

**Reason**: Both groupings are removed with the report that offered them.

**Migration**: Remove the `group_by` parameter and its contract. `location_id` remains on the finding for the operational record.

### Requirement: The window is a parameter measured on the compliance clock

**Reason**: There is no series to window.

**Migration**: Remove the window parameter, its bounds and the `window_months` column of the retired mark. Period boundaries for scheduled inspections stay under the `inspections` capability.

### Requirement: A series is two occurrences or more, and reports its span

**Reason**: The series shape, its span and its ordering have no consumer.

**Migration**: Remove the series contract and its SQL. Individual findings remain readable and ordered under the `findings` capability.

### Requirement: Manually entered findings are outside every series and the report says so

**Reason**: The excluded-count notice existed only to make the report's blind spot visible; without the report there is nothing to qualify.

**Migration**: The underlying fact is preserved as a requirement of the `findings` capability: a manual finding has no `item_key` and is absent from any grouping by concept.

### Requirement: Recurrence is read within the reader's site scope

**Reason**: The read this scoped no longer exists.

**Migration**: None. Site isolation for every surviving read is unchanged and is guaranteed by RLS, not by this requirement.

### Requirement: The site view lists the recurring findings without interpreting them

**Reason**: The `/recurrence` screen is removed.

**Migration**: Remove the route, its navigation entry and its mobile title. No chart, score or aggregate replaces it.
