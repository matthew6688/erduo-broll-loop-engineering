# Project instructions

This repository ships the `erduo-broll-loop-engineering` Agent Skill: an
SRT/design-anchored B-roll production loop with HyperFrames as the v1.0.1
default backend.

## Run and verify

- Requires Node.js 22 or newer.
- Run the full repository gate with `npm test`.
- Regenerate role projections with
  `node erduo-broll-loop-engineering/scripts/generate-role-files.mjs` after
  editing `references/roles/role-charters.json`.
- Check generated role projections with the same command plus `--check`.

## Source of truth

- FengTalk's maintained production fork is
  `https://github.com/matthew6688/erduo-broll-loop-engineering`; local `origin`
  points there and `upstream` points to `erduo1998-cell` for read-only update
  comparison. Push production changes only to the fork unless the user
  explicitly requests an upstream PR.
- Current production policy: `erduo-broll-loop-engineering/SKILL.md`.
- User-facing operating instructions:
  `docs/FENGTALK-VIDEO-PRODUCTION-USER-GUIDE.md`. Keep this focused on the
  user's inputs, approval gates, outputs, revisions, publishing handoff, and
  recovery prompt; do not turn it into a second implementation contract.
- Runtime and assignment mechanics:
  `erduo-broll-loop-engineering/references/stage-orchestration.md`.
- Closed data contracts: `erduo-broll-loop-engineering/references/runtime/`.
- `docs/V*-DESIGN.md`, benchmarks, and PR specs are historical evidence, not
  current production instructions.

## Editing conventions

- Use Recipe v4 for new production: immutable `truth`, revisable
  `creativeProposal`.
- New blank productions default to HyperFrames. Remotion and `auto` require
  explicit selection; backend failures never silently reroute.
- Production HyperFrames is release-pinned to `0.7.104`. Do not run an in-place
  upgrade, `npm update`, or `npx hyperframes@latest` against the production
  runtime. A newer version requires an isolated runtime, a new hash-bound
  Runtime Plan, the complete five-shot canary and user approval before it can
  replace the pin; a check-only pass is not production support.
- A complete original SRT and original design must reach Director, Lead, and
  every Chapter Builder directly.
- Do not edit generated stage `AGENTS.md`, `CLAUDE.md`, or role prompts by hand;
  edit the role-charter JSON and regenerate them.
- Do not commit user SRTs, media, credentials, production outputs, or private
  absolute paths.
- Reusable executable animation additions must use the hash-closed
  `animation-extension` contract. Keep `designMdPolicy=preserve-original`;
  candidate extensions are opt-in experiments and cannot enter production
  until their check, preview, and canary evidence pass.
- Record production timing in the shared event interface rather than adding
  script-specific timers. Preserve immutable `canary`, `full-preview`, and
  `final` metrics snapshots; never overwrite or reconstruct an older milestone.

## Current state

The fork includes rendered motion/on-screen-text audits and unified Recipe
truth/source-input identity validation. Keep README, current references,
schemas, role charters, tests, and release manifests aligned when those
contracts change.

Keep direct shot rendering sequential: the current five-shot benchmark found
two-wide rendering and fused decode/sheet work slower. After a creative owner
returns its viewing conclusion, Parent's receipt command also closes a missing
minimal handoff; do not reactivate the owner only to author that reference. See
`docs/V1.0.1-SPEED-OPTIMIZATION.md` for the measured evidence.

Presenter production supports provider-neutral human/digital sources plus
`presenter|broll|mixed` Recipe treatments. Presenter background and Logo are
presenter-layer concerns; they must not replace or restyle the original B-roll
DesignMD. See `docs/PRESENTER-VIDEO-PRODUCTION-OPERATING-MODEL.md`;
publishable audio, lip-sync, subtitle, decode, authorization, and
Skill-evidence gates still apply.

New presenter productions must bind one user-approved
`00-inputs/presentation-mode.json`. The only modes are `original`,
`avatar-center`, and `avatar-split`; the split mode reuses validated portrait
B-roll over the presenter source and does not create a new B-roll theme. The
framework, deterministic FFmpeg integration tests, and non-publishable layout
demonstrations are complete. The repository does not record a current-Skill,
publishable presentation-mode canary. The next production step is a short
user-approved canary, not a full video.
