# NER-SupplyAI — Design System

The visual contract. `web/src/design/tokens.css` is the machine-readable source of truth;
this document explains the intent behind it and the rules a feature must follow.

Direction: **LIGHT + GEOSPATIAL + OPERATIONAL + PREMIUM.** A government-grade console, not a
SaaS dashboard and not a dark instrument panel.

Live reference: **`/kitchen-sink`** — every primitive in the states the product actually uses.

---

## 1. Non-negotiables

1. **No component hardcodes a colour for a domain state.** A feature says `level="CRITICAL"`;
   `domain/thresholds.ts` decides what critical looks like.
2. **Four risk colours, three route colours, one brand blue.** Anything outside that list is a
   bug, not a decision.
3. **Bucket boundaries live in exactly one file** — `domain/thresholds.ts`, transcribed from
   `PROJECT_CONTRACT.md` §2. No feature re-derives a threshold.
4. **Every number a user reads passes through `domain/format.ts`.**
5. **Not everything is a white rounded card.** `Panel` has five variants; picking `default` for
   everything is the failure this system exists to prevent.
6. **Nothing outside `design/` imports `lucide-react` or Radix directly.**
7. **Synthetic values are never presented as measurements.** Use `ProvenanceTag`.

---

## 2. Colour

Tokens are stored as raw `R G B` channels so Tailwind's opacity modifiers work
(`bg-panel/92`). **The opacity scale is extended to every integer 0–100** in
`tailwind.config.js` — Tailwind ships a 5-step scale and silently drops `/92`, which is how a
floating map panel ends up with no background and no error anywhere.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `ground` | `#F2F5F8` | the page behind every panel |
| `panel` | `#FFFFFF` | primary surface |
| `panel-alt` | `#F7F9FB` | table stripes, panel footers, toolbars |
| `panel-sunk` | `#EDF1F5` | wells, progress tracks |
| `line` | `#E2E8F0` | structural hairline |
| `line-soft` | `#EDF1F5` | internal dividers, table rows |

### Ink

`ink #0E1B2A` (primary text and **all** metrics) · `ink-2 #516070` (body) ·
`ink-3 #8494A5` (metadata, axis labels, placeholders) · `ink-inverse #FFFFFF`.

### Brand

`brand-900 #0A3A5C` · `brand-800` (gradient depth only) · `brand-700 #0B5C8F` ·
`brand-500 #1276B8` (primary action, Route B, active nav) · `brand-200` · `brand-50 #E8F2F9`.

### Risk — bound to contract §2

| Level | Colour | riskScore | failureProbability | stockout |
|---|---|---|---|---|
| CRITICAL | `#D5342A` | 85–100 | 0.85–1.00 | < 48h |
| HIGH | `#E8710A` | 70–84 | 0.70–0.84 | — |
| MEDIUM | `#F0A32B` | 40–69 | 0.40–0.69 | 48–96h |
| LOW | `#1F8B4C` | 0–39 | 0.00–0.39 | ≥ 96h |

Each has a derived `-wash` tint for chip and alert-row grounds.

> **Contract delta.** §2's UI note says HIGH and MEDIUM share one accent because the old palette
> had three colours. This palette has four, so HIGH gets its own orange. Boundaries are
> unchanged. Logged in `CONTRACT_DELTAS.md`.

### Routes

`route-a #D5342A` dashed · `route-b #1276B8` solid (the recommendation) ·
`route-c #94A3B8` dashed. Every route on the map is drawn as a **white casing under a coloured
core** — without the casing a red route vanishes over a red-brown hillside.

---

## 3. Typography

**Inter** for UI, **Inter Tight** for display. All figures `tabular-nums`.

| Role | Size / line | Use |
|---|---|---|
| `display` | 32 / 37 | page hero title |
| `display-sm` | 24 / 29 | section hero |
| `title` | 17 / 23 | panel titles, modal titles |
| `section` | 15 / 21 | `PanelHeader` |
| `body` | 13 / 19 | default |
| `meta` | 11.5 / 16 | metadata, secondary rows |
| `label` | 11 uppercase, `.06em` | every field and section label |
| `metric` | 27 / 31 | `MetricValue` default |
| `metric-lg` / `metric-sm` | 36 / 19 | hero figure / inline figure |

A heading is a **role**, not a size guess: use `.t-label`, `.t-meta`, `.t-metric` and the
`text-*` scale, never an arbitrary pixel value.

---

## 4. Geometry, depth, motion

- **Radius** — `pane 14` (modals, side panels) · `panel 10` · `control 8` · `chip 6` · pills `999`.
- **Depth** — the 1px border does most of the work. `shadow-panel` lifts a panel off the ground;
  `shadow-float` is only for chrome sitting on satellite imagery; `shadow-overlay` for modals.
  A screen full of `shadow-raised` reads as clutter.
- **Spacing** — 4px base. Panel padding 16. Table rows 40 (36 compact). Chrome heights are named
  tokens: `chrome 52` (TopBar), `tabs 44` (ModuleTabs), `rail 30` (StatusRail).
- **Motion** — one curve, `ease-ui` = `cubic-bezier(.2,0,.2,1)`. 100–160 ms for state changes,
  700–800 ms for a metric tween. No bounce. `prefers-reduced-motion` snaps everything.

---

## 5. Surfaces — the five `Panel` variants

| Variant | Use |
|---|---|
| `default` | the standard raised white surface |
| `flush` | a section inside an already-bordered frame |
| `sunk` | a recessed well: charts, readouts |
| `navy` | institutional identity blocks, map side rails |
| `float` | translucent + blurred, the only variant that sits on the map |
| `bare` | structure only, for a child that paints its own ground (map, image) |

Plus `HeroBand` (photographic page header) and `ImagePanel` (photographic content block).

**Every panel shares one header** — `PanelHeader`, fixed height, uppercase label, optional
right-aligned action. That single rule is what makes twelve dissimilar blocks read as one
system.

---

## 6. Iconography

`lucide-react` behind a curated vocabulary in `design/icons.tsx`. Sizes are fixed per role:
`sm 14/1.75` (inline, chips, table cells) · `md 16/1.75` (buttons, nav, panel headers) ·
`lg 20/1.75` (stat tiles, empty states) · `xl 24/1.5`.

**One concept, one icon.** Adding a second truck or a third warning glyph is how an interface
stops feeling designed. `IconBadge` puts an icon on a tinted ground with a hairline ring —
the ring is what stops it reading as a flat coloured blob at small sizes.

---

## 7. Graphics that carry information

- **`FactorBar` / `FactorBreakdown`** — the SHAP readout, the most important graphic in the
  product. `FactorBreakdown` computes the shared scale itself so two groups can never be
  rendered on different scales and look comparable when they are not.
- **`RadialGauge`** — 270° arc, open at the bottom so it does not read as a spinner.
- **`Sparkline`**, **`RiskBarCell`**, **`Meter`** (with a threshold marker), **`ProgressBar`**.
- **`Timeline`** — `chain` for the cascade, `track` for route progress. Steps carry their own
  state, so a cascade that failed at the notification stage is legible rather than hidden.
- **Map markers** — every mark carries a **white casing stroke**. Over satellite imagery a mark
  without one disappears; this single detail decides whether the map reads as designed.

Charts on Analytics use Recharts. A 96px dial or a 40px sparkline does not — hand-drawn SVG
gives more control over stroke, cap and gradient for a fraction of the weight.

---

## 8. States

Empty, loading and error are designed compositions, not a grey sentence.

- **Empty** — in an operational tool, "nothing to show" is information. `tone="positive"` for
  empties that are good news ("No alerts on the corridor").
- **Error** — always offers a retry. Shows the HTTP status quietly: a 503 tells a different
  story from a 500, and the contract is explicit that a failed routing call fabricates nothing.
- **Skeleton** — shaped like the thing it replaces (`SkeletonTile`, `SkeletonRows`,
  `SkeletonPane`), so nothing reflows when data lands.
- **`Async`** renders the right one from a `useResource` result, so a page never spells the
  four-branch conditional out again.

---

## 9. Provenance

`ProvenanceTag` marks where a value came from: `SYNTHETIC_HISTORICAL`,
`SYNTHETIC_OPERATIONAL`, `SIMULATION_EVENT`, `ML_PREDICTION`, `LLM_EXPLANATION`,
`EXTERNAL_API`.

Deliberately quiet — 10.5px, tertiary ink, no fill, hover for the full explanation. It belongs
in a panel footer or beside a section label, **not on every value**. The project reference
requires that synthetic data is never presented as a live measurement; this is how that
requirement is met without covering the UI in labels.

---

## 10. Responsive

Desktop-first. Primary target **1920×1080**; must work at **1440×900** and **1280×800**.

- The shell never scrolls; the page owns its own scrolling.
- Wide content (tables, maps) scrolls inside its own container — the page body never scrolls
  sideways.
- Below 1280 the TopBar drops its positioning line before the tab bar loses anything.
- Mobile is explicitly not a target. This is an operational desktop console.

---

## 11. Accessibility

- Body text is `ink-2` on `panel` (7.4:1). Metadata `ink-3` is used only at ≥11px and never for
  anything a decision depends on.
- Risk is never signalled by colour alone — every risk chip carries its level as a word, and
  every status dot has a label.
- Icon-only controls require a `label` prop; `IconButton` will not compile without one.
- Focus is a 2px `brand-500` ring at 2px offset, globally, never removed.
