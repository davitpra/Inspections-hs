## REMOVED Requirements

### Requirement: Coverage counts the periods the site owed, at the frequency its rules declare

**Reason**: Aggregate compliance coverage and its synthetic owed-period rows are no longer product capabilities.

**Migration**: Remove the coverage endpoint and consumers. The annual scheduling surface remains the operational source for opened and not-opened owed periods.

### Requirement: A frozen report stays readable after the payload shape changes

**Reason**: Frozen compliance payloads and their versioned contract are being removed before production use.

**Migration**: Drop the report tables and remove report payload schemas; no compatibility reader is retained.

### Requirement: The exported document names each period unambiguously

**Reason**: The exported compliance document is being removed.

**Migration**: Preserve the shared period-label behavior under the `inspections` capability for operational inspection surfaces.

### Requirement: A period has exactly four states and the open one is never counted as missed

**Reason**: Aggregate report counts are being removed, while scheduled inspections still need their operational period state.

**Migration**: Preserve the four-state derivation and Ontario boundary under the existing scheduled-inspection requirement in the `inspections` capability; remove report counts and synthetic coverage periods.

### Requirement: A generated report freezes its payload and is never recomputed on read

**Reason**: The product will no longer generate or store compliance reports.

**Migration**: Remove generation and read endpoints and drop `compliance_report` in a forward migration.

### Requirement: The digest is computed over the canonical JSON payload and never over the PDF bytes

**Reason**: No frozen payload or PDF remains to verify.

**Migration**: Remove canonical JSON and digest code after confirming that no non-compliance consumer remains.

### Requirement: The report payload carries coverage, findings, recurrence and open actions, with a declared shape version

**Reason**: The composite compliance payload is being removed.

**Migration**: Keep findings, finding recurrence and corrective actions available through their own capabilities and remove only their report projection.

### Requirement: Only the HS coordinator generates a report, and generating one is a recorded act

**Reason**: Report generation and report reading are no longer available to any role.

**Migration**: Remove the generation permission, all report endpoints and their navigation entry.

### Requirement: A report is rendered to PDF asynchronously and every attempt is recorded as a row

**Reason**: Compliance PDF rendering is being removed.

**Migration**: Remove the render job and worker, and drop `compliance_report_render` before `compliance_report`.

### Requirement: The rendered document prints the digest and its provenance on every page

**Reason**: No rendered compliance document remains in the product.

**Migration**: Remove the document renderer and its tests without replacing this footer elsewhere.

### Requirement: The rendered file is stored in the versioned bucket and served by a short-lived signed link

**Reason**: Compliance PDFs and downloads are being removed.

**Migration**: Delete development objects under `{site_id}/reports/` administratively and remove only report-specific storage helpers; evidence uploads retain object storage and signed requests.

### Requirement: The compliance view shows the grid, the fraction and the digest without interpreting them

**Reason**: The `/compliance` product surface is being removed.

**Migration**: Remove the route, navigation, API client and page-specific presentation code. Scheduling remains the surface for operational periods.
