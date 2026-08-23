# Design — Guard the declared scope in the site audit trigger

## Context

See `proposal.md` — Why. What shapes the approach is where the refusal comes from today.

`audit_log` carries `hs_apply_site_isolation` (`0001` §), which is `ENABLE` **and** `FORCE`
row level security with `site_id = ANY (string_to_array(current_setting('app.site_ids',
true), ',')::uuid[])` in both `USING` and `WITH CHECK`. FORCE is why even `hs_migrator`, the
owner, is subject to it. `hs_site_audit` is a plain `plpgsql` trigger function — not
`SECURITY DEFINER` — so its `INSERT INTO audit_log` runs under the caller's role and the
caller's declared scope.

The creation branch has carried its own escape since `0022`:

```sql
IF NOT (NEW.id = ANY (hs_declared_sites())) THEN
  PERFORM set_config('app.site_ids', NEW.id::text, true);
END IF;
```

`hs_declared_sites()` (`0005` §) already returns the declared ids as a `uuid[]`, which is
what makes widening a one-line change rather than string surgery.

The current version of the whole function lives in `0026_reactivate_site.sql`, not in
`0023`: `0026` replaced it to add the `site.reactivated` branch. That is the version to
start from.

**This change touches no table.** No immutable table, no privilege, no policy — a single
`CREATE OR REPLACE FUNCTION`.

## Goals / Non-Goals

**Goals:**

- Creating a site never costs the transaction a declaration it already had.
- A write to `site` without the matching declaration fails saying so, at the point where it
  is still obvious what to do about it.
- The `audit` spec states which of the four events works unscoped, instead of implying all
  of them do.

**Non-Goals:**

- Letting the update branches declare their own scope. That is the behaviour this change
  confirms; see the decision below.
- Any change to what the entries contain, to the chain, or to who may write to `site`.
- Rescuing callers. A seed that deactivates a plant will still have to declare it — it will
  just be told so.

## Decisions

### Creation widens; renaming, deactivating and reactivating refuse

The asymmetry is the design, and this change makes it explicit rather than removing it.

Creation must work unscoped because the site did not exist a moment ago and therefore
cannot be in anyone's scope, and because `catalog` requires that a seeded site be recorded
the same way as one registered from the console. Nothing weaker would satisfy that.

An update is the opposite case. The transaction is writing about a plant that already
exists and that it did not claim, and the whole point of `app.site_ids` is that a
transaction sees and touches what it declared. Self-declaring there would let any caller
widen its own scope as a side effect of an `UPDATE` — and because `set_config(..., true)` is
transaction-local, the widened scope would outlive the statement and quietly change what
every later statement in that transaction can see.

*Alternative considered: make the update branches self-declare, mirroring creation.*
Rejected on the isolation argument above. It would have made the failing test pass by
weakening the property the test suite exists to protect.

*Alternative considered: make the function `SECURITY DEFINER` so the audit insert bypasses
the policy.* Rejected: FORCE RLS on `audit_log` is deliberate (`0001` says so in as many
words), and a trigger that writes entries nobody's scope allows is a hole in the same
property, opened from a different side.

### Widening is `hs_declared_sites() || NEW.id`, not string concatenation

The helper already returns `uuid[]`, so appending and re-joining is exact: no separator
bugs, no empty-string case, and the existing `IF NOT (NEW.id = ANY (...))` guard keeps it
idempotent when the service has already declared the id — which is what the HTTP path does
before inserting.

### The refusal is raised in the trigger, with its own SQLSTATE

`HS013`, the next free code (`HS012` is the last in use, in `0012_incidents.sql`). Raised
before the first `INSERT INTO audit_log`, so no partial entry is attempted, with a message
naming the site and a `HINT` naming `app.site_ids`.

It belongs in the trigger and not in `sites.service.ts` because the service is not the
caller that gets this wrong: it already declares the session's scope, and the console only
offers sites within it. The callers that can reach the refusal are seeds, server commands
and tests — none of which pass through the service. A check in the service would sit where
the mistake never happens.

No application code translates `HS013`, and that is correct: an HTTP request cannot reach
it. If one ever does, it is a bug in the service, and a 500 naming the site is the right
outcome for a bug.

### The trigger is not recreated

`CREATE OR REPLACE FUNCTION` is enough — the `site_audit` trigger already points at
`hs_site_audit`. `0023` and `0026` both recreate it, so the migration says out loud why this
one does not, to keep the difference from reading as an omission.

## Risks / Trade-offs

- **A seed or command that renames or deactivates a plant now fails loudly where it used to
  fail obscurely.** → That is the change. Nothing that worked stops working: an unscoped
  update failed before too, just unreadably.
- **`HS013` is a new SQLSTATE nobody catches.** → Deliberate. It is unreachable from HTTP,
  and giving it a handler would suggest a caller that should exist and does not.
- **Widening the scope on creation makes a transaction see slightly more than it declared.**
  → It already did; the previous behaviour saw *differently*, not less — it replaced the
  declaration with the new id. Adding is the smaller of the two effects, and it is confined
  to a site the same transaction just created.

## Migration Plan

`0027_site_audit_scope_guard.sql`: one `CREATE OR REPLACE FUNCTION hs_site_audit()`, copied
from `0026` with two edits — the widening in the `INSERT` branch, and the guard at the top
of the update path. Forward-only, like every migration here. Rollback is replacing the
function again; no data is touched and no privilege moves, so nothing has to be undone.
