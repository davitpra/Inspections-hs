# Guard the declared scope in the site audit trigger

## Why

`apps/api/test/scheduling-console.int-spec.ts` stopped starting altogether — 26 tests
skipped — with `new row violates row-level security policy for table "audit_log"`. The
cause was in its own `beforeAll`: it deactivated a site without declaring that site in
`app.site_ids`, the `site_audit` trigger wrote the `site.deactivated` entry, and the policy
refused it. The test was wrong and has been corrected.

**What the investigation left behind is worth fixing, and it is not the asymmetry.** The
trigger self-declares the scope when a site is created and does not when one is updated,
and that is right: a site being created cannot possibly be in anyone's scope yet — which is
why `catalog` requires a seeded site to be audited — while an update to a site the
transaction never claimed is exactly what the isolation exists to catch. Self-declaring
there would let a transaction widen its own scope to write about a plant it never named.

Three smaller things came out of it, none of them biting in production today:

- **The creation branch overwrites `app.site_ids` instead of widening it.**
  `set_config('app.site_ids', NEW.id::text, true)` writes the whole value.
  `apps/api/seeds/002_sites.sql` inserts two plants in one statement, so the second row
  erases the first's declaration and the transaction ends with a scope nobody chose. It
  does not bite because `scripts/seed.mjs` runs one file per transaction and every later
  seed declares its own — it is a trap waiting for a file that inserts a plant and then
  writes site-scoped rows.
- **The failure is unreadable.** It arrives as an RLS refusal on `audit_log`: it names
  neither `site`, nor the plant, nor the missing declaration. Locating it cost a full run
  of the integration suite. It fails far from its cause and without naming it, which is the
  shape of failure this project treats as a risk rather than an inconvenience.
- **The `audit` spec promises more than the engine delivers.** *"…SHALL use a null
  `actor_user_id` for seed or migration activity"* is true of `site.created` and false of
  renaming, deactivating and reactivating: from a seed with no declared scope, those three
  fail.

This change does not close a stage of §7. It hardens what `0022`, `0023` and `0026` left,
and it exists because the next person to hit this should read an error that tells them what
to do instead of an RLS refusal on a table they were not writing to.

## Lo que este change NO es

- **It does not change who may write to `site`.** No `GRANT`, no `REVOKE`, no policy. The
  by-column `GRANT UPDATE (name, deactivated_at)` of `0023` stays exactly as it is.
- **It does not make the update branches self-declare.** That is the behaviour being
  confirmed, not the behaviour being fixed.
- **It does not touch the audit chain.** No change to `seq`, `prev_hash`, `hash` or the
  trigger that computes them; the entries written are the same entries, with the same
  payloads.
- **It does not change the HTTP path.** `sites.service.ts` already widens the scope
  correctly before creating a site, and its docblock already explains why. Nothing there
  moves.

## What Changes

- **Creating a site widens the declared scope instead of replacing it.** The new plant is
  appended to whatever the transaction had already declared, so inserting two plants in one
  statement leaves both declared.
- **Renaming, deactivating or reactivating a site the transaction has not declared is
  refused by the engine, by name.** A dedicated SQLSTATE and a message that names the plant
  and says the declaration is what is missing, raised before any audit entry is attempted.
- **The `audit` spec says which of the four site events works without a declared scope**,
  instead of implying all of them do.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `audit`: the requirement covering site lifecycle entries gains the condition under which
  they can be written at all. Today it states that the entries use a null actor for seed or
  migration activity, which reads as a promise that any write path works unscoped; only
  creation does. The requirement gains the declaration rule and the refusal, and narrows the
  seed sentence to the event it is true of.

## Impact

- **One migration, `0027_site_audit_scope_guard.sql`**, and it touches no table: a single
  `CREATE OR REPLACE FUNCTION hs_site_audit()`. No immutable table is involved, no privilege
  moves, and the trigger is not recreated — it already points at the function.
- `apps/api/test/catalog.int-spec.ts`: the three new scenarios, alongside the site-audit
  tests already there.
- `apps/api/seeds/002_sites.sql`: a comment, because its existing note about why the ids are
  literals is the right place to say what the transaction ends up declaring.
- No application code. Nothing reaching the new SQLSTATE goes through HTTP: the service
  declares its scope, so the only callers that can hit it are seeds, server commands and
  tests.
