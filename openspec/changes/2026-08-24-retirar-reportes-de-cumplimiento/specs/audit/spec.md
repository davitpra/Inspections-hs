## REMOVED Requirements

### Requirement: The generation of a compliance report is recorded in the chain by the database

**Reason**: Compliance report generation and the `compliance_report` table are being removed.

**Migration**: Drop the report audit trigger and function with the table. Existing `compliance_report.generated` entries SHALL remain unchanged in `audit_log` so each site's existing hash chain continues to verify.

### Requirement: Every successful render of a compliance report is recorded in the chain

**Reason**: Compliance rendering and the `compliance_report_render` table are being removed.

**Migration**: Drop the render audit trigger and function with the table. Existing `compliance_report.rendered` entries SHALL remain unchanged in `audit_log` even after their development PDF objects are deleted.
