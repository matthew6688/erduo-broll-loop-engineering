# B-roll layout variants

This reference freezes how presenter layouts consume the original Erduo B-roll
system. Layout is a delivery derivative, not a second creative workflow.

## Mandatory order

1. Produce the canonical pure B-roll with the original SRT, original DesignMD,
   Director, Assets, Lead samples, Chapter Builders, direct shot renders,
   six-frame review, five-shot technical canary, and user 3-of-5 decision.
2. Stop until both canary receipts pass. The presenter edit-plan command checks
   those receipts mechanically for `canary` and `full-production` scopes.
3. Finish the approved B-roll lineage. Create only the aspect variants required
   by the approved visual plan.
4. Compose presenter media after the B-roll and required variants are verified.
5. Review pixels from the actual delivered MP4 before showing it to the user.

No layout mode may change Recipe truth, the original DesignMD, visible-text
meaning, material route, motion meaning, timing, or approved assets. Reflow for
the target raster is allowed; redesign is not. Historical media cannot receive
retroactive Skill evidence.

## Frozen layout contract

| Mode | Presenter stage | B-roll source |
| --- | --- | --- |
| `original` | Preserve approved source framing | Validated full-frame canonical shots |
| `avatar-center` | Approved digital presenter centered | Validated full-frame canonical shots |
| `avatar-split` | Presenter remains the full-frame base | `split` uses validated 9:16 shots; `broll` uses verified native 16:9 variants |

For `avatar-split`, a native landscape variant must bind the same original SRT,
original DesignMD, Recipe truth, visible text, timing, and current Skill. It has
its own production profile, Runtime Plan, direct media contract, full decode,
text and motion audits, six-frame review, Builder conclusion, and video Skill
sidecar. Its composition may reflow to 16:9 without importing presenter branding
into the B-roll design.

A required landscape cutaway missing from `canary` or `full-production` stops
composition. Centering portrait B-roll over a blurred copy is allowed only in a
partial `framework-demo`; the receipt must mark that lineage non-publishable.

## State machine

The only forward path is:

`broll-planned → lead-samples → broll-canary-awaiting-user → broll-canary-approved → broll-complete → layout-variants-ready → presenter-composed → final-delivery-passed`

`original` and `avatar-center` may pass `layout-variants-ready` without an extra
aspect render when their output raster already matches the canonical B-roll.
`avatar-split` reaches it only when every planned full cutaway has a verified
landscape variant. A failed gate returns to the owning Director, Lead, Builder,
or composition stage; Parent does not patch creative source.

## Visual-plan checkpoint

Before any presenter or aspect-variant render, show the user a compact visual
plan containing:

- Recipe/shot ID and time window;
- `presenter`, `split`, or full `broll` treatment;
- portrait or landscape asset binding;
- one opening/result frame or wireframe per distinct treatment;
- explicit confirmation that `themeOverride=false`.

Rendering begins only after the user approves that plan. Approval of a layout
does not replace the earlier pure-B-roll canary approval.
