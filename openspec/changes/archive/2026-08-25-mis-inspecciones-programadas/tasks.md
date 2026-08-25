## 1. Route ownership

- [x] 1.1 Make the scheduled-inspections list the `/` route while preserving the accepted
      submission search parameter.
- [x] 1.2 Add `/inspections/$id` for one selected pending assignment and remove the
      unpublished `/inspections/scheduled` route and title.
- [x] 1.3 Add the detail title without adding a new navigation item.

## 2. Inspector home list

- [x] 2.1 Move the install prompt and accepted-submission acknowledgement to the list home.
- [x] 2.2 Make the requirement and ready-row action navigate to `/inspections/$id`, while
      retaining package download in rows that need it and no operational action while local
      readiness is unresolved.
- [x] 2.3 Preserve access to past inspections and the device-draft list, including discard,
      on the root surface.

## 3. Selected inspection detail

- [x] 3.1 Resolve the exact pending inspection from the route id with the existing pending,
      sites, and drafts cache keys.
- [x] 3.2 Compose only the assignment hero, progress, instructions, and site information,
      with a back link to the complete list.
- [x] 3.3 Add loading, connection-error, and unavailable-assignment states that never
      substitute another pending inspection or offer capture incorrectly.

## 4. Cleanup and presentation

- [x] 4.1 Move route-owned components to folders that match their new route ownership.
- [x] 4.2 Remove automatic focused/next assignment selection and obsolete Home-only
      components and tests.
- [x] 4.3 Adjust semantic-token styles for links and the detail shell without literal colors.

## 5. Tests

- [x] 5.1 Cover the root list, accepted acknowledgement, history and local drafts, package
      download, and navigation to detail without a direct capture jump.
- [x] 5.2 Cover exact-id detail selection, start/resume/open actions, back navigation,
      loading, connection error, and an unavailable id.
- [x] 5.3 Cover router section titles and preserve review's accepted return to `/`.

## 6. Verification

- [x] 6.1 Validate the revised change with
      `openspec validate mis-inspecciones-programadas --strict`.
- [x] 6.2 Run build before typecheck, lint, and unit tests.
