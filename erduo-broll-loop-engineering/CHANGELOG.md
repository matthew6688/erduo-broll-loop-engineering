
## Unreleased

### Speed and stability

- Formal production now defaults to 1920×1080 at 30 fps; 4K requires an
  explicit request. Planning, Lead/Builder execution, view receipt, and canary
  finalization emit closed stage timings. HyperFrames visual checks use an
  isolated two-wide preflight pool while direct renders stay sequential.
  Only narrowly classified infrastructure failures may retry unchanged source;
  all unknown failures remain source-blocking.

- Documented a fresh-root, post-authoring five-shot benchmark at `3m19s` wall
  time and about `1m49s` measured commands, versus the earlier `79m37s`
  approval-to-gate run. All direct-shot, decode, sheet, text, motion, viewing,
  and canary gates remain active; old/new preview SSIM was `0.999203`.
- Planning now rejects stale `source: srt` visible text before render;
  HyperFrames preflight aggregates all composition failures and retains bounded
  stdout/stderr; Parent records view receipts and finalizes canary evidence
  without rerunning unchanged Assignment commands.
- Added hash-verified font/license foundation reuse. Episode-specific media is
  never copied by this path.

### Added

- A narrowly scoped, non-publishable `framework-demo` path can reuse legacy
  B-roll only after SRT, DesignMD, profile, Recipe truth/visual fields, media
  contract, hash, and decode verification. It records missing/historical Skill
  evidence without backfilling it. Portrait full cutaways in landscape keep the
  complete original frame over a dimmed same-shot blur carrier.
- `avatar-split` may now bind current-Skill landscape shot variants for true
  16:9 full cutaways while split windows keep their verified 9:16 media.
  Canary/full-production composition rejects missing landscape variants; only
  framework demos retain the portrait blur-carrier fallback.
- Presenter edit-plan creation now reopens the identity-bound pure-B-roll
  technical canary and 3-of-5 user decision. Canary/full-production layout
  work cannot start before the original Skill workflow is approved.

- Three governed presenter composition modes: unchanged `original`, centered
  `avatar-center`, and `avatar-split`, which reuses validated 9:16 B-roll
  beside a presenter without changing the original DesignMD. Approved mode
  contracts are hash-bound through Runtime Plan, edit plan, composition,
  validation, tests, documentation, and the release package.

- Assignment Preflight now validates every active runtime target before the
  first render, reports all deterministic target metadata failures together,
  and writes a plan/source/asset-bound receipt. Preflight failures consume no
  render attempt. Runtime Plan v4 Lead/Builder Assignments append render
  attempts to a mechanical log and stop after two actual render attempts,
  returning a third failure to the Recipe or Runtime Plan instead of retrying
  indefinitely.

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
