## Why

A template question today says what is asked and how it is answered, and stops there. What to do
when the answer is the bad one is not written anywhere: the inspector answers `no`, the engine
derives a finding, and the HS coordinator retypes — every month, from memory — the same
corrective action and the same level of the control hierarchy that the same failed question has
always deserved. The knowledge that "if the guard is missing, stop the machine and refit it"
lives in one person's head instead of in the document that person authors.

This closes the second half of the builder's authoring surface, stage 8 of requirements-v1.2 §7:
the coordinator stops depending on the developer not only to write questions, but to write what
a failed question means.

## What Changes

- A draft question MAY carry a `finding` block: the corrective action prescribed when the
  question fails, and the level of the control hierarchy that action sits at. A question without
  the block is still publishable — prescribing is optional, and most questions will not.
- A `scale` or a `number` question MAY additionally declare `fails_when` — the threshold that
  counts as a failure. `negative.ts` documents today that "the day an item needs it, the decision
  belongs to the builder and is taken explicitly". This change takes the half of that decision
  that can be taken now: **the threshold is authored, and nothing reads it yet.** Deriving a
  finding from it is a separate change, and until then a `scale` or `number` answer still produces
  no finding.
- The builder gets the panel that edits the block: `Add Finding` on a question row opens a sheet
  showing the question and its answer type read-only, plus the corrective action, the control
  level and — only for `scale` and `number` — the threshold.
- A draft reports three new reasons it cannot be published: a `finding` block with a blank
  corrective action, a `fails_when` on a question type that cannot carry one, and a `fails_when`
  whose value falls outside the item's own bounds.
- `CONTROL_LEVELS` moves from `@hs/contracts` to `@hs/forms` and is re-exported, because the
  document has to be able to name a control level and `contracts` depends on `forms`, not the
  other way round. No import anywhere else changes.

Not in this change, deliberately: publication (which does not exist yet), submission ingestion,
finding derivation, and pre-filling a corrective action's description from the template.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: a draft question can prescribe the corrective action and the control level for its
  own failure, and a `scale`/`number` question can declare the threshold that counts as one; the
  list of what makes a draft non-publishable grows by three entries.
- `findings`: the rule that fixes what counts as a negative answer states explicitly that a
  threshold authored on a template question does not yet produce a finding, so that the authored
  field and the derivation rule cannot be read as contradicting each other.

## Impact

- `packages/forms`: `document/draft.ts` (the block, the three issues), `document/schema.ts` (the
  same optional block on the published item shape — without it `draftIssues`' final safety net
  would mark every draft that uses the feature non-publishable), `document/controls.ts` (new,
  `CONTROL_LEVELS` and `FAILURE_OPERATORS`), `index.ts`.
- `packages/contracts`: `findings.ts` re-exports the control hierarchy instead of defining it.
- `apps/web/src/routes/TemplateDraftRoute/`: `FindingSheet.tsx` (new), `edits.ts`,
  `presentation.ts`, `ItemRow.tsx`, `SectionCard.tsx`, `SectionList.tsx`, plus the sheet's styles
  in `index.css`.
- `apps/api`: none. `saveTemplateDraftSchema` already carries `templateDraftDocumentSchema`, and
  `template_draft.document` is an unconstrained `jsonb` column. **No migration**: the projection
  trigger `hs_template_project_items()` copies eight columns out of the document and ignores the
  rest.
