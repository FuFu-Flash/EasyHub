# Desktop styles

`apps/desktop/src/renderer/src/styles.css` is the only rule entry, imported by
`main.tsx`. It imports `tokens.css` first. Components must not import another rule
sheet or add a second override layer. The desktop and demo share these rules.
Android is outside this contract.

## Tokens

- Colors: 30 named colors, including decoration and state colors. Transparent
  variants use `color-mix(in srgb, var(--eh-color-…), …%, transparent)`.
- Sizes: `--eh-text-12/13/14/16/20/24/32`. Body text stays 13–14px;
  metadata uses 12px. Zero is reserved for visually hidden narrow sidebar labels.
- Weights: `--eh-weight-400/500/600/700`.
- Radii: `--eh-radius-4/8/12/999`; zero and inherit remain valid for attached edges.
- Spacing: `--eh-space-*` for shared padding, margins and gaps. Existing special
  alignment offsets and control dimensions remain measurements, not extra tokens.
- Elevation: `--eh-shadow-*`. Inset borders and state/focus rings may compose
  palette tokens directly; they aren't elevation.
- Font stacks include Windows and macOS system fonts; code uses the mono token.

## Responsive rules

There are three viewport width boundaries: **700, 850 and 1180px**. A min-width
condition starts at the corresponding boundary + 1px. The short-window height
query and README editor's content-width container query are separate from these
viewport boundaries. Keep reduced-motion queries.
Don't hoist conditional rules across existing rules: that can change the cascade.

## Safe cleanup and review

The consolidation retains the original evaluated stylesheet order. Only
declarations covered by later identical selectors in the same conditional
context are removed; remaining rules keep their original positions. Static
selectors from retired screens/forms were audited against renderer sources.
Runtime-generated severity and layout-preview classes are retained.

`styleTokens.test.ts` guards the single entry, palette, type/shape scales,
variable resolution and width boundaries. No CSS tooling dependency was added.

Run `node apps/desktop/styles-consolidation-smoke.mjs before` **before editing**,
then `… cascade` to require zero visual/computed-style changes for a purely
structural cleanup, or `… after` for a deliberate token normalization. The runner
uses Playwright/Electron and signed-in workspace components with an isolated
in-memory bridge and blocked external network. It captures 64 views: eight pages,
Chinese/English, comfortable/compact, 1440/1000px. Output, measurements and pixel
diffs are under `apps/desktop/out/style-consolidation/`.

The intended Stage E differences are the type/weight/radius/elevation scales,
small palette shifts and the consolidated responsive thresholds. Compare
screenshots and geometry; a changed-pixel percentage alone cannot establish
visual quality. Keep native window controls fixed, group backgrounds full width,
README/code selectable, focus visible and publishing file selection intact.
