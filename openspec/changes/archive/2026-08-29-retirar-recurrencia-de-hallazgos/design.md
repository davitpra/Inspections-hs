## Context

See `proposal.md` for the product decision. Finding recurrence currently crosses the web app, the
shared contracts package, the NestJS `reporting` module, the submission-ingestion transaction,
Postgres and the audit chain. After ADR-013 the `reporting` module owns exactly one route, so
removing recurrence removes the module and the capability with it.

This change explicitly touches the immutable `finding_recurrence` table introduced by migration
0013 and altered by 0019. The environment contains development data only, and destructive removal
was chosen. ADR-002 and ADR-004 still govern every remaining immutable and site-scoped table;
ADR-008 still governs module direction, including the declared exception that lets `inspections`
call `findings`.

Three other active changes edit findings, roster and actions. Their worktree content is not owned
by this change and must be reconciled rather than overwritten where finding fixtures, contracts or
OpenSpec wording overlap.

## Goals / Non-Goals

**Goals:**

- Leave no recurrence UI, HTTP route, contract, ingestion write, table, index or supporting
  constraint in the development environment.
- Preserve the dual identity end to end: `item_key` global, write-once, indexed, and unchanged in
  templates, answers and findings.
- Preserve every existing `audit_log` row and the validity of each site's hash chain, including
  read events recorded against the retired resource.
- Keep the risk A acceptance test running in CI, restated as concept continuity.
- Keep migration history reproducible from an empty database.

**Non-Goals:**

- Replacing recurrence with another series, score, trend or aggregate.
- Removing or renaming `item_key`, its indexes or its uniqueness.
- Touching the scheduling recurrence rules of `inspection_schedule`, which are a different
  concept.
- Rewriting archived OpenSpec changes, accepted ADRs or historical migrations as if the earlier
  decisions had not existed.

## Decisions

### D1. Retire both halves, not just the read

The mark and the series answer different questions, and the mark is the one that costs on every
submission. Keeping `finding_recurrence` after removing its only reader would leave an immutable
table written inside the riskiest transaction of the system for nobody, and would leave the
`findings` and `immutability` specs asserting guarantees about data no surface consumes. Both go.

### D2. `item_key` survives, and the risk A test survives with it

Recurrence was the most visible consumer of `item_key`, not the one that justifies it: publishing
a version, advancing to the next one and reading back a submitted inspection all resolve a
question across the versions that edited it. The spike 3 acceptance test therefore stays, with its
own `GROUP BY item_key` written inside the test rather than borrowing a product query. Its
assertion changes from "one series of four" to "one group of four" — same rows, same failure mode,
no phantom consumer.

### D3. The destructive migration also drops what only existed to support the mark

`finding_recurrence_idx` (0010) is a partial index on `finding` created for the recurrence
`GROUP BY`, and `finding_id_item_key_uq` (0013) is a UNIQUE on `finding` created solely as the
destination of the mark's composite foreign key. Both lose their only reason to exist and are
dropped in `0038`. `finding_id_site_uq`, `finding_inspection_idx` and `finding_site_recorded_idx`
stay: they serve `finding_photo` and the findings listing.

`DROP TABLE` carries the table's GRANTs, its `hs_apply_site_isolation` policy, its
`hs_make_immutable` triggers, its CHECKs and its UNIQUE. Unlike `compliance_report` in 0031, the
mark never had a bespoke audit function, so there is none to drop.

### D4. `audit_log` is not touched

Read events recorded with `resource: 'finding_recurrence'` describe reads that happened. They stay
exactly as written, and the chain still verifies. This is the same rule ADR-013 and ADR-014
applied, and it is what makes the migration safe to run in a database with history.

### D5. `reporting` disappears as a capability, rather than being kept empty

ADR-013 kept `reporting` alive precisely because recurrence remained. With no requirement left,
the honest record is removal: the capability leaves `openspec/config.yaml` and
`openspec/specs/reporting/` is deleted at sync time. A capability with an empty spec would invite
the next change to refill it.

## Risks / Trade-offs

- **The recurrence question can be asked again later, from scratch.** Nothing in the surviving
  schema forecloses it: `item_key`, `location_id` and `occurred_at` are all still there, and the
  index that made the query fast is the only thing lost. Re-adding it is a new migration, not a
  recovery.
- **Historical marks are unrecoverable after `0038`.** They describe development submissions and
  were never displayed, so the loss is accepted under the preproduction precondition. Outside that
  precondition the deployment stops.
- **§5 risk A loses its headline feature but not its teeth.** The risk was always about the schema
  grouping wrongly and failing silently; that is still true of every read that resolves a question
  across versions, and the acceptance test still runs.
