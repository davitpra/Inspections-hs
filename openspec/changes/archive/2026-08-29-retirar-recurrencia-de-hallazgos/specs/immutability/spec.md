## REMOVED Requirements

### Requirement: The recurrence mark is fully immutable

**Reason**: `finding_recurrence` is dropped in a forward migration; there is no table left to make immutable.

**Migration**: Drop the table with its GRANTs and guard triggers. Every surviving table keeps both barriers of the mechanism, and `audit_log` rows referencing the retired resource are preserved unchanged.

### Requirement: The recurrence mark is isolated by site

**Reason**: The table the policy applied to is dropped.

**Migration**: Drop the table with its isolation policy. Site isolation for every surviving table is unchanged.
