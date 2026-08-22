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

- Current production policy: `erduo-broll-loop-engineering/SKILL.md`.
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
- A complete original SRT and original design must reach Director, Lead, and
  every Chapter Builder directly.
- Do not edit generated stage `AGENTS.md`, `CLAUDE.md`, or role prompts by hand;
  edit the role-charter JSON and regenerate them.
- Do not commit user SRTs, media, credentials, production outputs, or private
  absolute paths.

## Current state

The fork includes rendered motion/on-screen-text audits and unified Recipe
truth/source-input identity validation. Keep README, current references,
schemas, role charters, tests, and release manifests aligned when those
contracts change.
