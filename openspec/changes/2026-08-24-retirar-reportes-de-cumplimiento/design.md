## Context

See `proposal.md` for the product decision. Compliance reporting currently crosses the web app,
shared contracts, the NestJS `reporting` module, pg-boss, Playwright, S3-compatible storage,
Postgres and the audit chain. The same source file that declares report contracts also declares
period frequency, status and labels used by Scheduling and Inspections, while the same NestJS
module also owns the independent finding-recurrence report.

This change explicitly touches the immutable `compliance_report` and
`compliance_report_render` tables introduced by migration 0014. The user confirmed that the
environment contains development data only and chose destructive removal. ADR-002 and ADR-004
still govern every remaining immutable and site-scoped table; ADR-005 still governs the remaining
jobs; ADR-006 still governs evidence-object storage; ADR-008 still governs module direction.

Two other active changes edit Scheduling and template advancement. Their worktree content is not
owned by this change and must be reconciled rather than overwritten where shared contracts,
period presentation or OpenSpec wording overlap.

## Goals / Non-Goals

**Goals:**

- Leave no compliance-report UI, HTTP API, report contract, renderer, queue handler, PDF helper,
  report table or report object in the development environment.
- Preserve scheduled-inspection frequency, annual owed-period projection, derived period status,
  period labels and finding recurrence without compatibility aliases to the removed report model.
- Preserve every existing `audit_log` row and the validity of each site's hash chain.
- Remove Playwright/Chromium and report-only runtime complexity while retaining pg-boss and object
  storage for their other consumers.
- Keep migration history reproducible from an empty database.

**Non-Goals:**

- Replacing R5 with another compliance score, export format or regulatory submission channel.
- Renaming the remaining `reporting` module or capability while it still owns finding recurrence.
- Changing the cadence, opening, assignment, cancellation or submission behavior of scheduled
  inspections.
- Deleting evidence photos or granting object deletion to the application role.
- Rewriting archived OpenSpec changes or accepted ADRs as if the earlier decisions had not existed.

## Decisions

### D1. Remove the report boundary, not the period model or finding recurrence

The removal boundary is aggregate compliance coverage plus frozen report artifacts. The four
period statuses and the 1/3/6/12-month frequency model remain part of scheduled inspections, and
`GET /findings/recurrence` remains part of reporting.

Deleting the whole `reporting` module or the whole current `compliance.ts` contract was rejected:
both contain surviving behavior. Keeping report-named aliases for the shared period concepts was
also rejected because it would leave the removed feature as the dependency direction.

### D2. Move shared period vocabulary to a neutral contract

`PeriodStatus`, `PeriodMonths`, their schemas and labels, and `periodLabel` move to a neutral
`periods.ts` contract exported by `@hs/contracts`. Inspections, submissions and notifications
import that module directly. Report-only schemas and canonical JSON are deleted after their last
consumers disappear.

This is preferred over moving the vocabulary into `inspections.ts`: submissions and notifications
need the same narrow concepts and should not depend on the broader inspection response model.

### D3. Drop immutable report tables in one forward migration

A new migration after 0030 drops `compliance_report_render` first, then `compliance_report`, then
the standalone `hs_compliance_render_audit()` and `hs_compliance_report_audit()` functions. Table
indexes, constraints, grants, policies and attached triggers disappear with their tables. The
Drizzle mirror and barrel export are removed with runtime code.

Migration `0014_compliance_reports.sql` and its journal entry remain unchanged, so a new database
still passes through creation and later retirement deterministically. A revoke-only archive was
rejected because the user selected physical destruction and confirmed there is no production
evidence to retain.

Dropping an obsolete relation is a schema migration, not an application `DELETE`; nevertheless it
retires guarantees previously required by ADR-002. ADR-013 will record the bounded exception and
the pre-production assumption rather than weakening ADR-002 for any surviving data.

### D4. Preserve the audit chain even when its referenced development resource disappears

No `audit_log` row is deleted or rewritten. Historical `compliance_report.generated`,
`compliance_report.rendered` and compliance-related `auditor.read` payloads may refer to report IDs
or object keys that no longer resolve. Their payloads are self-contained historical statements;
retaining them preserves `prev_hash` and chain verification.

Rebuilding the chain without those events was rejected because it would rewrite append-only audit
history and broaden this removal into a change to the trust model.

### D5. Purge report objects administratively, including bucket versions

Development PDF objects use `{site_id}/reports/{report_id}/{render_id}.pdf`. A one-time privileged
operation removes every current object and every historical version under each site report prefix,
then verifies that none remain. Application credentials do not gain `DeleteObject`, and no delete
method is added to `ObjectStorageService`.

Resetting the whole bucket was rejected because the same bucket contains surviving inspection,
finding and action evidence. Leaving old versions behind was rejected because a delete marker is
not data destruction in a versioned bucket.

### D6. Remove PDF runtime integration while retaining shared infrastructure

The render producer, worker and typed job entry are removed. pg-boss remains for period opening and
corrective-action escalation. Report PUT/signed-GET helpers are removed, while S3-compatible
storage and presigned PUT remain for evidence. Playwright, Chromium installation and PDF timeout
configuration are removed because no remaining production code launches a browser.

Existing queued render jobs can be discarded with the development pg-boss data; no drain or
mixed-version production rollout is required under the confirmed environment assumption.

### D7. Make removed HTTP behavior disappear rather than return a retirement response

All five `/reports/compliance` routes and `/compliance` are unregistered. Requests therefore use
the normal not-found behavior. No redirect, tombstone endpoint or compatibility client remains.

This is preferred over a `410 Gone` compatibility layer because there are no external consumers or
production bookmarks to preserve, and the requested result is complete removal.

### D8. Record the product and architecture reversal without rewriting history

The current OpenSpec requirements are removed through deltas and `docs/Requisitos_V1.2.md` is
edited as requested so R5 is no longer current scope. ADR-013 records retirement of the PDF/report
decision and the removal of Playwright as a hosting constraint. Existing ADR files and archived
changes remain historical; indexes and current-context documentation can point to ADR-013.

## Risks / Trade-offs

- [A database containing real report evidence runs the destructive migration] → State the
  pre-production precondition in ADR-013 and the migration comment; inspect row counts before
  applying outside disposable development and stop if the assumption is false.
- [Dropping the parent table before renders fails on foreign keys] → Drop
  `compliance_report_render` before `compliance_report` in the same migration.
- [Audit verification breaks through cleanup] → Never mutate `audit_log`; run chain verification
  after migration with any pre-existing events still present.
- [A versioned PDF survives behind a delete marker] → Purge all versions with administrative
  credentials and verify the report prefixes, not only current object listings.
- [Shared Scheduling behavior is removed because it was named compliance] → Move and test period
  contracts before deleting report contracts; retain `periodStatusCase()` and annual projections.
- [The dynamic `/reports/compliance/:id` removal affects recurrence route resolution] → Keep the
  recurrence controller and its route-order integration coverage intact.
- [Removing `GetObjectCommand` breaks another storage reader] → Search all object-storage consumers
  after report code is gone and remove the symbol only when no remaining read path exists.
- [Concurrent active changes reintroduce stale imports or wording] → Reconcile their current files
  during implementation and run a repository-wide reference check before validation.
- [Destructive rollback cannot recover payloads or PDFs] → Accept irreversible development-data
  loss as the chosen trade-off; rollback restores schema/code only, never removed records.

## Migration Plan

1. Create and validate the OpenSpec deltas and ADR-013, including the development-only destructive
   precondition.
2. Move the shared period contracts and update surviving consumers and tests.
3. Remove the web surface and API endpoints, then remove report generation, rendering, jobs,
   storage helpers and report-only contracts.
4. Add the forward migration and run it through the normal migration runner on a test database.
5. Purge every version under development report prefixes using operator credentials; verify that
   evidence prefixes outside `reports/` are unchanged.
6. Remove Playwright, regenerate the lockfile and clean CI/environment documentation.
7. Run builds, type checking, lint, unit tests and the complete API integration suite.
8. Sync the validated deltas into current specs when the implementation is ready to archive.

Rollback before the migration consists of reverting the application deployment. After the
migration, schema-only rollback requires recreating the retired schema from migration 0014 or
restoring a development database backup; report rows and purged object versions are intentionally
not recoverable. There is no production rollout or data rollback path in scope.
