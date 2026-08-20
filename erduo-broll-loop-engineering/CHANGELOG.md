
## Unreleased

### Added

- `scripts/audit-shot-motion.mjs` measures frame-to-frame difference on
  delivered shots and reports still tails beyond the declared readable hold,
  mid-shot still runs, and action windows with no development. Covers the gap
  left where `plan-runtime.mjs` returns no trace locator outside Remotion, so
  motion and layout lint cannot run at all.
- `scripts/audit-onscreen-text.mjs` checks that every rendered string resolves
  to the SRT, the Recipe's `creativeProposal.visibleText`, the visual system
  vocabulary, or fixed chrome, and that every declaration names something real.
  Refuses production scaffolding — shot counters, stage names, Recipe beat
  names — outright.
- `references/rendered-evidence-audits.md`, including how to derive
  `stillCutoff` from the measured distribution rather than guessing.
- `references/runtime/rendered-evidence-audit.schema.json`.
- Shot Recipe v4: optional `truth.readableHold` and
  `creativeProposal.visibleText`. `readableHold` lives in immutable truth so a
  Builder cannot widen it to satisfy the motion audit.
- Visual system: optional `vocabulary` for field names and chrome the film may
  render without repeating a declaration in every Recipe.

### Changed

- The canary hard gate additionally requires both audits to report no signal.
- `references/parent-review-checklist.md` gains a rendered evidence section.
- `references/motion-layout-lint.md` names the backends it cannot cover.

### Notes

Both audits report facts about rendered output. A pass is never aesthetic
approval, an unchanged readable hold is not a defect, and no automatic score
replaces the user's canary choice.

### Fixed

- `validate-shot-media.mjs` computed `truthIdentity` by hashing `recipe.truth`
  alone while `render-assigned-shots.mjs` hashed `{shotId, truth}`. A Builder
  view receipt could satisfy one validator or the other but never both, so
  `assembleShotPreview` was unreachable for any production. Identity now comes
  from `validate-shot-recipes.mjs` in both places.
- `validate-shot-media.mjs` did not pass the original SRT or design files to
  `validateRuntimePlan`, so any plan carrying those bindings failed validation
  and blocked preview assembly. The locators are now resolved from the plan's
  own `sourceContext`.
