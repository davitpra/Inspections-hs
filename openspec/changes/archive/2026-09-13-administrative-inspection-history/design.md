## Context

See `proposal.md` for the motivation and scope. The API's scheduled-inspection and findings
queries already run inside the session's site-scoped RLS transaction and return the data needed
by both screens. The current frontend presentation helper applies the account-owner filter to
both screens, while `isAdministrator` already defines the shared administrative roles.

## Goals / Non-Goals

**Goals:**

- Centralize the role decision so History and Findings use the same visibility rule.
- Identify the completing inspector in administrative rows using the existing `inspector_name` field.
- Preserve the existing completed-status, grouping, ordering and findings-only behavior.
- Keep `jhsc_member` behavior unchanged.
- Keep site isolation enforced by the existing session scope and RLS.

**Non-Goals:**

- Changing API authorization, database schema, migrations or RLS policies.
- Expanding the Home matrix, personal pending list or local drafts.
- Granting administrators global access to sites outside their active scope.

## Decisions

- **Use the existing administrator predicate.** Add a named frontend permission for inspection
  review that delegates to the common `isAdministrator` rule. This keeps role vocabulary in
  `permissions/` and avoids duplicating role literals in routes. The alternative was checking
  `account.role` in each route, which would duplicate policy and make the two screens diverge.
- **Keep a single role-aware completed-inspection selector.** Extend the pure presentation
  selector with the account role and retain the owner filter only for non-administrators. This
  ensures status filtering and sorting remain identical for all roles. The alternative was two
  independent selectors, which would make future behavior drift more likely.
- **Rely on the server-provided site-scoped collection.** Administrative visibility means all
  completed rows returned for the session, not a client-side site query or a global role bypass.
  This follows ADR-002/ADR-004 and preserves RLS as the security boundary.
- **Do not change the API or persistence layer.** The requirement is a frontend visibility bug;
  changing the endpoint or schema would add no capability and would broaden the risk surface.
- **Make the inspector column administrative-only.** The shared table receives a boolean from
  each route, so the existing personal view remains unchanged while both administrative surfaces
  expose the same field and fallback. The alternative was duplicating table markup in each route.

This change does not touch an immutable table, add a migration, or alter grants. It follows
ADR-002/ADR-004 for site isolation and ADR-008 for keeping the role decision and pure route
presentation logic in their respective layers.

## Risks / Trade-offs

- **[Risk]** The administrative screens consume the full site-scoped scheduled-inspection list,
  so their rendered history can grow faster than a personal history. **Mitigation:** preserve the
  existing endpoint and ordering; pagination remains a separate concern.
- **[Risk]** A role-aware shared helper could accidentally expand Home or another consumer.
  **Mitigation:** pass the administrative role only from Historical and Findings and keep tests for
  personal Home semantics and the existing helper consumers.
- **[Risk]** Frontend visibility is not a security boundary. **Mitigation:** keep the backend's
  session scope and RLS unchanged and test that out-of-scope data remains absent.

## Migration Plan

No data migration or deployment migration is required. Deploy the frontend with the role-aware
selector; rollback is a frontend rollback to the previous bundle. API, contracts and database
objects remain compatible.
