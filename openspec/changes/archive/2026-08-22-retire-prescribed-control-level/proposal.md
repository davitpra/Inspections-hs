## Why

Stage 8 of requirements-v1.2 §7 gave a draft question a `finding` block with two fields:
the corrective action prescribed for its failure, and the level of the control hierarchy that
action sits at. The second one was a mistake, and it is cheaper to say so one commit later than
after the first plant publishes a template.

**A control level is a judgement about a hazard that exists, not about a question.** The
hierarchy — elimination, substitution, engineering, administrative, PPE — answers "how good is
the control we actually put in place for THIS finding", and the system already asks it at the
only moment it can be answered honestly: when the HS coordinator classifies a real finding, with
the probability and the severity of that finding in front of them. Asking the same question
months earlier, of an author looking at a blank question and no hazard, produces a value that
nobody chose — in practice whatever the select was left on. A field that is filled by default
rather than by decision is worse than an absent one: it looks like evidence.

The corrective action does not have this problem, and stays. "If the guard is missing, stop the
machine and refit it" is knowledge about the question itself, and it is the same sentence every
month.

This change does not close a new stage of §7; it corrects the shape of stage 8, which
`2026-08-22-question-prescribes-corrective-action` delivered.

## What Changes

- **BREAKING** — the `finding` block of a draft question no longer carries `control_level`. It
  carries `corrective_action`, plus `fails_when` on `scale` and `number` questions. The block
  schema is a `strictObject`, so a document that still names `control_level` is now **rejected**,
  in the draft shape and in the published one alike.
- The Finding sheet in the template builder drops its `Control level` select. What the author
  fills in is the corrective action and, for a measured question, the threshold.
- A migration strips `finding.control_level` from every stored `template_draft.document`, so a
  draft authored before this change can still be saved. Published documents are immutable
  (ADR-002) and are **not** rewritten: the migration refuses to run if any `template_version`
  carries the field, because the only honest resolution then is a decision, not a silent UPDATE.
- Nothing changes about risk classification. `finding_risk_assessment.control_level`,
  `riskAssessmentRequestSchema` and the `finding.classified` audit payload are untouched, and
  `CONTROL_LEVELS` / `controlLevelSchema` / `ControlLevel` keep living in `@hs/forms` and being
  re-exported from `@hs/contracts` — that is who consumes them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `templates`: the requirement "A question can prescribe what to do when it fails" loses the
  control level from the prescription — a `finding` block names the work to be done and nothing
  about how good that work is; a document that names a `control_level` is refused.

### Unmodified, and worth stating

- `findings`: the requirement that every `finding_risk_assessment` carries a `control_level` is
  **unchanged**. This change makes the hierarchy live in exactly one place instead of two.

## Impact

- `packages/forms`: `document/controls.ts` (`findingSchema`), and the fixtures of
  `document/schema.test.ts` and `document/draft.test.ts`. `draft.ts` needs no change —
  `checkFinding` never looked at the level.
- `packages/contracts`: no source change. `findings.ts` keeps re-exporting the hierarchy for the
  risk assessment.
- `apps/web/src/routes/TemplateDraftRoute/`: `FindingSheet.tsx` (the select), `presentation.ts`
  (`CONTROL_LEVEL_OPTIONS`, `defaultFinding`), `edits.ts` (the rebuild in `changeResponseType`),
  and their tests.
- `apps/api`: a new hand-written migration `0024`, and the draft fixture of
  `test/template-drafts.int-spec.ts`. No service reads the prescription yet, so no endpoint
  changes.
- `openspec/specs/templates/spec.md`: the prescription requirement and the three scenarios that
  name the level.
