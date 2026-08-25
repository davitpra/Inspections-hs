## REMOVED Requirements

### Requirement: A compliance report and its renders cannot be modified or removed

**Reason**: The two immutable tables are being retired before production use and will no longer be part of the application data model.

**Migration**: Use a forward migration to drop `compliance_report_render` before `compliance_report`. Do not alter the shared engine-enforced immutability mechanism or any other immutable table.

### Requirement: Compliance reports and their renders are isolated by site

**Reason**: The report and render relations to which these policies apply are being removed.

**Migration**: Drop the relations through a migration; their table-scoped RLS policies, grants, constraints and triggers disappear with them. Preserve site isolation for every remaining relation.
