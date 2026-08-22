## Context

See `proposal.md` for the motivation and `specs/catalog/spec.md` plus `specs/identity/spec.md` for
the observable contract.

**This change touches the immutability mechanism, and that must be stated plainly.** It grants the
application role a privilege that `0004_site_location_catalog.sql` §6 explicitly revoked. It grants
`INSERT` and only `INSERT`: the `site_guard` trigger that freezes `id`, `code` and `created_at`,
the `site_forbid_deletion` and `site_forbid_truncate` triggers, and the absence of any `UPDATE`
grant on `site` all remain exactly as they are. A registered site can therefore never be renamed,
never be reidentified and never be removed through the application. ADR-002 and ADR-004 continue to
hold; what changes is which rows the application may bring into existence, not which rows it may
rewrite.

`site` carries no row-level security policy, by the decision recorded with the table, and this
change does not add one. `user_site_scope` carries no policy either, for the reason recorded in
`0005_identity.sql` §10: a policy over the scope that is read in order to build the scope is a
bootstrap circularity. `audit_log` does carry the site policy, and that is what makes the ordering
inside the transaction load-bearing.

## Goals / Non-Goals

**Goals:**

- Expose one coordinator-only operation that registers an active site.
- Make the new site reachable by the account that registered it, atomically with the registration.
- Record the registration in the engine, not in the service, on the audit chain of the new site.
- Keep the registration form in the console that already renders the plants as columns.

**Non-Goals:**

- No rename, no closure, no reactivation of a site from the console; no `UPDATE` grant on `site`.
- No row-level security policy on `site`.
- No administration of another account's site scope from the Locations console.
- No seeding of initial locations into the new plant; it is born empty and the console already
  renders that emptiness as the gap it is.
- No change to the seed files, which keep loading the two initial plants with fixed identifiers.

## Decisions

### Grant only INSERT, and say why the revoke existed

The migration grants `INSERT ON site TO hs_app` and stops there. The revoke in 0004 was not
defensive boilerplate; it encoded a belief about the domain — that an organization's plants are
reference data settled before the software exists. That belief was right for two plants and is
wrong for a third, and the change should record the correction rather than quietly overwrite it.

`UPDATE (name, deactivated_at)` is deliberately **not** granted, even though `location` has it and
the symmetry is tempting. Renaming or closing a plant is a different operation with different
consequences — every calendar, every compliance report and every finding hangs off a site — and
granting it now to be tidy would open a surface no requirement asks for. A site whose `code` was
mistyped stays mistyped; see the risk below.

### Declare the new site's scope before the first audit trigger runs

`hs_scope_audit()` refuses, with SQLSTATE `HS002`, any `user_site_scope` row whose `site_id` is
outside `hs_declared_sites()`, and it writes through `hs_identity_audit_entry`, which inserts into
the policy-protected `audit_log`. The new site is not in the session's `app.site_ids` — that is
precisely the bootstrap circularity 0004 described when it decided `site` would carry no policy.

The registration therefore runs, inside `withSessionClient`:

1. `SELECT gen_random_uuid()` — the identifier before the row.
2. `set_config('app.site_ids', <session scope plus the new id>, true)`.
3. `INSERT INTO site (id, code, name)`, which fires the new `site_audit` trigger.
4. `INSERT INTO user_site_scope (user_id, site_id)`, which fires `hs_scope_audit`.

Taking the identifier first, instead of letting the column default supply it, is what makes step 2
possible at all; it is the same reasoning that made `002_sites.sql` write literal identifiers
rather than call `gen_random_uuid()` inline.

The `set_config` third argument is `true`, so the widened scope is `SET LOCAL`: it dies with the
transaction and a connection returned to the pool carries nothing forward. This is the system's
only place where a service widens a scope the guard produced, and it must be documented beside the
method or it will read as exactly the bug `site-scope.ts` warns about. What makes it sound is the
narrowness: it adds one identifier, created in this same transaction, which has its own
`user_site_scope` row before the transaction commits. It never widens the scope over anything that
existed before the statement ran.

Writing the audit entries from the service instead was rejected for the reason 0004 §4 already
gives about the catalogue: an audit that lives in the service grows a hole the first time a second
write path exists, and the hole is invisible — the operation still works, it simply stops being
recorded.

### Audit site creation in the engine

A new `hs_site_audit()` function and a `site_audit` trigger `AFTER INSERT ON site` write a
`site.created` entry whose `site_id` is the new site's own `id`. It follows `hs_catalog_audit()`
of 0004 §4, including the filler `seq`/`prev_hash`/`hash` values that the chain trigger of 0002
overwrites.

The entry goes on the new site's own chain and nowhere else. The alternative — announcing the new
plant on the existing plants' chains — was rejected on the same principle `hs_scope_audit()`
already applies to grants: that Glencoe recorded something about St. Thomas tells Glencoe nothing.

The trigger is `AFTER INSERT` only. There is no `UPDATE` branch because there is no `UPDATE` grant;
adding one now would describe an operation that cannot happen.

### The creator gets scope, nobody else

Only the registering account receives a `user_site_scope` row. Granting the new plant to every
active coordinator was rejected: it decides other people's permissions from a catalogue screen, and
the roster and account consoles are where that decision belongs and where it is already audited as
such. The consequence is deliberate and visible — a second coordinator does not see the new plant
until someone grants it — and it is the correct default for a system whose confidentiality
requirement is written per site.

### Keep the site form on its own toggle

`LocationsRoute/index.tsx` gains an `addingSite` state independent of `adding`, and the
`Add site` control mounts a single `NewSiteForm` card. Folding it into the existing `adding` panel
was rejected: three forms behind one toggle makes the rare, consequential operation share a control
with the routine one.

The form reuses `suggestCode` and `canCreate` from the route's `presentation.ts` and carries no
`SitePicker` — there is no plant to choose between when the plant is what is being created.

### Refresh the session, not just the site query

The console's columns come from `account.siteScope`, which is the session stored in Dexie, not from
`queryKeys.sites()`. Invalidating the site query alone leaves the new column absent until the
application is reloaded. The form therefore calls both `invalidateQueries(queryKeys.sites())` and
`reload()` from `useAppSession()`, which re-reads `/auth/session` and rebuilds the scope from
`user_site_scope`.

## Risks / Trade-offs

- [Risk] A site registered with a mistyped `code` cannot be corrected: `site_guard` freezes `code`
  for every role, and no `UPDATE` is granted. -> The form derives and displays the code before
  submission, as the location forms already do, and the form's text states that the code is
  permanent. Correcting one remains a migration-role operation, which is the honest cost of not
  granting `UPDATE`.
- [Risk] Widening `app.site_ids` inside a service is the shape of a real security bug, and a future
  reader may copy it somewhere it is not sound. -> Document the invariant beside the method: it may
  add only an identifier created in the same transaction that also inserts its scope row, and it is
  `SET LOCAL`.
- [Risk] A second coordinator does not see the new plant and reads that as a failure of the
  registration. -> The form states, on success, that the plant is scoped to the account that
  registered it and that other accounts are granted it from the account console.
- [Risk] The new plant is born with no locations, so its column is entirely unticked. -> That is
  the state the console exists to display; no seeding is added to hide it.
- [Risk] The existing integration test asserts that the application cannot insert a `site`, so the
  migration turns a passing test into a failing one. -> The change replaces that test in the same
  commit with one that exercises the registration, so the reversal is visible in the diff rather
  than discovered in CI.

## Migration Plan

One forward migration granting `INSERT ON site` and installing `hs_site_audit()` with its trigger.
Deploy the migration, contract, API and UI together; the endpoint does not exist without the grant
and the grant does nothing without the endpoint.

Rollback is a code rollback plus `REVOKE INSERT ON site FROM hs_app` and dropping the trigger. Sites
already registered stay registered — they are ordinary rows, indistinguishable from seeded ones —
and the scope rows already granted stay granted. Nothing written by this change needs undoing, which
is what makes the rollback safe.
