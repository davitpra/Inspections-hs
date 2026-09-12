## 1. The seed-or-preserve rule

- [x] 1.1 Change the section-location edit in `apps/web/src/routes/TemplateDraftRoute/edits.ts`
      to take the catalog name being chosen and the catalog name the section currently holds,
      instead of one already-resolved title, and to write the chosen name over `section_title`
      only when the current title is empty or equals the current code's catalog name
- [x] 1.2 Wire the already-present `renameSection` to a new section-title handler in
      `SectionList.tsx`, and resolve both catalog names there from the organization locations
      the component already receives

## 2. The title field

- [x] 2.1 Replace the read-only section heading in `SectionCard.tsx` with a controlled text
      input over `section_title`, labelled so a screen reader says which section it belongs
      to, capped at 120 characters
- [x] 2.2 Give the section element its accessible name from the section label now that the
      heading is gone
- [x] 2.3 Rewrite the header comment of `SectionCard.tsx`, which currently states the opposite
      rule; keep the part explaining why the per-plant boxes are read-only
- [x] 2.4 Restyle the title slot in `index.css` for an input rather than a heading, using only
      semantic tokens so the token check keeps passing

## 3. Verification

- [x] 3.1 Cover the rule in `edits.test.ts`: seeds an empty title, re-seeds a title that is
      still the previous catalog name, preserves an authored title, and preserves it when the
      location is cleared; adapt the existing cases to the new signature
- [x] 3.2 Cover the route in `index.test.tsx`: an authored title reaches the saved document,
      and survives a later change of the section's location
- [x] 3.3 Run the focused web tests, the repository build (which runs the token and service
      worker checks), typecheck and lint
