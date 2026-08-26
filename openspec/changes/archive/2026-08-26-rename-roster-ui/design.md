## Context

The application currently uses “Roster” for both the visible administration destination and internal concepts such as field packages, query keys and import error codes. The view combines all people at one site with the account and JHSC access attached to the minority who can sign in. See `proposal.md` for the terminology problem.

## Goals / Non-Goals

**Goals:**

- Give the destination a short navigation label and a descriptive page heading.
- Use consistent people-centered copy throughout the visible workflow.
- Preserve the Persona ≠ Usuario boundary described by ADR-011.

**Non-Goals:**

- Renaming routes, source files, symbols, contracts, commands, database concepts or error codes.
- Changing permissions, behavior, data or offline packages.

## Decisions

### Use “People” for navigation and “People & Access” for the heading

“People” is concise enough for navigation and does not incorrectly imply that every row is a user account. The longer heading describes the two responsibilities of the page. “Users” was rejected because most people have no account; “Employees” was rejected because it unnecessarily narrows the model; “Staff Directory” was rejected because the view performs administration rather than read-only lookup.

### Limit the rename to user-facing copy

Internal `roster` identifiers remain stable because they are established domain and integration vocabulary, including the field package and CSV import. Renaming them would increase regression risk without improving the interface. ADR-001 remains applicable to the offline roster package; this change does not alter it.

### Preserve route compatibility

The `/roster` URL remains unchanged so bookmarks and deployed navigation remain compatible. This is a copy change, not a URL migration.

This change does not touch an immutable table or any database table.

## Risks / Trade-offs

- [Risk] A visible “roster” string may remain in a secondary state or dialog. → Search application source and update assertions covering every affected workflow.
- [Trade-off] The URL continues to say `/roster`. → Keep the stable internal URL because it is normally invisible and avoids a compatibility migration.
