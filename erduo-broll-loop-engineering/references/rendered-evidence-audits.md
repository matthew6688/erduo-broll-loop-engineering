# Rendered evidence audits

Two audits measure the delivered file and the source that authored it. They
report risk signals, not a score. A pass never establishes that a shot is good,
and an unchanged readable hold is not a defect and never creates a request for
more motion.

They exist because a frozen shot and a shot leaking production scaffolding both
clear every other mechanical gate in this Skill. Frame counts, identities,
decode, contract closure, and composition-family counts are all satisfied by a
shot that stops moving after 1.5 seconds and prints `04 / 12` in the corner.

## `scripts/audit-shot-motion.mjs`

Decodes each delivered shot to greyscale at a fixed short edge, takes the mean
absolute difference between consecutive frames, and reports three signals:

- **tail still exceeds declared hold** — the shot stopped earlier than it said
  it would;
- **mid-shot still run** — the picture stopped developing longer than one
  Recipe/rhythm-sized beat permits;
- **action window underdeveloped** — too little of the declared action window
  contains visible development for the motion map's `calm`, `mixed`,
  `progressive`, or `impact` rhythm.

The hold comes from `truth.readableHold`. It lives in `truth`, not in the
creative proposal, so a Builder cannot widen the hold to pass. When a Recipe
declares none, the audit falls back to the motion map `settleMs` and records
which source it used; with neither, the shot is reported `unmeasured`.

The audit still records mean difference for diagnosis, but does not gate on one
absolute mean-energy number. Sparse type, diagrams, footage, landscape, and
vertical video occupy different pixel areas. The gate instead combines active
frame ratio, the Recipe's key-state count, the motion-map rhythm, and the exact
readable hold. Taken over the whole shot, a long legitimate hold would dilute
all of those facts.

### Choosing `stillCutoff`

Frame-difference values on a finished film are strongly bimodal. A held frame
sits near `0.001`. The slowest travel a viewer still reads as movement — sparse
type sliding at constant speed — sits near `0.03`. The default `0.01` sits an
order of magnitude above the first and below the second.

Re-derive it per project by printing percentiles of the measured values rather
than guessing. A cutoff set near the median reads deliberate slow travel as a
freeze; on one 9:16 film the median was `0.35`, and a cutoff there reported five
seconds of visible motion as still.

### Answering a signal

Enlarge the object that carries the shot, or add a real beat. Do not add text to
raise pixel energy, and do not widen the declared hold. On one production a shot
measured `0.03` in its action window because its evidence bars were 14px tall on
a 1080×1920 canvas; the same shot with 78px bars and full-row travel measured
`0.33` without a single new word on screen.

### Relationship to motion and layout lint

This audit is a floor against freezing, and it is blind by design: pixel energy
cannot tell which element moved or whether a planned beat was implemented. When
a backend supplies a runtime trace, run
[motion and layout lint](motion-layout-lint.md) as well — it binds planned beats
to named elements. `plan-runtime.mjs` returns no trace locator outside Remotion,
which is exactly the gap this audit covers.

## `scripts/audit-onscreen-text.mjs`

Checks provenance in both directions, because one direction alone certifies its
own input:

- **rendered to declared** — every string the source renders resolves to the
  original SRT, the Recipe's `creativeProposal.visibleText`, the visual system
  `vocabulary`, or fixed chrome;
- **declared to traceable** — every `visibleText` entry names something real: an
  entry of `creativeProposal.objects`, a vocabulary term, or spoken words.
  Without this, a Builder invents a label and then declares it.

Punctuation is folded before matching, so a design may set a full-width space
where the script wrote a comma.

Production scaffolding is refused outright: shot counters, stage and structure
names, Recipe beat names, shot ids, and development leftovers are not content.

### What does not belong in `visibleText`

Text that summarises the picture for the viewer. Labels naming a gap, a state,
or a relationship the picture already shows are the most common leak, and the
hardest to notice, because they look like considered design. A reliable test:
the label is almost never in the Recipe's `objects`. On one production the
labels for "deficit", "equal", "expected", and "actual" were all absent from
every `objects` list; removing them brought each shot closer to its own Recipe,
not further from it.

Recurring field names belong in the visual system `vocabulary` rather than in
every Recipe.

### Scope

Only markup text is readable. Canvas, shader, and burnt-in bitmap text are
listed as `unmeasured` rather than counted as clean.

## Where the audits run

The assignment standard command runs on-screen-text provenance against authored
source before render; no delivery contract is needed. It runs motion evidence
after direct-shot render and before the Builder may record a viewing conclusion.
`signals` and `unmeasured` both remain inside the owning Lead/Builder's
archive/revise/rerun loop.

The five-shot technical gate reruns both audits across the complete canary,
requires `passed`, records both checks, and hash-binds both report files. Gate
validation reopens the reports and verifies audit kind, Plan identity, exact
five-shot order, status, and file hash. This prevents a Parent from passing the
canary first and discovering a contradictory audit later.
