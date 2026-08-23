# Production governance lock

Use this contract when a production names an external brand authority, design
system, or fixed workflow. FengTalk work always uses it. It turns those rules
into a hash-closed input to the existing erduo flow; it does not add a second
creative approval system.

## Files

- `production-governance.lock.json` lives at the production root. Its presence
  makes governance mandatory and binds the exact contract bytes and identity.
- `00-inputs/production-governance.json` binds the authority files, original
  design, approved Logo assets, color/font rules, prohibited visual terms,
  workflow order, canary size, user-choice threshold, and publication boundary.
- A draft may be written outside those final locators. The official `finalize`
  command hashes every real file and creates both final files with `wx`; it
  never overwrites them.

The contract may bind absolute authority/asset files because they remain local
production evidence. Do not commit a user contract containing private absolute
paths. The public Skill ships only the generic schema and validator.

## Three blocking checks

1. `design`: before Director dispatch, reopens the governance lock, contract,
   every authority, the original design, and approved Logo assets. It rejects
   drift, missing required palette/font/Logo references, and forbidden colors.
   A design may name a forbidden style only as a negative rule.
2. `director`: before runtime planning, additionally validates the real
   `visual-system.json`. `plan-runtime.mjs` runs this automatically whenever a
   lock exists and embeds the governance identities into `sourceContext` and
   every Lead/Builder assignment.
3. `source`: `render-assigned-shots.mjs` runs this automatically before every
   render. It reopens the plan-bound Director gate and scans the complete
   editable source closure for non-approved colors, missing required fonts or
   approved Logo references, prohibited terms, and symlinks. Director must
   carry every contracted prohibited style in `prohibitedLazyDefaults`; the
   same term anywhere else in its positive visual system is rejected.

Changing an authority, design, contract, Logo asset, or lock invalidates the
existing plan. Start a new production root; never edit the old plan or replace
the lock to salvage downstream work.

## Commands

Use the bundled safe-execution route for both commands.

```text
node scripts/validate-production-governance.mjs finalize \
  --production-root <production-root> \
  --draft <governance-draft.json>

node scripts/validate-production-governance.mjs validate \
  --production-root <production-root> \
  --stage design
```

Director and source stages are normally invoked through `plan-runtime.mjs` and
`render-assigned-shots.mjs`; a manual validation is diagnostic only and cannot
replace their embedded checks.

## Fixed erduo workflow

The contract requires this exact order:

`Director -> Runtime Plan -> Assets -> Lead -> Chapter Builder -> Parent Audits -> User Canary -> Full Production`

The creative canary remains exactly five shots, full production remains blocked
until technical closure and the user's identity-bound 3-of-5 choice pass, and
publication always needs a separate explicit instruction. A governance pass is
not aesthetic approval.
