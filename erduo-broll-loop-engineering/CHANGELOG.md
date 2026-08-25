
## Unreleased

### Added

- Installed CLI entrypoints now resolve symbolic links before deciding whether
  to run. Invoking the Skill through its `.codex/skills` link can no longer
  return silently; a real symlink invocation is covered by regression tests.
- Lead and Builder receipts now state that `revised` records Recipe
  `creativeProposal` changes, not implementation-only source repair. Canary
  aggregation identifies the exact assignment whose receipt is invalid.
- The v4 Lead assignment gate now validates a started receipt/handoff closure
  with the same contract used by five-shot aggregation, preventing a false
  `ready` result that fails only after Chapter Builder work completes.

- Identity-bound `material-policy.json` support for the Skill's narrow
  user-approved exception to the two-material-shot canary minimum. It is valid
  only for the exact original DesignMD and an all-`native` five-shot canary;
  absent, stale, or mixed-route policies fail closed.
- Assignment standard commands now run source-only text provenance before
  render and Recipe-key-state/motion-map-rhythm evidence after render. Canary
  technical gates require and hash-bind both passing reports, so a late audit
  can no longer contradict an earlier technical pass. Lead/Builder role
  charters own the archive/revise/rerun loop instead of asking the user to
  direct per-shot repairs.

- `verify-presenter-delivery.mjs` and a closed final-delivery gate contract for
  human/digital presenter productions. It rejects missing or replaced audio,
  low loudness, subtitle drift from the bound original SRT, subtitle overrun,
  stale composition/edit-plan/runtime bindings, media-fact drift, and decode
  failure. Subtitled derivatives must preserve the approved composition's
  decoded PCM audio exactly.

- Immutable production-governance contract and lock, with deterministic
  `design`, `director`, and pre-render `source` gates. Runtime Plan v4 and all
  assignments bind the same authority, original-design, approved-Logo, brand,
  workflow, contract, and lock identities; any drift fails closed.

- Provider-neutral Presenter Source now distinguishes `presenterKind=human|digital`.
  A local camera edit and a downloaded digital-human render reuse the same
  Recipes, edit-plan compiler, compositor, and receipt contracts. Each source
  still requires its own hash-bound Runtime Plan and compiled edit plan.
- Digital-presenter picture treatment is now a first-class, revisable Recipe
  v4 creative proposal. Director proposes `presenter`, `broll`, or `mixed`;
  the owning Builder may revise it after viewing.
- `create-presenter-edit-plan.mjs` mechanically compiles those final Recipe
  decisions and binds the result to the Runtime Plan, presenter source, and
  every Recipe identity.
- Runtime Plan v4 optionally binds the approved presenter source and propagates
  its locator, hashes, duration, authorization, and approval scope into every
  Lead/Builder assignment.

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

- `assemble-presenter-broll.mjs` now accepts only compiled edit-plan v2 and
  rejects stale Runtime Plan, presenter source, Recipe, SRT, or output-profile
  bindings. Parent no longer owns or hand-authors presenter cut decisions.
- Operational validation accepts schema-valid Builder changes to
  `creativeProposal` while continuing to reject any immutable Recipe truth
  drift. Full-production composition now requires publishing authorization and
  full-production user approval.

- The canary hard gate additionally requires both audits to report no signal.
- `references/parent-review-checklist.md` gains a rendered evidence section.
- `references/motion-layout-lint.md` names the backends it cannot cover.
- Current workflow, review checklist, Director contract, and generated role
  charter now agree on the HyperFrames default, required original design,
  open material routes, five-shot canary, and Recipe v4 rendered-evidence
  fields.

### Notes

Both audits report facts about rendered output. A pass is never aesthetic
approval, an unchanged readable hold is not a defect, and no automatic score
replaces the user's canary choice.

### Fixed

- `validate-shot-media.mjs` now orders a Builder's canary and deferred shots by
  the runtime timeline, matching `render-assigned-shots.mjs`. Full-production
  validation no longer rejects a valid view receipt merely because the
  assignment packet lists canary shots before deferred shots.
- `validate-shot-media.mjs` computed `truthIdentity` by hashing `recipe.truth`
  alone while `render-assigned-shots.mjs` hashed `{shotId, truth}`. A Builder
  view receipt could satisfy one validator or the other but never both, so
  `assembleShotPreview` was unreachable for any production. Identity now comes
  from `validate-shot-recipes.mjs` in both places.
- `validate-shot-media.mjs` did not pass the original SRT or design files to
  `validateRuntimePlan`, so any plan carrying those bindings failed validation
  and blocked preview assembly. The locators are now resolved from the plan's
  own `sourceContext`.
