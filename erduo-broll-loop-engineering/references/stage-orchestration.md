# Stage orchestration

## v1.0.1 creative ownership

| Work | Owner | Normal output |
| --- | --- | --- |
| Meaning, chapters, immutable truth, creative proposals, motion map | one Director | `01-director/` |
| Runtime plan and assignment packets | Parent deterministic scripts | `01-runtime-plan/` |
| Known shared media, fonts, licenses, open shot routes | one Assets Agent | `02-assets/` |
| Three final samples, signature motion, shared capabilities | Lead mode of selected Builder | `04-visual-lock/` |
| Five-shot canary decision | owning Builders + user | `04-visual-lock/canary/` |
| Contiguous chapter creative loop, normally 5–8 shots | one Chapter Builder per unit | `03-build/<unit>/` |
| Direct shot rendering, media facts, contracts, six-frame sheets, chapter preview | Parent standard command | `05-delivery/` |
| Complete preview and optional Master | Parent assembly from validated shots | `05-delivery/` |

Do not dispatch Runtime Planner, Integrator, Render, Reviewer, inspection, or
evidence Agents. A semantic shot is the truth/media/check boundary. A chapter
is the creative boundary. Direct shot delivery never implies one Agent per shot.

## Runtime and gate order

When the user names a brand authority or fixed workflow, finalize the
production-governance contract and pass its `design` gate before Director.
Planning automatically passes the `director` gate and binds the contract/lock
identities into the plan and every assignment. Standard rendering automatically
passes the `source` gate. Never delete, replace, weaken, or hand-edit that lock;
drift requires a new production root.

v1.0.1 production defaults to HyperFrames. Remotion requires explicit opt-in or
a canary assignment. `auto` is experimental and explicit only. Failure never
silently reroutes.

Parent creates the production profile and runtime plan with bundled scripts;
never hand-edit generated JSON. Normal units contain 5–8 contiguous shots and
roughly 35–70 seconds. Only closed technical conflicts may justify a solo unit.
Media still render one shot per direct runtime entry.

```text
node scripts/create-production-profile.mjs \
  --output <production-root>/production-profile.json \
  --width <width> --height <height> --fps <fps> \
  --audio <audio-policy> --master-format h264-mp4

node scripts/register-skill-usage.mjs \
  --production-root <production-root> \
  --skill-file <canonical-skill-root>/SKILL.md \
  --skill-name erduo-broll-loop-engineering

node scripts/plan-runtime.mjs \
  --recipes <production-root>/01-director/shot-recipes \
  --selection <runtime-selection.json> \
  --narrative-envelope <production-root>/01-director/narrative-envelope.json \
  --visual-system <production-root>/01-director/visual-system.json \
  --representative-scenes <production-root>/01-director/representative-scenes.json \
  --motion-map <production-root>/01-director/motion-map.json \
  --original-srt <production-root>/00-input/original.srt \
  --original-design <production-root>/00-input/original-design.md \
  --skill-usage <production-root>/00-inputs/skill-usage.json \
  --material-policy <production-root>/00-inputs/material-policy.json \
  --canary-shot-ids <approved-five-comma-separated-shot-ids> \
  --hyperframes-executable <verified-absolute-hyperframes-cli> \
  --production-profile <production-root>/production-profile.json \
  --production-root <production-root>
```

All four direct creative-context arguments and the selected backend's verified
executable are required for normal Recipe v4 production. Use
`--remotion-executable` instead for an explicit Remotion route. Omitting
`--representative-scenes` selects only the legacy planning path; omitting the
motion map, either original input, or executable cannot produce a valid v4 plan
or assignment packet.

`--material-policy` is optional and narrow. Supply it only when the user has
explicitly approved the unchanged default DesignMD as native-only and external
or generated material would violate that approval. The contract must use
`scope: default-design-native-only`, bind the exact original DesignMD SHA-256,
and exist before planning. It lowers only the two-material-shot minimum to zero;
all five canary Recipes must remain `materialRoute: native`, and every other
technical and aesthetic gate remains unchanged.

Run the Lead sample gate, then the five-shot creative canary. Full production is
blocked until all canary technical/visual-baseline conditions pass and the user
selects this version for at least 3/5 shots. A failed canary returns to its
original Lead or Chapter Builder; it never starts the full film.

The assignment standard command is itself a quality loop. It performs
source-only on-screen-text provenance before render, rendered Recipe/rhythm
motion evidence after render, and refuses a viewing conclusion while either
report is `signals` or `unmeasured`. The owning Lead/Builder archives the
attempt, revises owned source or allowed `creativeProposal` fields, and reruns.
Parent does not hand-fix source, and the user sees only a gate-clean canary. The
canary technical gate must hash-bind both passing reports.

## Direct original context

Director, Lead, and every Chapter Builder receive readable locators and SHA-256
identities for the complete original SRT and original design. Neither may be
replaced by narrative/visual summaries. Each Builder packet also contains:

1. its contiguous chapter and each shot's immutable `truth` (including any
   declared readable hold) plus revisable `creativeProposal` and traceable
   on-screen-text declarations;
2. previous/next and chapter-boundary seams;
3. all three Lead sample locators, matching shared source, and the short
   content-relation capability index;
4. the shared asset/font/provenance index and live
   `native|provided|search|generate|mixed` shot routes;
5. selected backend facts, exact standard command, output paths, view-receipt
   target, and at most two selected references.

Do not pass Parent/other stage Skills, generic craft references, schemas,
validator/lint source, complete catalogs, unrelated Recipes, long logs, or
Parent history. Original task inputs are not redundant rule files. Generated
AGENTS, CLAUDE, and role prompts come from one role-charter source; the packet
repeats its short execution anchor/recovery fields after compression.

## Director and Assets

Director writes Recipe v4 with immutable `truth` and revisable
`creativeProposal`, recommends semantic chapters and seams, and selects 2–4
relevant `craftIntent` values. Director never writes `authoring.solo`.

Assets freezes known shared media, local fonts, licenses, provenance, and
reusable derivatives. It does not close shot-specific search/generation based
on a first proposal. A global route restriction must cite a real user,
capability, authorization, or cost boundary. Chapter Builders may move a shot
from native to search, generate, or mixed with one concise reason and source
record.

## Lead samples and capabilities

Lead reads the complete original SRT/design, compact motion map, exactly three
representative Recipes, and shared asset/font index. Lead builds:

- one native graphic/type final sample;
- one real-or-generated material-fusion final sample;
- one information-dense interface/process/data final sample;
- every design-named signature motion as a real sample behavior or runnable
  primitive;
- reusable crop, mask, depth, background-fusion, source-binding, preparation,
  main-action, overlap, settle, and readable-hold capabilities;
- a sub-one-page index stating which content relationship each capability fits.

Samples must differ in silhouette, composition, and primary action. Shared
source may contain tokens, primitives, and base components, never a fill-in
whole-shot template. Lead runs the exact standard command, opens sample sheets
and short previews, repairs visible defects, and returns `accepted|revised`.
Those samples become final source for their shots.

## Chapter Builder loop

One Chapter Builder owns understand → choose → build → render → view → revise
for its whole contiguous unit. It cannot change `truth`, but may replace a
creative proposal and material route when a better solution serves truth; one
short reason is enough. It uses Lead capabilities without copying Lead layouts
and must vary composition, entry, material, and rhythm across the chapter.

Builder exposes one direct runtime target per shot and runs only the assignment
standard command. It then opens every six-frame sheet plus the chapter preview.
It repairs coverage, accumulated states, floating connectors, empty containers,
unreadable results, unsettled action, design mismatch, or repeated structure.
Handoff requires one compact viewing result:

```text
status: accepted | revised
viewed: six-frame-sheets + chapter-preview
change: <required only when revised>
```

No long viewing essay or extra approval document is required.

## No proof work in creative source

Lead and Builder do not create `inspection.tsx`, diagnostic Compositions,
`data-erduo-trace*`, visual-weight/focus-group/layer metadata, manual motion
windows, passing dense diagnostics, or capture/trace/lint/screenshot/frame-scan/
hash/probe/decode/manifest/contract/receipt/proof tools. The role prompt's
positive twelve-principle anchor guides creation; it is not scored or traced.

Parent owns render, FFprobe, full decode, hash, identity, media contracts,
six-frame sheets, chapter previews, and assembly. Success stores compact media
facts. Failure stores only the smallest shot/window/issue/image-or-log evidence
needed by the original owner.

## Delivery and revisions

Every final shot is directly rendered from its own runtime entry and fully
decoded. `delivery-index.json` is the sequence truth. Complete preview and any
requested silent B-roll Master use only unchanged validated shot files. In the
optional presenter path, Parent first registers a local human camera edit or
approved digital render whose `presenterKind`, SRT, portrait, narration, media hashes, and
single audio stream are closed. Runtime planning receives that contract through
`--presenter-source` and binds its locator, contract hash, approved media hash,
duration, authorization use, and approval scope into every Lead/Builder packet.
Director writes and the owning Builder may
revise `creativeProposal.presenterTreatment` after viewing. Parent must run
`create-presenter-edit-plan.mjs` after final Recipe revisions; it may not invent
or hand-edit cut times. `assemble-presenter-broll.mjs` may then replace
picture intervals only with unchanged validated silent shots inside their SRT
windows, while preserving exactly one presenter audio stream. Its composition
receipt binds the presenter contract, edit plan, delivery index, used shot
media, mix durations, output hash, and full audiovisual decode. This final
composition does not change or weaken any direct-shot contract.
Full-production composition additionally requires `publishing` authorization
and `full-production` user approval; canary/internal permission cannot be
promoted by changing an output filename.

Technical checks may report objective defects but never appeal, metaphor
quality, animation weight, twelve-principle compliance, or user preference.
Only the creative owner who viewed the actual output can return
`accepted|revised`; only the user can pass canary and final aesthetics.
