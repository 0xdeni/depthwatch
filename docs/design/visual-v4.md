# Depthwatch v4 visual and interaction spec

Status: **binding for the v4 build of `apps/web`.** It supersedes [`visual-v3.md`](visual-v3.md)
wherever the two differ (§1.4 lists the differences) and amends the rules of
[`principles.md`](principles.md) and [`ia-v3.md`](ia-v3.md) named in §1.8. Everything those files
say that this file does not change still holds: the screens and their order, the number formats,
the disclosure ladder, the states, the URL state and the accessibility rules.
- **Visual reference.** A static prototype built on the same snapshot settled every value in
  this file. It is not part of the repository, and this file is complete without it.
- **Data.** Every measured number here and in the prototype comes from one snapshot: Base mainnet
  at 11:30 UTC on 25 Oct 2026 (block 53,069,244), 580 pools found, 492 tracked, 50 rated, $49.9M
  within 2 % of the price. The one illustrative value is the example scorecard's mandate (a $400K
  per-side KPI and a 95 % uptime target on a real pool), and it is labelled as an example.
- **Measurements** are CSS px at 1440×900 and 390×844 (2× DPR), in both themes, with all
  disclosures closed and the web fonts loaded.

---

## 1. Direction

### 1.1 The brief

The v4 brief: a bolder, more Base-like, animated and modern look, with depth and a striking first
impression. The v3 look (calm, light, restrained) read as too quiet.

v4 changes the visual language completely and keeps every data-first rule that makes the product
credible:
- numbers formatted honestly (N1–N11);
- one focal element per screen (P1) and the first-viewport answer (P3);
- progressive disclosure (P5, P6);
- truthful charts (CH1–CH10), with one shared scale wherever pools are compared;
- phone-first ergonomics (PH1–PH9);
- accessibility (A1–A11) and a designed reduced-motion mode (M9).

"Base-like" means Base's own brand kit (§2): Base Blue as a flat anchor surface and large-type
colour, true black and white as the other two surfaces, the locked gray ramp and secondary
palette, the rounded square as the geometric unit, oversized lowercase display type with tight
leading, wide-tracked all-caps mono labels, hard edges and generous space. Depthwatch never uses
Base's marks.

### 1.2 How the direction was chosen

Three studies were built on the same snapshot and scored out of 100 on three criteria: visual
impact and brand, UX and ergonomics, and data integrity.

| Study             | Visual |  UX | Data |   Total |
| ----------------- | -----: | --: | ---: | ------: |
| Kinetic editorial |     84 |  78 |   75 | **237** |
| Blue field        |     80 |  70 |   80 |     230 |
| Deep instrument   |     64 |  73 |   58 |     195 |

The arithmetic: 84 + 78 + 75 = 237, 80 + 70 + 80 = 230 and 64 + 73 + 58 = 195. **Kinetic
editorial** was chosen: first on two criteria and second, 5 points behind Blue field, on data
integrity.

No study had a disqualifying brand fault: none used The Square, the Basemark or a lockup, and all
three kept Depthwatch's three-bar mark and said "Built on Base" in plain text. Two near misses are
resolved, not ignored: Blue field and Deep instrument put a Base Blue rounded square in the app bar
as a status marker (a Square lookalike), and the chosen study used a small green rounded square there.
v4 uses a green **circle**, which is also the "ok" status shape (§2.3, §5.1).

### 1.3 What v4 is

- **The band.** Every page but Not found opens on a full-bleed, flat Base Blue band, or reaches one
  directly under its title block. The band carries the page's focal element in white and Yellow:
  - Home: the depth butterfly of Base;
  - Pools: the square field (one square per pool, area true to depth) and the filters;
  - Pool: the mirrored depth curve;
  - Scorecard: the KPI chart of the latest sample;
  - Token: the butterfly scoped to the token;
  - Gaps, Scorecards and Methodology: the page's lead sentence.
- **Giant lowercase type.** Hanken Grotesk at weight 850 with tight tracking: the Home figure at up
  to 196 px, page titles ("pools", "gaps") at up to 120 px, lowercase section headings ("cost to
  trade"). No third family.
- **Depth by stacking.** Rounded-square blocks (radius 18) overlap the band's lower edge by 48, 64
  or 72 px and cast a deep navy shadow that reads on blue in both themes. No glow, blur, glass,
  tilt or parallax; no shadow on text or chart marks.
- **A flat, locked palette.** Base Blue, Gray 100 (true black), white and the gray ramp as
  surfaces; Cerulean for the sell side and Yellow for the buy side; Green, Tan and Red for status.
  No gradients and no values between kit shades.
- **Motion that builds the page once.** On the first view of a session the band drops, the title
  rises, bars grow from their spine and the blocks settle over the band, all within 450 ms. After
  that, a route change is a 180 ms cross-fade and everything else is near-invisible feedback.
- **Mono caps only for eyebrows.** IBM Plex Mono, uppercase and tracked +0.09em, marks the one-line
  metadata above a title, a band or a fact. Every other label is sentence-case sans.

### 1.4 What changed from v3, and why

- **Neutrals.** v3 tinted OKLCH greys (`#f8f9fc`, `#0e131c`); v4 uses the locked kit grays, white
  and Gray 100 `#0A0B0D`. Base's light theme is white and its dark theme is black, not navy.
- **Chrome.** v3 was monochrome with colour only in data; v4 opens every page on a flat Base Blue
  band and uses Blue for the primary button and the nav indicator. Blue is Base's anchor surface.
- **Side colours.** v3 used blue `#196ea9` and orange `#c9690c`; v4 draws the sell side in
  Cerulean (white on the band) and the buy side in Yellow. Both are kit values, the pair is the
  clearest colour-blind-safe pair in the kit, and Base Blue stays identity, never data.
- **Status.** v3 used tinted chips and coloured words; v4 uses Green, Tan and Red fills behind an
  ink letter and shape, and ink status words with a coloured shape. Red and Green fail as text.
- **Surfaces.** v3 was one surface with no cards (E1); v4 has the band, blocks stacked over its
  edge and one sections sheet per detail page. That is the brief's "depth" without effects.
- **Elevation.** v3 had shadows on floating layers only and none in dark; v4 gives blocks tinted
  plane shadows, a navy shadow over the band in both themes, and 1 px edges in dark.
- **Type.** v3 set the display at 56 px and weight 500; v4 sets the Home figure at up to 196 px
  and 850, page titles and section headings in lowercase, and eyebrows in mono caps.
- **Home focal.** v3 drew the butterfly with a halftone total row and a sliding lens; v4 puts the
  butterfly on the band, splits the total row into per-pool segments with a hatched remainder and
  states the concentration in a bracket ("59 % of it sits in one pool").
- **Pool focal.** The same CH3 curve, filled with flat white and Yellow instead of a halftone.
- **Scorecard focal.** v3 led with the mirrored time chart; v4 leads with the KPI chart of the
  latest sample per side, its shortfall hatched in Red, and moves the time chart to the first
  section. A breach reads in one glance.
- **Pools.** v3 put the table under a title; v4 opens on a band with the square field and a DEX
  filter that shows each DEX's share of depth, and the table sheet overlaps the band.
- **Detail sections.** v3 laid sections on the canvas; v4 sets them as rows of one sections sheet,
  so there is no card grid and no dead space.
- **First view.** v3 animated the first Home view; v4 animates the first view of a session on
  whichever route the visitor lands on, because shared pool and scorecard links are first
  impressions too. The 450 ms ceiling stays.
- **Footer.** v3 used the canvas and a hairline; v4 uses a black block in both themes.
- **Mark and favicon.** The same three bars, with the sides in Cerulean and Yellow.

### 1.5 Grafted from the other studies

| Idea                                                  | From            | Where in v4         |
| ----------------------------------------------------- | --------------- | ------------------- |
| One rounded square per pool, area true to its depth   | Blue field      | Pools band, §5.9.2  |
| Tap docks the readout; the second tap opens the pool  | Blue field      | Butterfly, field    |
| The field is one focusable group, stepped by arrows   | Blue field      | Field, butterfly    |
| "Not rated" chips with reasons, unrated pools grouped | Blue field, v3  | Pools table         |
| Cerulean for the sell side, Yellow for the buy side   | Deep instrument | Off the band        |
| Crosshair snaps to measured points; arrow keys step   | Deep instrument | Depth curve, §5.9.3 |
| Section: heading, one finding sentence, "Details"     | Deep instrument | Sections sheet      |
| Cropped y range labelled at its top and bottom        | Deep instrument | History multiples   |
| Facts that carry their comparison in the label        | Deep instrument | Home and Pool facts |
| Honest state copy; the no-mandate empty state         | Deep instrument | Over time, `/mm`    |
| Overlapping cross-fade, never a blank frame           | Deep instrument | Route change        |
| Once-per-session gate in `sessionStorage`             | Deep instrument | First view          |

### 1.6 Corrections to the chosen study

Every correction made to Kinetic editorial, with the criterion that raised it.
- **Odometer showed broken and false digits** (all three). Nothing counts or rolls; a figure
  appears once, whole (§4.1).
- **The sell side changed colour by surface** (visual, data). One mapping: Cerulean on white or
  black, white on Base Blue; Yellow for the buy side everywhere; value labels in ink; no Blue data.
- **The dark split block flipped to bright Gray 10** (visual). The ink block is Gray 100 in both
  themes, with a Gray 80 edge in dark.
- **Pool sections in a 2×2 card grid** (visual). One sections sheet, one full-width row each.
- **Mono caps on DEX lines, axes, legends, footer and captions** (visual). Eyebrows only (§3.4).
- **A busy route transition at 80 ms** (visual, UX). `<main>` fades out in 100 ms while the new
  view fades in over 180 ms; no ghost lift, no band wipe, no re-entrance.
- **Pages far over budget** (visual, UX). Home is 19 % shorter on desktop and 25 % on phones,
  Pool 28 % and Pools 38 % shorter on phones; the budgets of §6.1 replace P9.
- **A sticky bottom dock, untested in iOS Safari** (visual, UX). A browser tab keeps the top tab
  strip (PH3); the dock appears only in an installed app (`display-mode: standalone`).
- **The favicon kept v3 colours** (visual). Same three bars, sides in Cerulean and Yellow.
- **The entrance replayed on every route** (UX). It plays once per session; routes cross-fade.
- **Home settled at about 1.3 s and masks cut glyphs** (UX). Every first-view animation ends by
  450 ms (Home measures 440 ms); titles rise with opacity, without a clip mask.
- **Scroll reveal, card lift and a 72 px slide** (UX). None. Blocks rise 24 px inside the first
  view only, and hover fades in a shadow layer.
- **"Browse pools" below the 1440×900 fold** (UX). It sits in the hero, at y 349.
- **"Example" twice; no legend for the hatch** (UX). One "Example scorecard" eyebrow; "One scale
  for every pool. The other 485 pools." with the hatch swatch under the butterfly.
- **DEX tiles normalised to the largest DEX** (data). Bars are each DEX's share of all depth within
  2 %: 83 %, 13 %, 3 % and under 1 %, labelled.
- **Traded and depth bars on different tracks** (data). One track width; depth draws at 26 %.
- **Sparklines stretched noise with no y labels** (data). The minimum and maximum are labelled at
  the right, and the x axis spans only the minutes the snapshots cover, which the caption states.
- **An uptime rule invented outside core; badge text** (data). Uptime follows core
  `computeUptime`: "0 of 1" checkable snapshots, uptime 0 %. The badge preview is the API's SVG
  text and colours: "breached · 7d 0%".
- **Side totals shown before their bars** (data). Totals fade in at 260 ms, after the bars.
- **Cumulative columns read as per-band increments** (data). The CH3 mirrored curve: log-spaced
  x, measured points only, areas filled from zero, y ticks on the spine.

### 1.7 Considered and not taken

- **A 6 px hover lift on single-destination blocks.** M7 forbids card hover lift and M2 puts hover
  (tens of times a day) at near-invisible. The block's plane-2 shadow layer fades in instead.
- **Springs** (the study's `spring-enter` and `spring-lift`). Overshoot reads as bounce (M7), and
  beziers keep every frame deterministic and seekable.
- **A third, display face** (the other studies tried Archivo and Host Grotesk). Hanken Grotesk at
  850 and −0.06em already gives the poster lowercase; a third family costs a request and a licence
  step for no gain (T1).
- **Glow planes, glass panels, pointer tilt and parallax.** In the study that used them they moved
  data marks, or drew light where there was no data.
- **Hard offset shadows** (Blue field). One depth language is enough: stacking with navy shadows.
- **Count-up and odometer figures.** Every mid-animation frame showed a false number.
- **A blue rounded square** as an icon, bullet or status marker anywhere (§2.3).
- **A fixed bottom bar in a browser tab** (PH3; WebKit bug 281071).
- **Equal-width columns for cumulative depth.** They invite reading each column as an increment.
- **The v3 field of light (halftone).** Flat kit fills replace texture.

### 1.8 Rules this spec amends

These amendments hold for v4. `principles.md` and `ia-v3.md` keep their v3 wording until the v4
build lands, and that change updates them at the rules named here (§7.7). Every rule not named
stays as it is.

| Rule                    | v4 wording, in short                                                  |
| ----------------------- | --------------------------------------------------------------------- |
| §0 consequence 2, C2    | Base Blue may also be the band, the primary button, the nav indicator |
| P2                      | Pools: the DEX filter's five shares are labels, exempt like columns   |
| P9                      | The budgets of §6                                                     |
| T1, T11, forbidden 1, 4 | Plex Mono also sets eyebrows, uppercase at +0.09em; nowhere else      |
| T4, T6, T7              | The type scale of §3.4                                                |
| C1, forbidden 13        | Locked kit hex values; Gray 100 is Base's black, chosen on purpose    |
| C3                      | Sell Cerulean (white on Blue), buy Yellow; Blue never marks data      |
| C4                      | Green, Tan and Red fills behind an ink letter and shape               |
| C5, CH7, CH8            | Breach bands and cells use Red; `--bad-mark` is retired               |
| C6                      | The contrast tiers of §2.4                                            |
| C7                      | Dark: Gray 100 with Gray 80 edges; text Gray 10, white only on Blue   |
| C9, E6                  | No gradients, no texture; hatching marks "the rest" and shortfalls    |
| E1, E2, forbidden 6, 7  | Band, plane-1 blocks, plane-2 blocks over the band, a sections sheet  |
| E3, E4                  | The radii of §3.6 and the planes of §3.7                              |
| M1, M3, M6              | §3.8 and §4; the first view plays on the landing route                |
| K11                     | The mark's sides are Cerulean and Yellow                              |
| CH3                     | Flat areas, ringed square points, ±2 % labels above the plot          |
| CH4                     | Per-pool segments in the total row, hatched rest, a bracket           |

Forbidden pattern 16 (motion clichés) still holds in full: no count-up, no fade-up on scroll, no
hover lift, no bounce, no pulse and no line draw-in. Bars growing from the spine and the curve's
areas opening from the spine are the one orchestrated moment that M6 allows.

---

## 2. Brand constraints

### 2.1 Source

Base's public brand kit, `github.com/base/brand-kit` at `eba9e73` (2025-08-07):
`guides/brand-guide.pdf` (v1.0, June 2025) and `guides/editorial-style-guide.md`. The live pages
base.org/brand and docs.base.org could not be read from the sandbox this spec was written in; if
they differ from the kit, the live pages win (CONTRIBUTING.md). Check them before release.

### 2.2 Palette

The kit says to keep values locked and never interpolate between shades. v4 uses these values and
no others; an opacity over a kit value (white at 80 % on Blue, a 14 % Red band) is allowed, a new
hex value is not.

| Name     | Hex       | Role in Depthwatch                                                          |
| -------- | --------- | --------------------------------------------------------------------------- |
| Blue     | `#0000FF` | The band; primary button; nav indicator (light); focus (light)              |
| Cerulean | `#3C8AFF` | The sell side off the band; nav indicator and focus in dark                 |
| Yellow   | `#FFD12F` | The buy side everywhere; the focus ring on the band                         |
| Green    | `#66C800` | Status ok: grades A and B, within KPI, the live freshness dot               |
| Tan      | `#B8A581` | Status warn: grade C; a late snapshot's freshness dot                       |
| Red      | `#FC401F` | Status bad: grades D and F, breaches, KPI shortfalls                        |
| Lime     | `#B6F569` | Not used                                                                    |
| Pink     | `#FEA8CD` | Not used                                                                    |
| Gray 0   | `#FFFFFF` | Light canvas and blocks; text and marks on the band                         |
| Gray 10  | `#EEF0F3` | Light wells, tracks, panels, row hover; dark text-1                         |
| Gray 15  | `#DEE1E7` | Light hairlines and block edges                                             |
| Gray 30  | `#B1B7C3` | Light hollow cells, tracks and underlines; dark text-2                      |
| Gray 50  | `#717886` | Light control outlines; not used for text (4.44:1 on white and on Gray 100) |
| Gray 60  | `#5B616E` | Light text-2; dark control outlines                                         |
| Gray 80  | `#32353D` | Dark wells, tracks, hairlines and block edges                               |
| Gray 100 | `#0A0B0D` | Dark canvas; the ink block and the footer in both themes; ink               |

### 2.3 What Depthwatch may and may not use

**May:**
- the palette above, at the values above;
- Base Blue as a full-bleed flat surface and as large display colour on white;
- black and white as full surfaces;
- the rounded square as the geometric unit of its own blocks, field squares and chart points;
- oversized lowercase display type in its own fonts, and small mono caps eyebrows;
- the words "Built on Base" and "it indexes Uniswap and Aerodrome pools on Base mainnet" in plain
  text, with Depthwatch's name first.

**May not:**
- The Square, the Basemark or the "base" logotype, as Depthwatch's identity, in a lockup with
  Depthwatch's mark, altered, recoloured, rearranged or with effects;
- anything that reads as one of them: no solid Base Blue rounded square as an icon, bullet, status
  marker, favicon or avatar, at any size, on any surface (the band is full-bleed, never a square,
  and Depthwatch's blocks are white, Gray 10 or Gray 100, never Blue);
- a claim of partnership, collaboration or endorsement, or "Base x Depthwatch" ordering;
- Base's typeface (the kit ships none to third parties);
- "BASE", "Base Chain", "Base Network" or "$BASE"; financial terms (gains, yields);
  disputable superlatives ("the best", "the first"). Write "onchain" as one word.

**Depthwatch's own mark** keeps its geometry: a 2 × 14 spine and three steps on each side. The
sell steps are Cerulean, the buy steps Yellow with a 0.5 px Gray 100 edge in light, the spine is
`currentColor` (Gray 100 in light, Gray 10 in dark). It never sits on a Base Blue rounded square
and never appears next to a Base mark.

### 2.4 Contrast rules

WCAG 2 ratios, computed with the relative-luminance formula on the kit values. They replace the
v3 tiers of C6, which locked kit grays cannot meet exactly (no kit gray sits between Gray 60 at
6.2:1 and Gray 80 at 12.3:1 on white).
- **Text tiers.** text-1 ≥ 15:1 on canvas and blocks; text-2 ≥ 6:1 on canvas (≥ 5.4:1 on Gray 10
  wells, still AA); on the band, white (8.6:1) and white at 80 % (5.6:1). Every text pair is at
  least WCAG AA 4.5:1.
- **Marks and controls** ≥ 3:1 against the surface they sit on.
- **Blue is never text on dark** (2.3:1 on Gray 100). On dark, the blue that reads is Cerulean.
- **Cerulean is never on the band** (2.6:1 on Blue). On Blue, only white and Yellow draw.
- **Yellow is never text on white** (1.46:1). On white a Yellow mark carries a 1 px Gray 100 edge.
- **Red and Green are never text** (Red 3.6:1, Green 2.1:1 on white). Status words are ink with a
  coloured shape; status fills carry ink letters.
- **Side marks sit on white, black or Blue,** never on a Gray 10 well (Cerulean there is 2.9:1):
  in a well, a side bar sits on a white track.

| Pair                              |             Ratio | Use                                  |
| --------------------------------- | ----------------: | ------------------------------------ |
| Gray 100 on white                 |            19.7:1 | Light text-1                         |
| Gray 60 on white                  |             6.2:1 | Light text-2, eyebrows               |
| Gray 60 on Gray 10                |             5.4:1 | Light text-2 in wells and panels     |
| Gray 10 on Gray 100               |            17.3:1 | Dark text-1                          |
| Gray 30 on Gray 100               |             9.8:1 | Dark text-2; text-2 on the ink block |
| Gray 30 on Gray 80                |             6.1:1 | Dark text-2 in wells                 |
| White on Blue                     |             8.6:1 | Band text, sell marks; Blue buttons  |
| White at 80 % on Blue (`#CCCCFF`) |             5.6:1 | Band secondary text                  |
| Yellow on Blue                    |             5.9:1 | Buy marks; focus ring on the band    |
| Cerulean on white                 |             3.4:1 | Sell marks (marks only)              |
| Cerulean on Gray 100              |             5.9:1 | Sell marks; dark focus and nav       |
| Yellow on Gray 100                |            13.5:1 | Buy marks on dark                    |
| Gray 100 on Green / Tan / Red     | 9.2 / 8.2 / 5.5:1 | Grade and status letters             |
| Red on white / on Gray 100        |       3.6 / 5.5:1 | Breach triangle, shortfall hatch     |
| Blue on white                     |             8.6:1 | Light focus ring and nav indicator   |

The grade fills themselves are 2.1:1 (Green) and 2.4:1 (Tan) on white; that is acceptable because
the letter and the shape inside carry the grade, and the fill is never the only cue (A6).

---

## 3. Tokens

### 3.1 Colour

Hex values only, from the kit (§2.2). The product follows the system appearance (PH2);
`[data-theme]` exists only for screenshots and tests, and the dark block is repeated verbatim
under `:root[data-theme='dark']`.

```css
:root {
  color-scheme: light;
  /* Base brand kit v1.0, locked */
  --blue: #0000ff;
  --cerulean: #3c8aff;
  --yellow: #ffd12f;
  --green: #66c800;
  --red: #fc401f;
  --tan: #b8a581;
  --g0: #ffffff;
  --g10: #eef0f3;
  --g15: #dee1e7;
  --g30: #b1b7c3;
  --g50: #717886;
  --g60: #5b616e;
  --g80: #32353d;
  --g100: #0a0b0d;

  /* Roles, light */
  --canvas: var(--g0);
  --surface: var(--g0); /* plane-1 blocks, table sheet, sections sheet */
  --surface-2: var(--g10); /* wells, tracks, panels, row hover, segmented track */
  --line: var(--g15); /* row rules, block edges */
  --line-2: var(--g30); /* hollow cells, tracks */
  --ctl-edge: var(--g50); /* control outlines, 4.4:1 (dark: Gray 60, 3.2:1); WCAG 1.4.11 */
  --text-1: var(--g100); /* 19.7:1 */
  --text-2: var(--g60); /* 6.2:1; 5.4:1 on --surface-2 */
  --ink: var(--g100); /* the black block and the footer */
  --on-ink: var(--g0);
  --on-ink-2: var(--g30); /* 9.8:1 */
  --ink-edge: transparent;
  --band: var(--blue);
  --on-band: #ffffff; /* 8.6:1 */
  --on-band-2: rgb(255 255 255 / 0.8); /* 5.6:1 */
  --sell: var(--cerulean); /* marks only: 3.4:1 on white, 5.9:1 on Gray 100 */
  --buy: var(--yellow); /* marks only */
  --buy-edge: var(--g100); /* 1 px edge on every Yellow mark on white */
  --sell-band: #ffffff; /* sell marks on the band */
  --buy-band: var(--yellow); /* buy marks on the band, 5.9:1 */
  --ok: var(--green);
  --warn: var(--tan);
  --bad: var(--red);
  --on-status: var(--g100); /* letters on status fills */
  --breach-op: 0.14; /* Red breach bands behind series */
  --focus: var(--blue);
  --focus-band: var(--yellow);
  --nav-ind: var(--blue);
  --scrim: rgb(10 11 13 / 0.5);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --canvas: var(--g100);
    --surface: var(--g100); /* blocks are told apart by their Gray 80 edge */
    --surface-2: var(--g80);
    --line: var(--g80);
    --line-2: var(--g60);
    --ctl-edge: var(--g60); /* 3.2:1 on Gray 100 */
    --text-1: var(--g10); /* 17.3:1; text is never pure white off the band */
    --text-2: var(--g30); /* 9.8:1; 6.1:1 on --surface-2 */
    --ink: var(--g100);
    --on-ink: var(--g10);
    --on-ink-2: var(--g30);
    --ink-edge: var(--g80);
    --sell: var(--cerulean);
    --buy-edge: transparent;
    --breach-op: 0.22;
    --focus: var(--cerulean);
    --nav-ind: var(--cerulean);
    --scrim: rgb(10 11 13 / 0.6);
  }
}
/* :root[data-theme='dark'] { the same declarations, verbatim } */

@media (prefers-contrast: more) {
  :root {
    --text-2: var(--g80);
    --line: var(--g50);
  }
  .band {
    --on-band-2: #ffffff;
  }
}

@media (forced-colors: active) {
  /* bars, segments, field squares, curve areas, strip cells, grade glyphs and chips */
  .bf-b,
  .bf-seg,
  .glyph i,
  .kpi-bar,
  .gl,
  .chip,
  .sq,
  .wbar i,
  .strip i {
    forced-color-adjust: none;
  }
}
```

**Usage.**
- `--sell` and `--buy` mark the two sides and nothing else (C3). Off the band the sell side is
  Cerulean; on the band it is white and the buy side stays Yellow. Value labels are never in a
  side colour: they are ink (`--text-1`, or Gray 100 inside a white or Yellow bar).
- Base Blue appears as the band, the primary button, the nav indicator and the light focus ring.
  It never marks data, a series, a link underline or a status.
- Status colours fill grade glyphs and status chips (with ink letters), and colour shapes:
  the freshness dot, the breach triangle, breached strip cells, the shortfall hatch and breach
  bands. Words stay ink.
- Plumbing: `<meta name="theme-color">` is `#ffffff` in light and `#0a0b0d` in dark. A theme change
  suppresses transitions for two frames (C8).

### 3.2 From v3 tokens to v4 tokens

| v3                                 | v4                                    |
| ---------------------------------- | ------------------------------------- |
| `--canvas` (tinted)                | `--canvas` (white, Gray 100)          |
| `--raised`, `--overlay`            | `--surface`                           |
| `--well`, `--hover`                | `--surface-2`                         |
| `--border-subtle`, `--border`      | `--line`                              |
| `--control`                        | `--line-2`                            |
| `--text-1`, `--text-2`             | `--text-1`, `--text-2` (new values)   |
| `--text-3`                         | `--text-2` (`--text-3` is retired)    |
| `--sell`, `--buy`                  | `--sell`, `--buy`, plus the band pair |
| `--ok`, `--warn`, `--bad`          | The same names, now fills             |
| `--ok-bg`, `--warn-bg`, `--bad-bg` | Retired: fills are the status colours |
| `--bad-mark`, `--band-op`          | `--bad` with `--breach-op`            |
| `--dot`, `--ht-*`, `--field-*`     | Retired with the field of light       |
| `--shadow-pop`, `--shadow-dialog`  | `--sh-3`                              |

New in v4: `--band`, `--on-band`, `--on-band-2`, `--ink`, `--on-ink`, `--on-ink-2`, `--ink-edge`,
`--sell-band`, `--buy-band`, `--buy-edge`, `--on-status`, `--breach-op`, `--focus-band`,
`--nav-ind`, `--edge`, `--hl`, `--hl-ink`, `--sh-1`, `--sh-2` and `--sh-band`.

### 3.3 Fonts

**Faces.** The two self-hosted families of v3 and no third:
- **Hanken Grotesk** (variable, 100–900) sets every word and number, from 12 px captions to the
  196 px Home figure. At 850 with −0.06em tracking it gives the oversized lowercase the kit's
  headlines have, so no display face was added.
- **IBM Plex Mono** 400/500 sets eyebrows (uppercase, 12 px, 500, +0.09em), on-chain identifiers
  (addresses, pool ids, block numbers) and code.

**Loading** is unchanged from v3: the subsets in `apps/web/public/fonts/` with their OFL licences,
the sans file preloaded, `font-display: swap`, and the metric-matched fallback face. No request to
Google Fonts or any third-party font host.

```css
@font-face {
  font-family: "Hanken Grotesk";
  src: url("/fonts/hanken-grotesk-var.woff2") format("woff2");
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-400.woff2") format("woff2");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("/fonts/ibm-plex-mono-500.woff2") format("woff2");
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: "Hanken Fallback";
  src: local("Arial"), local("Helvetica"), local("Liberation Sans");
  size-adjust: 101.7%;
  ascent-override: 98.3%;
  descent-override: 29.8%;
  line-gap-override: 0%;
}
:root {
  --sans:
    "Hanken Grotesk", "Hanken Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
    Roboto, Helvetica, Arial, sans-serif;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
```

### 3.4 Type scale

These are the only sizes. Every number is tabular. The floor is 12 px. Headings use
`text-wrap: balance`, prose `text-wrap: pretty`.

```css
:root {
  --t-mega: clamp(6rem, 3.6rem + 9.6vw, 12.25rem); /* 96 → 196 */
  --t-title: clamp(3.25rem, 2rem + 5.6vw, 7.5rem); /* 52 → 120 */
  --t-display: clamp(2rem, 1.35rem + 2.75vw, 4rem); /* 32 → 64 */
  --t-say: clamp(1.75rem, 1.2rem + 2vw, 3rem); /* 28 → 48 */
  --t-answer: clamp(1.375rem, 1.1rem + 1.2vw, 2.25rem); /* 22 → 36 */
  --t-h2: clamp(1.625rem, 1.35rem + 1.1vw, 2.5rem); /* 26 → 40 */
  --t-kpi: clamp(2.25rem, 1.8rem + 1.8vw, 3.5rem); /* 36 → 56 */
  --t-figure: clamp(1.5rem, 1.1rem + 1.6vw, 2.5rem); /* 24 → 40 */
  --t-lead: 1.1875rem; /* 19 */
  --t-body: 1rem; /* 16 */
  --t-data: 0.9375rem; /* 15 */
  --t-small: 0.8125rem; /* 13 */
  --t-caption: 0.75rem; /* 12 */
}
```

| Token         | px      |  Weight | Leading | Tracking | Role                                  |
| ------------- | ------- | ------: | ------: | -------: | ------------------------------------- |
| `--t-mega`    | 96–196  |     850 |    0.80 | −0.062em | The Home figure, one line, `nowrap`   |
| `--t-title`   | 52–120  |     850 |    0.86 | −0.058em | Page titles ("pools", "WETH / USDC")  |
| `--t-display` | 32–64   |     800 |    0.96 | −0.045em | Scorecard title, not-found title      |
| `--t-say`     | 28–48   |     800 |    1.00 | −0.045em | The Home sentence after the figure    |
| `--t-answer`  | 22–36   |     750 |    1.08 | −0.035em | Answer sentences, ≤ 26ch              |
| `--t-h2`      | 26–40   |     800 |    1.00 |  −0.04em | Section and block headings, lowercase |
| `--t-kpi`     | 36–56   |     820 |    0.92 |  −0.05em | Fact values                           |
| `--t-figure`  | 24–40   |     820 |    1.00 |  −0.05em | Chart direct labels, butterfly totals |
| `--t-lead`    | 19      |     450 |    1.42 |  −0.01em | Leads, ≤ 44ch (16 on phones)          |
| `--t-body`    | 16      |     450 |    1.50 |        0 | Body, takeaways (`--text-2`), ≤ 40ch  |
| `--t-data`    | 15      |     600 |    1.40 |        0 | Table cells, fact labels, row lines   |
| `--t-small`   | 13      | 500–650 |    1.40 |        0 | Meta lines, legends, table headers    |
| `--t-caption` | 12      |     500 |    1.35 |        0 | Axis ticks, captions (sans)           |
| Eyebrow       | 12 mono |     500 |    1.34 |  +0.09em | Uppercase metadata only               |

**Case.** Page titles and section headings are lowercase words ("pools", "where liquidity is
thin", "cost to trade"); token symbols and pair names keep their case ("WETH / USDC"). Answers,
leads, labels, buttons and table headers are sentence case. Only `.eyebrow` is uppercase:
- the line above a page title or band ("POOLS", "UNISWAP V3 0.05 % FEE");
- the label at the top of a fact block ("24 H VOLUME");
- the block number in the app bar.

Everything else that v3's study set in mono caps (DEX and fee lines, axes, legends, table headers,
footer links, captions) is sans in sentence case.

**Answer sentences are one colour** (T13): no accented word or differently coloured number.

### 3.5 Space, grid and chrome

- **Scale:** 4, 8, 12, 16, 24, 32, 48, 64, 96, 128. Other lengths: 1 px hairlines and edges, 2 px
  rules and the spine, 4 px indicators.
- **Content:** max 1312 px, centred.
- **Gutters:** `max(16px, env(safe-area-inset-left))` below 600 px, 32 px from 600, 64 px from
  1200.
- **Breakpoints** (em): 37.5 (600), 52.5 (840, the phone layout below it), 64 (1024, two-column
  title blocks and sections), 75 (1200).
- **Chrome heights:** snapshot or demo line 32; app bar 64 from 840 px; on phones a 56 px bar plus
  a 44 px tab strip (100). `scroll-padding-top` is the sticky chrome plus 8.
- **The overlap** of blocks over the band: 48 px below 600, 64 from 600, 72 from 1200.

| Gap                               | Desktop             | Phone        |
| --------------------------------- | ------------------- | ------------ |
| Band top padding                  | 24 (Home), 32       | 24           |
| Band bottom padding               | overlap + 24        | overlap + 24 |
| Title section padding             | 32 top, 24 bottom   | the same     |
| Eyebrow to title                  | 12                  | 12           |
| Title to price line               | 12                  | 12           |
| Butterfly top margin              | 32                  | 24           |
| Chart to its foot row (Show data) | 12                  | 12           |
| Blocks: padding                   | 32                  | 24           |
| Blocks: grid gap                  | 24                  | 16           |
| Facts row to the next block       | 24                  | 24           |
| Sections sheet row padding        | 32 × 48 (from 1024) | 24           |
| Last block to footer              | 64                  | 48           |

**Alignment** (S7): the eyebrow, the page title, the focal plot's left edge, the first table column
and section headings share the gutter's edge. The butterfly's spine and the curve's mid line are
the only centred elements.

### 3.6 Radii

| Element                                           | Radius                       |
| ------------------------------------------------- | ---------------------------- |
| Blocks, sheets of blocks, panels                  | 18 (the rounded square)      |
| Phone sheet (top corners)                         | 24                           |
| Popover                                           | 16                           |
| Tooltip, code blocks                              | 12, 10                       |
| Buttons, inputs, segmented track, DEX filter rows | 12                           |
| Segmented item                                    | 9 (12 minus the 3 px inset)  |
| Grade glyph and Not rated chip; status chip       | 6; 9                         |
| Field squares                                     | 16 % of the side, at least 1 |
| Curve points (12 px squares); uptime strip cells  | 3; 6                         |
| Bars, segments, tracks, the KPI bars              | 0: hard geometry             |
| The API badge preview                             | 3 (the API's own SVG)        |

There are no pills.

### 3.7 Elevation

Four planes. Depth comes from stacking: blocks sit on the canvas or over the band's lower edge.
Nothing glows, blurs or tilts; text and chart marks never carry a shadow; `box-shadow` is never
animated (the hover shadow lives on an `::after` layer whose opacity fades).

| Plane | What                                           | Treatment                     |
| ----- | ---------------------------------------------- | ----------------------------- |
| 0     | Canvas; the band                               | Flat, no shadow               |
| 1     | Blocks on the canvas: sections sheet, previews | `--edge`, `--sh-1`, `--hl`    |
| 2     | Blocks over the band; the ink block            | `--edge`, `--sh-band`, `--hl` |
| 1 +   | A hovered destination block                    | An `::after` with `--sh-2`    |
| 3     | Popover, tooltip, chart tooltip, phone sheet   | `--sh-3`                      |

```css
:root {
  --edge: 0 0 0 1px var(--g15);
  --hl: inset 0 1px 0 rgb(255 255 255 / 0.9);
  --hl-ink: inset 0 1px 0 rgb(255 255 255 / 0.14);
  --sh-1:
    0 1px 1px rgb(0 0 255 / 0.04), 0 4px 10px -4px rgb(0 0 255 / 0.1),
    0 18px 32px -20px rgb(0 0 255 / 0.22);
  --sh-2:
    0 2px 4px rgb(0 0 255 / 0.06), 0 14px 28px -10px rgb(0 0 255 / 0.22),
    0 36px 64px -28px rgb(0 0 255 / 0.32);
  --sh-band:
    0 2px 0 rgb(10 11 13 / 0.18), 0 22px 40px -12px rgb(10 11 13 / 0.5),
    0 60px 90px -40px rgb(10 11 13 / 0.55);
  --sh-3: 0 2px 6px rgb(10 11 13 / 0.12), 0 24px 56px -12px rgb(10 11 13 / 0.34);
}
/* dark */
:root {
  --edge: 0 0 0 1px var(--g80);
  --hl: inset 0 1px 0 rgb(255 255 255 / 0.08);
  --hl-ink: inset 0 1px 0 rgb(255 255 255 / 0.08);
  --sh-1: 0 1px 0 rgb(10 11 13 / 0.5);
  --sh-2: 0 0 0 1px var(--g60), 0 24px 48px -20px rgb(10 11 13 / 0.9);
  --sh-band:
    0 2px 0 rgb(10 11 13 / 0.3), 0 22px 40px -12px rgb(10 11 13 / 0.6),
    0 60px 90px -40px rgb(10 11 13 / 0.7);
  --sh-3: 0 0 0 1px var(--g80), 0 24px 56px -12px rgb(10 11 13 / 0.8);
}
```

- **The ink block** (Home's 24 h volume, the facts row of Pool and Scorecard, the phone facts on
  Home) is `--ink` with `0 0 0 1px var(--ink-edge), var(--sh-band), var(--hl-ink)`: black on white
  in light, black with a Gray 80 edge in dark, never inverted to Gray 10.
- **The band shadow** (`--sh-band`) is Gray 100 at 18–70 %, which reads as navy over Blue in both
  themes; it is what makes a block look stacked over the band. Every shadow and scrim is a kit
  value with alpha (Gray 100 or Blue), never a new colour.
- **In dark,** blocks are the canvas colour and are told apart by their Gray 80 edge; panels drop
  their Gray 10 fill for the canvas plus the edge.

### 3.8 Motion tokens

```css
:root {
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1); /* entrances, exits, press, popovers, sheets out */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1); /* on-screen movement: indicator, thumb, morphs */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1); /* phone sheet in */
  --d-press: 120ms;
  --d-hover: 160ms;
  --d-tip: 140ms;
  --d-pop: 180ms;
  --d-pop-out: 100ms;
  --d-disc: 200ms;
  --d-route-out: 100ms;
  --d-route-in: 180ms;
  --d-indicator: 200ms;
  --d-morph: 280ms;
  --d-sheet: 500ms;
  --d-sheet-out: 260ms;
  --d-first: 450ms; /* the ceiling of the first view, not a duration */
  --press-scale: 0.97;
  --press-scale-block: 0.985;
}
```

- **No springs.** Every curve is one of the three beziers, so seeking any frame gives the same
  picture. Hover colour changes use the `ease` keyword; linear progress uses `linear`; ease-in is
  never used.
- **The tween clock** of v3 (`apps/web/src/lib/motion.ts`: a no-op Web Animation times each
  JS-driven morph, so a new tween starts where the last one stopped) stays for the range, window
  and context morphs, with `easeInOut = bezier(0.65, 0, 0.35, 1)`.
- **Only `transform`, `opacity` and `clip-path` animate**, plus the disclosure panel's opacity. No
  `transition: all`, no `box-shadow`, `width`, `height`, `top`, `left` or `margin` animation.
- **CSS is written no-motion-first:** every transform and keyframe sits inside
  `@media (prefers-reduced-motion: no-preference)` or in a JS branch that checks it.

---

## 4. Motion catalogue

Every animation in the product is listed here; anything not listed does not animate (M7). Each
one names its purpose (M2). Three rules hold everywhere:
- **Keyboard-initiated actions never animate.** A click with `detail === 0`, Enter or Space on a
  control, arrow keys, and focus all change state instantly: route changes, disclosures, sheets,
  popovers, segmented controls, the lens and the crosshair.
- **Nothing loops,** nothing pulses, and no number counts, rolls or ticks up. A snapshot does not
  update, so there is no live marker.
- **Reduced motion** (`prefers-reduced-motion: reduce`) runs no transform and no clip-path anywhere
  (`document.getAnimations()` holds only opacity and colour); each entry below says what it does.

### 4.1 The first view (the one orchestrated moment)

**When.** The first render of a session, on whichever route the visitor lands. The gate is a
`sessionStorage` key (`dw-first-view`), written once the page has rendered; blocked storage simply
plays it again. `?replay=1` replays it for review. Route changes, Back, Forward and refetches never
play it. **Ceiling:** every animation ends by 450 ms. Input is never blocked. **Purpose:** the page
builds itself once: ground, then type, then marks, then the blocks that sit over it.

Steps, as delay and duration in ms, all `--ease-out` except the linear opacity of step 7
(`i` is the element's index in its group):
1. **Band ground:** `clip-path: inset(0 0 40% 0)` to `inset(0)`; 0, 380.
2. **Title parts** (the figure and sentence on Home, the title and answer elsewhere): opacity 0 to
   1 and `translateY(24px)` to 0; 0, 40 and 80, then 360.
3. **Eyebrow, lead and actions** (`[data-in]`): opacity 0 to 1 and `translateY(16px)` to 0;
   60 + 30 i (i ≤ 3), 300.
4. **Bars on the band** (butterfly rows, the total row, the KPI bars): `scaleX` or `scaleY` 0.001
   to 1 from the spine or the baseline; 80 + 10 i (i ≤ 10), 260.
5. **Blocks over the band** (`[data-over]`): opacity 0 to 1 and `translateY(24px)` to 0;
   80 + 20 i (i ≤ 2), 320.
6. **Bars inside those blocks** (row glyphs, bullets, fact bars): `scaleX` 0.001 to 1;
   100 + 10 i (i ≤ 10), 240.
7. **Chart furniture** (legends, totals, the bracket, labels, axes, captions, readouts): opacity 0
   to 1; 260, 160.
8. **Square field** (Pools): opacity 0 to 1 and `scale(0.6)` to 1, largest first;
   40 + 200 √(rank / n), 200.
9. **Curve areas** (Pool): `clip-path: inset(0 50% 0 50%)` to `inset(0)`, opening from the mid
   line; 60, 320.
10. **Curve points** (Pool): opacity 0 to 1; 220, 160.

Measured with the prototype's `tools/timing.cjs`: the latest end is 440 ms on Home and Pools, 420
on Pool and 450 on Scorecard.

**Reduced motion:** the band ground, the title parts, `[data-in]`, `[data-over]` and each chart
fade in over 200 ms, linear, with no delay. Nothing moves.

**Frames** (prototype `shots/final-motion-home-load-*.png`): at 0 ms the band ground is 60 %
drawn and nothing else shows; at 80 ms the title parts are fading in and the bars have started;
at 160 to 240 ms the total row and the rows are mostly grown and no value label shows yet; by
400 ms everything is in place. No frame ever shows a number that is not the final one.

### 4.2 Navigation

- **Route change by pointer.** The old `<main>` fades 1 to 0 over 100 ms while the new one fades
  0 to 1 over 180 ms, both `--ease-out` from the same instant. Keyboard and reduced motion:
  instant. Purpose: spatial consistency.
- **Back and Forward.** Nothing animates; the scroll position is restored from `history.state`.
- **Nav indicator.** The 4 px bar moves with `translateX(Δx) scaleX(w0 / w1)` to none over 200 ms,
  `--ease-in-out`. Keyboard and reduced motion: instant.
- **Header hairline.** The `::after` fades in or out past 8 px of scroll over 200 ms, `ease`.

The cross-fade is React's `<ViewTransition>` on `<main>`, as in v3 (`::view-transition-old(main)`
100 ms, `::view-transition-new(main)` 180 ms); the chrome and the root never animate. Because both
start at the same instant, the old view is nearly gone by 80 ms while the new one is mostly in:
there is never a blank frame and never two views near full opacity (prototype
`shots/final-motion-route-pools-*.png`). A route change never replays the first view.

### 4.3 Charts

- **Butterfly lens.** Other rows, the total row and the bracket dim to 0.32 over 150 ms, `ease`;
  the readout and the totals swap instantly. Keyboard focus: instant. Reduced: the same.
- **Field lens.** The square gains its Blue and Yellow double ring and the readout swaps,
  instantly. Arrow keys step through the rated pools.
- **Curve crosshair.** It snaps to the nearest measured point and follows the pointer 1:1 with no
  easing; the point grows from 12 to 16 px and the tooltip shows. Arrow keys step.
- **Range and window switch** (Pool history, Scorecard window) and the **whole-pool context
  toggle:** the domains morph on the tween clock over 280 ms, `--ease-in-out`, with ticks
  cross-fading. Keyboard: instant. Reduced: instant, then a 150 ms opacity settle.
- **Number change** (a filter, the price swap): only the changed characters fade in and settle
  from `translateY(0.32em)` over 200 ms, `--ease-out`. Keyboard: instant swap. Reduced: 200 ms
  opacity.
- **Live values and refetch:** nothing moves (M8); after 150 ms the old content dims to 0.6. A
  refetch never regrows bars and never falls back to a skeleton (M10).

### 4.4 Controls and layers

- **Press:** `scale(0.97)`, blocks `scale(0.985)`, 120 ms `--ease-out`, landing on pointer-down.
  Reduced: none.
- **Hover** (fine pointers): colour, background and underline thickness over 160 ms, `ease`. A
  single-destination block fades in its `--sh-2` layer over 160 ms; nothing moves. Row hover
  layers: 0 ms in, 150 ms out.
- **Segmented thumb:** `clip-path` on the thumb layer over 200 ms, `--ease-in-out`. Keyboard and
  reduced: instant.
- **Disclosure:** the panel fades in and settles from `translateY(-8px)` over 200 ms,
  `--ease-out`; the chevron turns 180° over 200 ms. Keyboard: instant. Reduced: opacity only.
- **Popover:** opacity, `translateY(4px)` and `scale(0.97)` to none from the trigger, 180 ms in and
  100 ms out, `--ease-out`. Keyboard: opens instantly. Reduced: opacity.
- **Tooltip:** after 600 ms of hover, opacity and `scale(0.97)` from the trigger side over 140 ms;
  it closes in 0 ms. Focus opens it instantly. Reduced: opacity.
- **Phone sheet:** `translateY(100%)` to 0 over 500 ms `--ease-drawer`, the scrim over 300 ms;
  closing 260 ms `--ease-out`. A drag follows the finger; past 25 % of the height or faster than
  0.4 px/ms it dismisses, otherwise it snaps back over 300 ms. Keyboard: instant. Reduced: a
  200 ms fade.
- **Copy:** the label becomes "Copied" with a check for 2 s, announced with `aria-live`; instant.
- **Theme switch:** nothing; transitions are suppressed for two frames.

---

## 5. Components

### 5.1 App shell

**Skip link.** First focusable element; 44 px high, `--text-1` fill, `--canvas` label, 700, radius
12; visible at top 8, left 8 only on `:focus-visible` (A4).

**Banner.** One `<header>` landmark holds the data line, when there is one, and the app bar. With
the line it sticks at −32 px, so the line scrolls away and the bar stays. `index.html` carries a
markup copy of the banner inside `#root` (no script, no style attribute, hidden from assistive
technology): the static build's empty data line, the wordmark, the tabs (Scorecards among them
unless a static build's bundle has no mandate, as the app lists them before its list of mandates
answers) and the freshness slot's "Connecting…", so the first paint shows the header and nothing
moves when the app replaces it.

**Demo line, snapshot line** (the v3 slot above the app bar, now 32 px, at the top of the banner):
- `--surface-2` in light; in dark the canvas with a 1 px Gray 80 rule under it.
- 13 px `--text-2`, one line, `nowrap`, ellipsis as a last resort.
- **Live snapshot** (a static build of a `live` bundle): "Data from 12 Nov 2026, 20:05 UTC, 5 h ago.
  Updated several times a day." with the trigger "About this snapshot" (13 px, 650, `--text-1`,
  underlined). The last sentence is the publisher's schedule, said only when the bundle states it
  (`updates`, from `depthwatch export --updates several-times-a-day`, which the Refresh site
  workflow passes); a copy exported once states none. The age is counted on the reader's clock,
  read again every minute and when the tab is shown again, so it never goes stale on screen. Below
  840 px, "About" and a shorter sentence, so it never truncates mid-sentence: "Data from 20:05 UTC,
  5 h ago, updated several times a day"; below 440 px "Data from 5 h ago, updated several times a
  day"; below 375 px "Data from 20:05 UTC, 5 h ago". Without a schedule: "Data from 12 Nov, 20:05
  UTC, 5 h ago", without the day below 360 px. The popover holds the exporter's note and the block.
  While a static build loads its bundle, an empty line of the same height holds the slot.
- **Demo or mock data:** "Demo data: a synthetic week of Base" and "About the demo", unchanged.

**App bar, from 840 px:** 64 px, sticky at 0, `--canvas`; its `::after` hairline (`--line`) fades
in past 8 px of scroll.
- **Wordmark:** the 22 px mark and "Depthwatch" at 21 px, 850, −0.045em, 10 px apart; the link is
  at least 44 px high.
- **Nav:** Pools, Stocks, Gaps, Scorecards, Methodology; 15 px, 650, 28 px apart, `--text-2`, the
  current item `--text-1` with `aria-current="page"` (Stocks on `/stocks` and `/stocks/:token`,
  docs/design/stocks-api.md §3); the five fit beside the wordmark and the freshness button at
  840 px. Scorecards is listed only once a mandate is registered (its page stays at `/mm`, and
  Methodology's scorecards section links to it). The indicator is a 4 px bar (radius 2 2 0 0) in
  `--nav-ind` under the current item, placed with `left` and `width` and moved by transform only.
- **Freshness** (pushed right): an 8 px **circle** and the eyebrow "Block 53,069,244"; a 40 px
  button, radius 12, `--surface-2` on hover, whose accessible name starts with those words ("Block
  53,069,244, updated 2 min ago"); its popover gives the snapshot time, block and "492 of 580"
  pools tracked. The circle is Green for live data from a server. A published snapshot is not
  live: its circle is `--text-2` grey and, when its publisher states a schedule, Tan once the data
  is more than 8 hours old on the reader's clock; its name and popover give the data's time and age
  ("Block 56,617,832, data from 12 Nov 2026, 20:05 UTC, 5 h ago"), and the popover the schedule.
  Offline: a Red triangle and "Offline". Never a square.

**Phone chrome, below 840 px** (100 px):
- **Bar, 56 px:** the wordmark and the freshness dot as a 44 × 44 button at the right gutter.
- **Tab strip, 44 px,** under the bar, same landmark name: Pools, Stocks, Gaps, Scorecards (once a
  mandate exists), Methodology at 15 px, 700; the current tab `--text-1` with a 4 px `--nav-ind`
  bar inset 10 px. Below about 425 px (`26.56em`: the five full labels need 392.6 px plus two
  16 px gutters) Scorecards and Methodology read "Scores" and "Method", each link's `aria-label`
  holding both its full and its short words ("Scorecards (Scores)", "Methodology"), so no tab is
  cut and each can be called by the words it shows. Where the tabs still do not fit, the strip scrolls
  sideways, fades whichever edge has tabs past it, and keeps the current tab in view. The bar and
  strip never hide. No theme toggle (PH2).
- **No fixed bottom bar in a browser tab** (PH3). In an installed app only
  (`@media (display-mode: standalone)`), the strip is replaced by a bottom dock: Gray 100, radius
  20 20 0 0, one 48 px tab per nav item, the current one Base Blue with white text, padded by the bottom safe
  area, sticky at the bottom of the app column. At 320 px a tab is 57.6 px wide, so Scorecards and
  Methodology read "Scores" and "Method", with the same accessible names as on the strip.

**Main:** `id="main"`, `tabindex="-1"`, the view-transition boundary; focus moves here after
keyboard navigation. The app column is a flex column of at least `100dvh`, so a short page rests
its footer on the viewport bottom.

**Footer:** the ink block in both themes (Gray 100, a Gray 80 top rule in dark); 64 px above it
(48 on phones), 48 px padding (32 on phones) plus the bottom safe area.
- Desktop (from 1024): one row of three columns: the wordmark at 28 px; the promise plus the data
  source ("Data: a Base mainnet snapshot.") in `--on-ink-2`, then, on the pages about a stock, the
  stock line as a paragraph of its own; the links Methodology, API and GitHub (15 px, 650, 44 px targets,
  underline on hover). API goes to the README's API section on GitHub from a static copy, which
  runs no API, and to the server's `/AGENTS.md` otherwise. A keyboard focus ring on the ink is
  Yellow (`--focus-band`, 13.5:1) in both themes, as on the band.
- The promise follows the trade switch the page loaded with (`tradeSwitchOn`), and a page already
  open keeps it until it reloads. While the switch is off: "Open source and read-only. No token, no
  custody. It indexes Uniswap, Aerodrome and Aero pools on Base mainnet. Independent: not
  affiliated with or endorsed by Base." While it is on for a venue whose route is not on hold:
  "Open source. No token, no custody, no fee added to swaps. It indexes Uniswap, Aerodrome and Aero
  pools on Base mainnet. The swap panel is on and non-custodial: a swap goes from your own wallet
  straight to the pool’s router. Independent: not affiliated with or endorsed by Base."
- The stock line (`FOOTER_STOCKS`, docs/design/stocks-api.md §3) follows the promise on the Stocks
  pages (`/stocks`, `/stocks/:token`) and on a stock's token page, whatever the switch: "Coinbase tokenized stocks are only
  available to persons in eligible jurisdictions outside of the U.S. Depthwatch measures their
  markets; it does not offer, route or recommend trades in them." A stock pool's page carries the
  same line in its own section.
- Phones: one column in that order, links left-aligned 20 px apart.

### 5.2 The band and blocks

**Band** (`.band`): full bleed, flat `--band`, text `--on-band`; eyebrows, meta lines, captions
and secondary text `--on-band-2`; focus rings `--focus-band` (Yellow). The ground is its own
layer (`.band-ground`, absolutely positioned behind the content) so the first view can clip it
without moving content. The bottom padding is the overlap plus 24, so the first block can stack
over it.

**Block** (`.blk`): `--surface`, radius 18, padding 24 (32 from 600), `--edge`, `--sh-1`, `--hl`.
- **Over the band** (`.blk--over`): `margin-top: calc(-1 * var(--overlap))` on its section and
  `--sh-band` instead of `--sh-1`.
- **Ink block** (`.ink`): see §3.7; its secondary text is `--on-ink-2`, its rules Gray 80.
- **Panel** (`.blk--panel`): `--surface-2`, no shadow (dark: the canvas plus `--edge`). For
  reference lists: About this pool, Mandate, Compare DEXes.
- **Single destination** (`.is-dest`): the whole block is one link. Hover fades in the `--sh-2`
  layer and thickens its link underline to 3 px; press scales 0.985. A block with several links is
  never a destination and never reacts to hover.
- **Never** a block in a block, and never one block per section (§5.7).

**Grid:** 12 columns from 840 px, 24 px gaps (16 below); blocks span 3, 4, 5, 7 or 12 columns.

### 5.3 Buttons and links

| Variant        | Size                 | Fill and text                         | Hover            |
| -------------- | -------------------- | ------------------------------------- | ---------------- |
| Primary        | 48 high, radius 12   | Blue fill, white 15 px / 750          | —                |
| On band        | 48 high, radius 12   | White fill, Blue text, navy shadow    | Gray 10 fill     |
| Ghost          | 48 or 40 high        | 1.5 px `--ctl-edge` inset, `--text-1` | `--text-1` inset |
| On band, ghost | 40 high              | 1.5 px white 55 % inset, white        | White inset      |
| Icon           | 36 × 36, 44 on touch | 1.5 px `--ctl-edge` inset             | `--text-1` inset |
- Padding 0 22 (0 14 on 40 px buttons); 15 px / 750 labels; icon buttons radius 10. At most one
  filled button per view (P11). Press scales 0.97.
- **Strong link** (`.ulink`): 700, 2 px underline at 5 px offset in `currentColor`, 3 px on hover.
  Used for "How it's measured", "See all gaps", "See an example scorecard".
- **Prose link** (`.plink`): 1 px `--line-2` underline at 3 px, `currentColor` on hover.
- **Back link:** a 16 px chevron and the list name, 14 px, 700, `--text-2` → `--text-1`, 32 px
  high (44 on touch), 4 px left of the edge.
- **Disclosure trigger:** the label at 15 px, 700, and a 16 px chevron 8 px after it; at least 40 px
  high (44 on touch); `aria-expanded`; labels "Show data" / "Hide data", "Details", "Show code",
  "Compare DEXes", "About this pool", "Mandate details". On the band it is white.

### 5.4 Segmented control, DEX filter, search

**Segmented control:** track `--surface-2` (white 14 % on the band), radius 12, 3 px padding;
items 34 px high (44 on touch), 0 14 padding, radius 9, 14 px, 700, `--text-2`; the selected item
`--text-1` on `--canvas` with `--edge` and a small Blue-tinted shadow (on the band: Blue text on
white). `role="radiogroup"`, roving `tabindex`, arrow keys select instantly. Uses: Rating (All
pools, Rated only), the history window (24 h, 7 d), the scorecard window (24 h, 7 d, 30 d).

**DEX filter** (Pools band, from 840 px): a `radiogroup` of five 44 px rows (All DEXes, Uniswap
v3, Aerodrome Slipstream, Uniswap v4, Aerodrome v2), each the DEX name (15 px, 750) and its share
of all depth within 2 % on the right (83 %, 13 %, 3 %, "under 1 %"; "100 %" for All), over a 6 px
bar drawn **to that share on one scale** (white on a white 22 % track). The selected row is a white
block with Blue text and a Blue bar. Arrow Up and Down move the selection. Each row's
`aria-label` reads "Uniswap v3, 83 % of the depth within 2 %". Phones get the same options in the
Filter sheet.

**Search:** white field on the band, 48 px, radius 12, 16 px text, a 16 px icon at left 16,
placeholder "Search by symbol or address" in Gray 60, navy shadow; focus ring 3 px Yellow. A
visually hidden label "Search pools".

### 5.5 Grades, status and chips

- **Shapes:** circle (A–B, within KPI, ok), square with radius 1 (C), triangle (D–F, breached).
- **Grade glyph:** 26 px high, at least 40 wide, 0 8 padding, radius 6, 14 px / 800; the status
  fill (Green, Tan, Red), an 8 px shape and the letter in Gray 100. Large (facts): 36 high, 56 wide,
  20 px, radius 9, 10 px shape. `role="img"`, `aria-label="Grade A"`.
- **"Not rated" chip:** the glyph's counterpart for a scored pool with no grade: 26 px, radius 6,
  `--surface-2` (Gray 80 on the ink block), 13 px / 650 `--text-1`, the words instead of a letter.
  It is a `button` that opens the reason ("Too thin to rate: neither side holds $5K within
  2 %.", "Too thin on one side…", "No USD price…") on hover, focus or tap. It sits above any row
  link (z-index) and has a 44 × 44 touch area.
- **Status chip** (the scorecard's own page only): 32 px, 0 12, radius 9, 15 px / 800, Red fill
  (Green for within KPI), the shape and the word in Gray 100.
- **Status word** (lists): the shape in the status colour and the word in ink, 14 px / 700.
- **Breach triangle** beside a fact value: 14 px, Red, `role="img"`, `aria-label="Below KPI"`.

### 5.6 Facts

Value first, label second; the label carries its comparison (P4).
- **Value:** `--t-kpi`, 820, −0.05em, `nowrap`; a grade glyph or breach triangle 14 px after it.
- **Label:** 15 px, `--text-2` (`--on-ink-2` on the ink block), ≤ 30ch, 8 px under the value,
  `text-wrap: pretty`; a number that ends a label is joined to the word before it by a no-break
  space ("scores 61", "within 2 %"), so no word or number sits alone on its last line.
- **Facts row** (Pool, Scorecard): one ink block over the band; 4 or 3 equal columns from 1024 px
  with 1 px Gray 80 dividers, 2 columns from 600 px, 2 × 2 at 28 px values below 600 px (Pool), one
  column with bullets (Scorecard). A gap callout may follow under a Gray 80 rule: "Liquidity gap:
  one of 48 pools that trade 3× their depth or more a day. See all gaps".
- **Home fact blocks** (desktop): three single-destination blocks over the band, 5 / 4 / 3 columns:
  - **24 h volume**, the ink block: "$191M", "traded in 24 h, 3.8× the depth within 2 % of the
    price", and two 12 px white bars **on one track width**: Traded (100 %) and Depth ±2 % (26 %).
  - **Health:** "61" with the C glyph, "median health of the 50 rated pools", and a 12 px bar of
    the grade distribution sized by count (A 7, B 18, C 9, D 13, F 3), each segment in its status
    colour with "A 7" under it.
  - **Biggest gap:** "205×", "WETH / USDT, Slipstream: volume over depth", and two nested squares
    to scale: a 72 px outline (a day's volume) with a solid 5 px square in its corner (depth ±2 %);
    the solid side is 72 / √205.
- **Home facts on phones:** one ink block; the three facts become rows (eyebrow, 36 px value,
  label) split by Gray 80 rules; the micro-visuals are dropped.
- **Bullet graph** (scorecard facts): 10 px, up to 240 px, Gray 80 track, `--on-ink` fill, a 3 px
  target tick 20 px high. Depth bullets scale to 1.25× the larger of KPI and value.

### 5.7 The sections sheet

Pool and Scorecard put their sections in **one** plane-1 block (`.secs`, no padding); each section
is a row, and rows are split by a 1 px `--line` rule. No block per section and no card grid.
- **Row from 1024 px:** grid `minmax(0, 4fr) minmax(0, 8fr)`, 48 px gap, padding 32 × 48. The
  head holds the lowercase h2 (`--t-h2`), one finding sentence (`--t-body`, `--text-2`, ≤ 40ch)
  and the "Details" trigger 4 px under it; the body holds the visual, and the Details panel opens
  under the visual, 24 px below.
- **Below 1024 px:** one column, padding 24 (32 from 600); the head is a grid with the h2 at left
  and the trigger at the right of the same line, the sentence under both at full width.
- At most one disclosure level (P5). The reference list (About this pool, Mandate) is a panel
  after the sheet: a two-column definition list from 840 px, a disclosure on phones.

### 5.8 Tables and phone rows

**Pools table** (inside a plane-2 block over the band, `padding: 0`, `overflow: clip`):
- **Caption row,** 16 × 32 padding, `--line` rule: "50 rated pools" (`aria-live`) left and "All
  pools updated 25 Oct 2026, 11:30 UTC" right, 12 px `--text-2`.
- **Header:** 44 px, sticky under the chrome, `--surface`, 2 px `--text-1` rule; cells 13 px, 650,
  `--text-2`, sentence case, right-aligned but Pool; sortable headers are buttons with a 12 px
  arrow on the sorted one (`aria-sort`). A column that shows "—" adds one glossary term "—" after
  its label, whose tooltip gives the reasons its rows have (ST5).
- **Rows:** 64 px, 1 px `--line`, 15 px / 600, tabular, 32 px side padding; one stretched link per
  row, named by the pair and its second line ("WETH / USDC, Uniswap v3, 0.05 %"); hover
  `--surface-2`, 0 ms in, 150 ms out.
- **Columns:** Pool (the pair at 17 px / 750, then "Uniswap v3, 0.05 %" at 13 px `--text-2`;
  pools of one table that would read the same add their tick spacing, ", tick spacing 50", or when
  that is shared too their short address, ", 0x1234…abcd");
  Health (score and glyph, or Not rated); Depth ±2 % (an 84 × 20 row glyph, then the value in a
  fixed 6.5ch, right-aligned, so every row's spine shares one x);
  Spread at $10K ("Can't absorb $10K" when infeasible; "—" when unknown); 24 h volume; optional TVL,
  Gap score and Price through Columns (`?cols=`).
- **Row glyph:** a 2 px `--text-1` spine at the centre, the sell bar (Cerulean) left and the buy
  bar (Yellow, 1 px ink edge in light) right, 12 px high, on the table's shared scale.
- **Unrated pools:** after the rated ones, under a 52 px `--surface-2` group row "Unrated pools",
  opened by "Show 442 unrated pools" (pages of 50, `?unrated=N`), as in v3.

**Phone rows** (below 840 px): a head row ("Pool" and the sort metric, 13 px, 2 px rule, with the
grades' info button centred over the grade column when the list has a basis note), then rows
of at least 64 px: the pool cell, the sort metric's value (15 px / 750, right) and the glyph or
chip. **25 rated rows per page** on phones, then "Show all 50 rated pools" (`?rows=all`); 50 on
desktop (TB8).

**Dense tables** (Show data, Details, Compare DEXes): 15 px; header 13 px / 650 `--text-2` over a
2 px `--text-1` rule; cells padded 11 px, 1 px `--line` rules; a total row at 800 over a 2 px
rule. On the band they sit in a white (dark: black) block, as wide as the table from 840 px. They
scroll in a gutter-bleeding wrapper on phones.

**Row lists** (gaps, previews, breaches): rows at least 64 px with a 1 px `--line` rule, a 2 px
`--text-1` rule above the first; the pool cell, a sentence ("Trades 205× its depth a day", 15 px /
650), the turnover glyph (a 72 × 10 bar in `--text-1` on `--surface-2` with a 2 px tick at 24 %,
3× turnover) and the score at 800. A `::before` hover layer bleeds 12 px.

### 5.9 Charts

Every chart is hand-written SVG or HTML (no chart library), has hard geometry (radius 0 on bars),
a takeaway sentence, `role="img"` or `role="group"` with a full `aria-label`, and a "Show data" or
"Details" table (CH9). Axis text is 12 px sans, tabular, `--text-2` or `--on-band-2`; there are no
gridlines and no tick marks (CH1). A value label never takes a side colour.

#### 5.9.1 Depth butterfly (Home focal; Token)

On the band, under the hero. One shared linear scale, `max = max(total sell, total buy)`.
- **Head** (centred): the readout line (13 px / 650, `--on-band-2`): "All of Base, every tracked
  pool" at rest. Under it two columns meeting at the spine: "■ Sell side, price down" over
  **$20.7M** right-aligned, and "■ Buy side, price up" over **$29.2M** left-aligned (13 px meta
  with 10 px swatches; totals at `--t-figure`). On phones the legends drop ", price down/up".
- **Spine:** a 2 px `--on-band` line through the head, rows and axis.
- **Total row "All of Base"** (52 px; 44 on phones, with 44 / 36 px bars): each side is the 7
  deepest pools as solid segments in row order out from the spine, each separated by a 2 px band
  gap, then one hatched segment for every other pool (white or Yellow 3 px stripes, 7 px pitch).
  Label "All of Base" (17 px / 800) left of the sell side on desktop.
- **Bracket:** under the total row, a 2 px `--on-band` bracket spans the deepest pool's two
  segments, with the sentence "59 % of it sits in one pool: WETH / USDC, Uniswap v3 0.3 %" (15 px /
  750) centred on a band-coloured patch. On phones the sentence wraps to two lines at 250 px.
- **Rows:** at most 8, the 7 deepest plus the largest meaningful gap. Desktop rows are 28 px with
  12 px bars; the label (pair at 15 px / 750, then "Uniswap v3 0.3 %" at 13 px `--on-band-2`) sits
  12 px left of the row's sell bar. Phone rows put the label on its own centred line over 10 px
  bars. A non-zero side is at least 2 px. The gap row gets a 24 px dotted leader and "Gap" (13 px /
  700), linking to `/gaps` (desktop only).
- **Axis:** 12 px below; nice ticks mirror around the spine ($10M, $20M) and "0" at the spine.
- **Foot row:** "Show data" at left; at right "One scale for every pool." and the hatch swatch with
  "The other 485 pools." (12 px `--on-band-2`).
- **Lens:** a fine pointer over a row, keyboard focus on its link, or the first tap on touch. The
  readout becomes "**WETH / cbBTC, Uniswap v3 0.3 %**: 5 % of Base" (plus "Open pool" on touch),
  the totals swap to the row's two sides, the row gets a white 10 % background and everything else
  dims to 0.32 (bars by opacity; the bracket sentence and centred row labels by colour, so their
  band patch keeps hiding the spine). The second tap opens the pool; arrow Up and Down move focus
  between row links. Leaving the plot, or blurring the figure, restores the totals. The readout
  line holds every row's readout hidden in its own grid cell ("Open pool" included where a touch
  input exists), so it always has the height of the tallest and the first tap moves no row.
- **Show data:** a white block with the table Pool, Sell ±2 %, Buy ±2 %, Share of Base, then
  "Every other pool" (484 pools) and the "All of Base" total row.
- **Empty:** the spine only, with "No pools are scored yet." as the answer; never fake bars.

#### 5.9.2 Square field (Pools band)

"Where Base's depth sits": one rounded square per pool with depth, its **area** proportional to
the pool's depth within 2 % (side = √(depth × k)), packed largest first from the bottom left with
a skyline packer and a 3 px gutter; `k` is the largest scale at which the packing fits the field.
- **Size:** the right 7 / 12 of the band from 1024 px, 420 px high; 260 px high and full width on
  phones. It repacks on resize.
- **Honesty:** pools whose square would be smaller than 5 px (4 on phones) are merged into one
  hatched square whose area is their total (274 pools under $4.45K, $83K together, at 1440);
  pools with no depth (144) are not drawn. The caption says both, in numbers.
- **Marks:** rated pools are solid white; unrated pools are white at 20 % with a 1.5 px white 85 %
  inset edge; the merged square is hatched white. Radius 16 % of the side, at least 1 px. Squares
  of 110 px and more carry the pair (14–24 px / 820, Blue); from 150 px the DEX and fee; the
  largest also "59 %" at 15 % of its side and "of Base's depth within 2 %".
- **Readout** (`aria-live="polite"`, under the field; every square's readout sits hidden in its
  grid cell, so it holds the height of the tallest, at least 48 px, and a read never moves the
  caption or the table): at rest "Point at, focus or tap a square to read its pool."; then
  "**USDC / cbBTC, Uniswap v3 0.05 %** $1.43M within 2 %: $772K sell, $660K buy 3 % of Base [A]"
  (plus "Open pool" on touch). On phones it sets three lines: the pair, the depth line, then the
  share and grade.
- **Interaction:** pointer hover reads; a click opens the pool; on touch the first tap reads and
  the second opens; the field is one `tabindex="0"` group: arrow keys step through the rated pools
  by depth, Enter opens, Escape clears. The hovered square gets `0 0 0 2px Blue, 0 0 0 4px Yellow`.
- **Filter link:** while a DEX, a search or "Rated only" is set, squares outside the table's
  current list (and the merged square) dim to 0.22, so the field and the table always agree.
- **Caption** (13 px `--on-band-2`, ≤ 70ch): "Where Base's depth sits: one square per pool, its area
  true to the pool's depth within 2 % of the price. Solid: rated A to F. Outlined: not rated.
  [hatch] The 274 smallest, each under $4.45K, are drawn as one square of their total, $83K. The
  144 pools that hold no depth within 2 % are not drawn."

#### 5.9.3 Mirrored depth curve (Pool focal, CH3)

On the band. 340 px tall (240 on phones); plot top 72 (16 on phones), bottom 28.
- **x:** log-spaced at −5, −2, −1, 0, +1, +2, +5 %:
  `x = cx ± log(1 + |p|) / log(6) × (W / 2 − 10)`.
- **y:** linear from 0; `step = niceStep(1.06 × max, 5)`, `yMax = ceil(1.06 × max / step) × step`;
  tick labels every two steps ($500K, $1M) at 8 px right of the spine, 12 px `--on-band-2`.
- **Marks:** the ±2 % band as white 8 % from the plot top to the baseline; the **sell area** flat
  white and the **buy area** flat Yellow, each joining mid (0) and the measured points only, closed
  to the baseline at ±5 %; nothing is drawn past ±5 %. A 2 px white mid line. Points: 12 px squares,
  radius 3, filled Blue with a 3 px ring in the side colour (they read as rings, never as a Blue
  square).
- **Direct labels** (exactly two, desktop): above the plot at the ±2 % x positions, "Sell −2 %"
  (13 px / 650) over **$386K** (`--t-figure`, white), with a dashed 1 px leader down to the point.
  They never touch the area. On phones they move to a readout row above the chart ("Sell −2 %
  $386K" left, "Buy +2 % $425K" right, 32 px values) and the chart has no direct labels.
- **Exhausted side:** a dashed segment and "Liquidity runs out"; a missing level: a sentence instead
  of a shape (as v3). **No liquidity:** when every measured level holds $0, the sentence "No
  liquidity sits within 5 % of the price at this snapshot." replaces the plot (no ticks, labels or
  points; the foot row stays), and the answer reads "No liquidity sits within 2 % of the price."
- **Crosshair:** the pointer snaps to the nearest measured point by x; a dashed 1.5 px white line
  runs from the plot top to the point, the point grows to 16 px and the tooltip (§5.10) shows "+2 %,
  buy side", Depth $425K, Spent 425,100 USDC, Price Reached. Arrow keys step through the six points
  (the SVG is `tabindex="0"`), Escape and blur clear. The tooltip flips left near the right edge.
  On touch the first tap reads the nearest point and keeps it until a tap elsewhere or a second tap
  on it, as on the butterfly and the field.
- **Foot row:** "Show data" (a ±1 / 2 / 5 % table of USD and token amounts per side and "Reached",
  then "Buying meets 10 % more depth than selling at ±2 %.") and the caption "Straight lines join
  measured points only. Nothing is drawn past ±5 %."

#### 5.9.4 KPI chart (Scorecard focal)

On the band: the latest sample's depth per side against the mandate's per-side KPI.
- A two-column figure meeting at a 2 px white spine; each half a bar from the spine on one scale,
  `S = 1.25 × max(KPI, sell, buy)`; bars `clamp(112px, 11vw, 152px)` tall, sell white, buy Yellow.
- Inside each bar, 20 px from the spine (10 on phones), Gray 100 text: "Sell side, below KPI"
  (13 px / 700; "Sell" on phones) over **$386K** (24–52 px / 820). When a KPI line inside the bar
  would meet the words, they start 16 px past the line; with no room there they read under the
  bars. The words carry no patch: the KPI line runs unbroken through the bar.
- The KPI on each side: a 3 px dashed white line 24 px beyond the bars, labelled "KPI $400K" (13 px
  / 700, white) above it.
- A side below its KPI shows the **shortfall** from the bar's end to the KPI line as Red hatching
  (4 px stripes, 9 px pitch) with a 2 px Red inset edge.
- Caption row: the Red hatch swatch with "Shortfall against the KPI: $14.2K" and "Per-side depth is
  stored for the latest snapshot only." when that is so.
- `role="img"`: "Sell side $386K, below the $400K KPI by $14.2K. Buy side $425K, within it."

#### 5.9.5 Market-maker chart over time (Scorecard, first section)

The v3 mirrored time chart (buy above a zero line, sell below, one symmetric scale) moves from the
focal to the first section of the sheet, "depth over time", when per-side history exists. v4
changes only its paint:
- lines 2 px, buy Yellow (1 px ink edge in light) above, sell Cerulean below;
- the KPI as 1 px dashed `--text-2` lines labelled "KPI $400K";
- breach episodes as Red bands at `--breach-op`, full plot height;
- the 24 h / 7 d / 30 d segmented control and the scrub caption as in v3.

Until per-side history exists (the snapshot stores per-side depth for the latest sample only), the
section shows whole-pool depth as a history multiple (§5.9.6) and says so.

#### 5.9.6 History small multiples (Pool "over time"; Scorecard)

- One multiple per metric (Depth ±2 %, both sides; Spread at $10K), 132 px tall (120 on phones),
  drawn at the container's width so 12 px text stays 12 px.
- The head: the label (13 px meta) and the latest value (20 px / 800) right-aligned.
- A 3 px `currentColor` line with rounded joins through 10 px square points (canvas fill, 2.5 px
  ring), no fill (CH5).
- **The y range is cropped and labelled:** a 2 px `--line-2` bracket at the right spans the data,
  with the maximum and the minimum at its ends in the head's format ("$812K", "$781K"). A 4 % range
  never reads as a swing without its numbers. A series whose two ends print the same (a spread that
  moves 0.00004 bps) draws level at mid-height with one label and no bracket.
- **The x axis spans the snapshots' own time range,** with ticks every 15 minutes up to 2 h, then
  the v3 landmarks (6 h, weekdays, dates). The caption states the span: "Times in UTC. The axis
  spans the 51 minutes the snapshots cover; each range is labelled at its right. Both windows hold
  the same 5 snapshots." A window with fewer than 2 snapshots shows a sentence.

#### 5.9.7 Uptime strip (Scorecard)

One cell per sample in the window, 40 px high, radius 6, 6 px gaps: within KPI `--text-1`,
breached Red, not checkable hollow (2 px `--line-2` inset). Times under the cells (12 px). A
legend: "Breached", "Within KPI", "Not checkable: no per-side depth stored". The takeaway
carries the counts from core:
"1 of 5 snapshots can be checked per side, and it breached: uptime 0 %."

#### 5.9.8 Compact glyphs

- **Cost to trade** (Pool): rows of 40 px per notional ($1K, $10K, $100K, $1M; snapshots stored
  before the $1M point have three rows), 12 px labels in a 56 px column; a 2 px `--line` track; a
  4 px `--text-1` stem from 0 to the value; a 16 px square dot
  (radius 4); the value 16 px after it (16 px / 800). Not fillable: a hollow ring at 0 and "Can't
  absorb $100K". Axis: 0 and three nice ticks in bps.
- **Health bar** (Pool): four segments sized 35 : 25 : 20 : 20 with 4 px gaps, 16 px tall,
  `--surface-2` tracks filled `--text-1` to component ÷ weight; names (14 px / 700) and "33.7 of 35"
  (12 px) under each; the weakest name underlined. Below 600 px the names sit in a 2 × 2 grid.
- **Share bar** (Pool, who provides it): 32 px; the active range in `--text-1` (at least 6 px), the
  rest hatched `--line-2`; a legend under it.
- **Turnover glyph** (gaps): §5.8.
- **Bullet graph:** §5.6.

### 5.10 Floating layers

- **Popover:** `position: fixed`, `min(380px, 100vw − 32px)`, padding 18, radius 16, `--surface`,
  `--edge` and `--sh-3`, 14 px / 1.5; 8 px under its trigger (above it when there is no room
  below), right-aligned to it, 16 px inside the viewport, scrolling when taller than that;
  `role="dialog"` with a label; closes on outside pointer-down or Escape, which returns focus.
- **Tooltip and chart tooltip:** max 300 px, padding 10 / 12, radius 12, Gray 100 with white text
  (Gray 80 in dark), 13 px / 1.4, `--sh-3`, `pointer-events: none`. Glossary and "Not rated"
  tooltips sit 10 px above their trigger (below when there is no room); the chart tooltip sits
  18 px beside its point, rows of label and tabular value.
- **Phone sheet:** fixed to the bottom, radius 24 at the top, `--surface`, padding 8 / gutter /
  20 + safe area, `max-height: calc(100dvh - env(safe-area-inset-top) - 24px)`,
  `overscroll-behavior: contain`, scrim `--scrim`. A 44 × 5 grip in a 28 px drag area; title 24 px /
  800; options at least 52 px with a `--line` rule and a check on the selected one; a full-width
  primary "Done". Focus is trapped and returned; body scroll locks; a route change closes it.
  Sheets: Filter pools (two groups under 13 px / 650 headings: DEX, with All DEXes and each DEX
  with its share; Rating, with All pools and Rated only) and Sort pools (Health, Depth ±2 %, Spread
  at $10K, 24 h volume, TVL, Gap score; Top LP share only when a listed pool has it).

### 5.11 Embed badge

The preview is the API's badge, unaltered (`apps/api/src/badge.ts`): Verdana 11 px, height 20,
radius 3, label `#2a3140` "depthwatch", message `#b8232f` "breached · 7d 0%" (ok `#1c7a4c`, no
data and inactive `#5c6573`). The uptime in it is core's 7-day uptime, so it always matches the
page. Then "Copy HTML" and "Copy Markdown" (ghost, small) and "Cached for 5 minutes" (12 px); "Show
code" opens two code blocks (`--surface-2`, radius 10, 13 px mono).

### 5.12 States

- **Loading** (ST1, M10): nothing under 300 ms; then skeletons at final sizes, static (no
  shimmer). On the band they are white 14 % blocks (the butterfly rows, the curve area, the
  field); off the band `--surface-2`. The title block renders at once; CLS is 0. A skeleton stays at
  least 400 ms.
- **Refetch:** keep the content, dim it to 0.6 after 150 ms, and show a 2 px indeterminate bar at
  the section top (white on the band). Never a skeleton once content exists. The freshness poll
  (once a minute) refetches the page's data this way when it finds a newer snapshot, so an open
  page never shows a newer "Updated … ago" over older numbers; the mock and the static build
  never change and skip it.
- **Empty** (ST2): one sentence and at most one action. The Scorecards list with no mandates: "No
  market-maker mandates are registered in this snapshot." on the title, the band's lead "A
  scorecard checks the depth a market maker promised against what is onchain at every snapshot.",
  followed on a server by "Mandates are added with `depthwatch mm register` or `POST /api/mm`." (a
  static copy has neither), and one destination block over the band.
- **Error in a section** (ST3) and **Offline** (ST7): as v3; the freshness slot shows the Red
  triangle and "Offline", never a full-page takeover when data exists. A page that fails to draw
  is replaced inside <main> only, by "This page could not be drawn." and "Reload, or go to Pools.";
  the chrome stays and the next navigation draws again. A failure outside the routes replaces the
  app with the same sentence and a Reload button.
- **Not found** (ST4): eyebrow "Not found", a lowercase display title ("pool not found"), one
  sentence, the id in mono, then "Browse pools" (ghost) and "See liquidity gaps" (strong link).
- **Partial** (ST5): unknown is "—" with a reason tooltip; infeasible spreads are "Can't absorb
  $10K"; "Not rated" with its reason; "Liquidity runs out" on the curve. The "—" is not a tab
  stop: its reason is its accessible name ("Unknown: …") and its hover tooltip, and a table column
  gives the reasons once more in its header, where focus or a tap opens them.
- **Example data** (the illustrative scorecard): the eyebrow says "Example scorecard" once, and one
  sentence under the title says the mandate is illustrative and the depths are the pool's real,
  measured depths at that snapshot.

### 5.13 Icons and the mark

- **Icons** (K9): one stroke set, 16 px, 1.5–1.75 px stroke, round caps and joins,
  `currentColor`, `aria-hidden`: chevrons, back, swap, search, check, copy, external, arrows, filter
  (three lines), columns, info (an "i" in a circle, for a column's note). No icon in a tinted square.
- **The mark:** §2.3. 22 px in the app bar, 28 px in the footer.
- **Favicon** (`apps/web/public/favicon.svg`): the same mark, spine `#0a0b0d` (`#eef0f3` in dark),
  sell `#3c8aff`, buy `#ffd12f` with a 0.5 px `#0a0b0d` stroke in light.

---

## 6. Screens

Measured on the prototype with the real snapshot (492 pools; 8 butterfly rows; 50 rated pools; 48
meaningful gaps; 5 snapshots of history). Positions are page y in CSS px. There is no horizontal
overflow at 320, 360, 375, 390, 412, 430, 1280 or 1440 px, and no console error.

### 6.1 Budgets

These replace P9 for v4. The v3 budgets assumed a 6-pool demo and a 56 px display; the brief asks
for oversized type, and the real snapshot fills the butterfly's 8 rows and a 50-row table. Against
the winning study, v4 cut Home by 19 % on desktop and 25 % on phones, Pool by 28 % and Pools by
38 % on phones.

| Page            | Desktop now | Desktop budget | Phone now | Phone budget |
| --------------- | ----------: | -------------: | --------: | -----------: |
| Home            |       1,921 |        ≤ 2,000 |     2,768 |      ≤ 2,900 |
| Pools           |       4,571 |        ≤ 4,700 |     3,178 |      ≤ 3,300 |
| Pool            |       2,917 |        ≤ 3,000 |     3,082 |      ≤ 3,200 |
| Scorecard       |       2,412 |        ≤ 2,500 |     2,796 |      ≤ 2,900 |
| Gaps            |       2,180 |        ≤ 2,300 |     2,941 |      ≤ 3,000 |
| Scorecards list |         904 |        ≤ 1,000 |     1,066 |      ≤ 1,200 |
| Token           |           — |        ≤ 2,600 |         — |      ≤ 3,200 |
| Not found       |         900 |     1 viewport |       844 |   1 viewport |
- **Lists scale with their rows,** so their budgets are also stated without them: Pools ≤ 1,400
  plus 64 per row on desktop (50 rows) and ≤ 1,600 plus 64 per row on phones (25 rows); Gaps ≤ 750
  plus 72 per row on desktop and ≤ 950 plus 102 per row on phones (20 rows).
- **First-viewport data numbers** (P2): Home 5 on both (the figure, the pool count in its
  sentence, the two side totals, "59 %"); Pool 3 (the price, and the two answer numbers that the
  curve labels repeat); Scorecard 4 on desktop (KPI, the two sides, the shortfall) and 2 on phones;
  Pools 3 in the answer plus the field's one direct label ("59 %"); the DEX filter's shares are
  exempt (§1.8).
- **Focal element** (P1): at 25 % zoom the band, and inside it the named focal, is the heaviest
  region of every screen.

### 6.2 Home (`/`)

**Focal:** the depth butterfly of Base on the band. **Answer:** "$49.8M sits within 2 % of the
price across 327 pools on Base." (the pools the figure sums, `depthKnownPools`: scored, with a
known depth, no stale quote and its stock's transfers not paused, so it never reads as every pool
on Base). The butterfly's totals leave those pools out the same way and still draw their rows. **First facts:** 24 h volume, median health, biggest gap.

| Element (1440)      |        y | Height | Element (390)        |          y |
| ------------------- | -------: | -----: | -------------------- | ---------: |
| Snapshot line, bar  |    0, 32 | 32, 64 | Snapshot, bar, strip |      0, 32 |
| Band                |       96 |    947 | Band                 |        132 |
| Eyebrow             |      120 |     16 | Eyebrow (one item)   |        156 |
| Figure and sentence |      152 |    157 | Figure, sentence     |   188, 277 |
| Lead and actions    |      333 |     81 | Lead, then actions   |   345, 429 |
| Butterfly head      |      446 |    101 | Butterfly head       |        501 |
| Total row, bracket  | 547, 599 | 52, 44 | Total row, bracket   |   586, 630 |
| Pool rows           |      643 |    224 | Pool rows            |        694 |
| Axis, foot row      | 879, 907 | 16, 40 | Axis, foot row       | 1066, 1094 |
| Fact blocks         |      971 |    282 | Facts (ink block)    |       1182 |
| Previews            |     1309 |      — | Previews             |       1604 |
| Footer              |     1758 |    164 | Footer               |       2502 |
- **Hero** (from 840 px): a grid `auto minmax(0, 1fr)`; row 1 holds the figure (`--t-mega`, white)
  and the sentence (`--t-say`, ≤ 15ch) aligned to the figure's baseline; row 2 spans both columns:
  the lead (19 px, ≤ 44ch) at left and the actions at right, "Browse pools" (white button on the
  band) and "How it's measured" (strong link). Both sit inside the 1440×900 first viewport.
  The figure and the sentence are one `h1`.
- **Phone:** figure (96 px), sentence (28 px), lead (16 px), actions, then the butterfly; its top
  half is inside the first viewport (501 + 657 / 2 = 830 < 844, PH6).
- **Facts:** §5.6. **Previews** (P7, at most 3 rows each): "where liquidity is thin" (7 columns:
  "48 pools trade 3× their depth or more every day.", three gap rows, "See all gaps" and the caption
  "Gap score 0–100; the tick marks 3× turnover") and, once a mandate is registered, "market makers
  on the record" (5 columns: the mandates' rows and "See all scorecards"). With no mandate the gaps
  preview takes the whole row.
- **States:** as ia-v3 §4.1; with no scored pools the butterfly shows its spine only.

### 6.3 Pools (`/pools`)

**Focal:** the square field on the band; the table is the content (TB2 exception). **Answer:**
"492 pools on 4 DEXes hold $49.9M within 2 % of the price." (filter-aware, as v3).

| Element (1440)                   |        y | Height | Element (390)           |        y |
| -------------------------------- | -------: | -----: | ----------------------- | -------: |
| Band                             |       96 |    801 | Band                    |      132 |
| Title "pools" (left, 5 / 12)     |      156 |     97 | Title                   |      212 |
| Answer                           |      277 |    113 | Answer                  |      282 |
| DEX filter                       |      414 |    239 | (in the Filter sheet)   |        — |
| Field (right, 7 / 12, 737 × 420) |      156 |    420 | Field (358 × 260)       |      379 |
| Readout, caption                 | 588, 648 | 48, 73 | Readout, caption        | 651, 711 |
| Controls row                     |      753 |     48 | Search, Filter and Sort |      826 |
| Table sheet over the band        |      825 |  3,391 | Rows sheet              |      966 |
| Footer                           |     4408 |    164 | Footer                  |     2912 |
- **Controls row** (desktop): search (up to 380 px), the Rating segmented control, a spacer and the
  on-band ghost "Columns" button (its popover holds the optional columns).
- **Phone controls:** the search at full width, then two equal 44 px buttons on the band, "All
  DEXes" (with the filter icon) and "Sort: health" (with a down-arrow icon), opening the sheets
  (§5.10).
- **URL state:** `sort`, `dir`, `dex`, `rated`, `q`, `unrated`, `cols` and `rows`, replaced, not
  pushed.

### 6.4 Pool (`/pools/:id`)

**Focal:** the mirrored depth curve on the band. **Answer:** "It takes $425K of buying to lift
WETH 2 % and $386K of selling to push it down." **First facts:** health, spread at $10K, 24 h
volume, TVL. **Title:** the pair, each symbol a link, with a no-break space before the slash, so
a title that wraps breaks after it ("VIRTUAL /" over "cbETH") and no line starts with "/".

| Element (1440)                         |    y | Height | Element (390)                |        y |
| -------------------------------------- | ---: | -----: | ---------------------------- | -------: |
| Back link "Pools"                      |  128 |     32 | Back link                    |      164 |
| Eyebrow "UNISWAP V3   0.05 % FEE"      |  168 |     16 | Eyebrow                      |      204 |
| Title (left, 7 / 12)                   |  196 |     97 | Title                        |      232 |
| Price line with the swap button        |  305 |     36 | Price line                   |      290 |
| Answer (right, 5 / 12, bottom-aligned) |  228 |    113 | Answer                       |      342 |
| Band                                   |  365 |    554 | Band                         |      439 |
| Legend row with the eyebrow heading    |  397 |     18 | Legend row, then readout     | 471, 504 |
| Curve                                  |  430 |    340 | Curve                        |      569 |
| Foot row (Show data, caption)          |  782 |     40 | Foot row                     |      821 |
| Facts, the ink block over the band     |  846 |    229 | Facts, 2 × 2                 |      925 |
| Sections sheet                         | 1100 |  1,223 | Sections sheet               |     1261 |
| About this pool (panel)                | 2347 |    343 | "About this pool" disclosure |     2680 |
| Footer                                 | 2754 |    164 | Footer                       |     2816 |
- **Facts** (with their comparisons): "85 [A]" health, "the median rated pool scores 61"; "14.8
  bps" spread at $10K, a round trip; "$11.4M" traded in 24 h, 14× the depth within 2 %; "$8.39M"
  TVL, of which 10 % sits within 2 %. Then the gap callout when turnover ≥ 3×.
- **Sections,** in order: health (weighted bar; Details: components to one decimal and "How health
  is scored"), cost to trade (lollipop; Details: spread, buy and sell averages), who provides it
  (share bar; Details: band, range HHI, active share, owners), over time (the 24 h / 7 d control
  and two multiples), mandates on this pool (when any). Then About this pool.

### 6.5 Gaps (`/gaps`)

**Focal:** the ranked gap list in a block over the band. **Answer:** "48 pools trade 3× their depth
or more every day." Title "gaps" at 156 (192 on phones); the band (277; 327) holds the lead "A gap
is a pool that trades far more each day than the liquidity near its price. Pools with at least
$10K of 24 h volume."; the list block starts at 414 (463) with 20 rows of 72 px (102 on phones),
then "Show all 48" (`?rows=all`) and "20 more pools trade less than 3× their depth." Each row's
sentence has a tooltip with the volume and the depth ("$3.03M traded through $14.8K of depth").
The table view of ia-v3 §4.4 keeps the dense table style.

### 6.6 Scorecards list (`/mm`)

**Answer:** "No market-maker mandates are registered in this snapshot." (the count sentence of
ia-v3 §4.5 when there are mandates). The band holds the lead, on a server with `depthwatch mm
register` and `POST /api/mm`; one destination block over the band explains what a scorecard
checks. With no mandate the nav and Home leave Scorecards out, and Methodology links here. With mandates, the list is a row-list
block over the band, with the status word, the mandate name, the market maker and pool, and the
7 d uptime with its bullet; the Filter and List / Table controls sit on the band.

### 6.7 Scorecard (`/mm/:id`)

**Focal:** the KPI chart on the band. **Answer:** "The sell side is below its $400K KPI: $386K sits
within 2 % of the price." **First facts:** sell side now, buy side now, checkable snapshots within
KPI in 7 d.

| Element (1440)                 |        y |   Height | Element (390)      |        y |
| ------------------------------ | -------: | -------: | ------------------ | -------: |
| Back link "Scorecards"         |      128 |       32 | Back link          |      164 |
| Title                          |      196 |      118 | Title (two lines)  |      252 |
| Status chip "Breached"         |      330 |       32 | Status chip        |      330 |
| Example sentence               |      374 |       55 | Example sentence   |      374 |
| Answer (right, bottom-aligned) |      315 |      113 | Answer             |      445 |
| Band; KPI chart                | 452, 566 | 413, 152 | Band; KPI chart    | 541, 655 |
| Caption row                    |      750 |       20 | Caption row        |      799 |
| Facts (ink block)              |      793 |      186 | Facts, one column  |      868 |
| Sections sheet                 |     1004 |      857 | Sections sheet     |     1261 |
| Mandate (panel)                |     1885 |      299 | Mandate disclosure |     2394 |
| Footer                         |     2248 |      164 | Footer             |     2530 |
- **Eyebrow:** "EXAMPLE SCORECARD WETH / USDC, UNISWAP V3 0.05 %" for the example; for a real
  mandate, "SCORECARD" and the market maker on the pool.
- **Facts:** "$386K ▲" sell side now, below the $400K KPI (bullet); "$425K" buy side now, within the
  $400K KPI (bullet); "0 of 1 ▲" checkable snapshots within KPI in 7 d: uptime 0 %, target 95 %
  (bullet to the 95 % tick). The count leads, so a one-sample uptime never reads as a rate alone.
- **Sections,** in order: depth over time (§5.9.5, or whole-pool depth until per-side history
  exists), uptime (strip; Details: the three windows with snapshots, checkable, within KPI and
  uptime), breaches (episode rows; "Alerts fire after 3 in a row."), worst moments (when there is
  history), spread (when the mandate has a spread KPI), embed badge. Then Mandate.

### 6.8 Token (`/tokens/:address`)

Not prototyped; built from the parts above. A title section (back link "Pools", eyebrow "TOKEN",
title "WETH" with its name, and the ia-v3 §4.7 answer, which for the snapshot reads "$43.2M sits
within 2 % of the price across WETH's 140 scored pools."), then the band with the butterfly scoped
to the token (total row "All of WETH" on its own scale, bracket on its deepest pool), the facts as
an ink block over the band, the token's pools table as a plane-1 sheet after the facts, and About
this token as a panel.

### 6.9 Methodology (`/methodology`)

Title "method" and the provenance answer ("Every number comes from public pool state, using each
contract's own swap math, and can be reproduced from the repository."). The band holds one lead;
the first three metric blocks stack over it (4 columns each) and the rest follow on the canvas:
depth, spread, concentration, persistence, health, gaps, scorecards, each a lowercase h2 and one
sentence. The prose sections of ia-v3 §4.8 follow at `--t-body` and ≤ 66ch, with "Show formula"
disclosures and figures built from the components above. Exempt from length budgets.

### 6.10 Not found

§5.12, on the title section's grid, with the footer resting on the viewport bottom. No band.

---

## 7. File map for `apps/web`

### 7.1 What does not change

- **No new dependency** and no chart library (DESIGN.md "May import" is unchanged). Metrics stay in
  `packages/core`; the web formats and draws.
- **No API or data change.** Everything the new visuals read is already in the DTOs: per-side depth
  (`depth2UpUsd`, `depth2DownUsd`) for the butterfly, the field and the row glyph;
  `stats.byDex[].depth2Usd` and `stats.totals.depth2Usd` for the DEX shares; the pool detail's
  `depthUsd` and `depth` levels for the curve; the scorecard summary's `uptime.d7` (core
  `computeUptime`) for the uptime fact and the badge.
- **The static build and the live-snapshot mode keep working.** `src/api/*`, `staticBoot.tsx`,
  `liveBoot.tsx`, `routeData.ts`, `vite.config.ts` and `plugins/` are untouched: the static build
  still uses a relative base, the `HashRouter` and `data/bundle.json`; a `live` bundle still shows
  the snapshot line (§5.1) and absolute times; the font URLs stay `/fonts/…`, which Vite rewrites
  under the relative base. `lib/format.ts` (N1–N11), `lib/scale.ts`, `lib/sort.ts`, `lib/badge.ts`
  and `components/routeIntent.ts` keep their behaviour.

### 7.2 Styles (`src/styles/`)

| File           | Change                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| `tokens.css`   | Rewritten to §3.1 and §3.4–§3.8; field-of-light and tint tokens removed   |
| `fonts.css`    | Unchanged but for its comment                                             |
| `base.css`     | Body 450; type classes; `.eyebrow`, `.meta`, `.cap`; band and ink focus   |
| `shell.css`    | Snapshot line, app bar, circle dot, phone tab strip, standalone dock      |
| `footer.css`   | The ink footer                                                            |
| `controls.css` | Button variants, segmented on the band, search, DEX filter, back link     |
| `content.css`  | Band, blocks (over, ink, panel, destination), grid, facts, sections sheet |
| `tables.css`   | Table sheet, 64 px rows, row glyph colours, phone rows and their paging   |
| `layers.css`   | Popover radius 16, tooltip, sheet radius 24 with "Done", scrim            |
| `states.css`   | Skeletons on the band (white 14 %), refetch bar, not found                |
| `embed.css`    | Badge preview and code blocks                                             |
| `motion.css`   | Press scales, chevron, the 100 / 180 view transition, reduced motion      |

### 7.3 Shell (`src/components/Layout.tsx`, `src/components/shell/`)

- `Layout.tsx`: keeps the `<ViewTransition>` cross-fade (100 / 180 ms, pointer only); the app
  column becomes a flex column of at least `100dvh`; it calls the first-view gate (§7.6) once per
  session for the landing route; renders `Dock` in standalone mode.
- `AppBar.tsx`: 64 / 56 px; the hairline appears past 8 px of scroll (was 36).
- `Nav.tsx`: the one `<nav>`, a 4 px indicator in `--nav-ind`; below 840 px the 44 px tab strip.
- `Freshness.tsx`: the circle (Green live, grey or Tan for a snapshot) and the eyebrow "Block
  53,069,244"; never a square.
- `Footer.tsx`: the ink block layout and copy of §5.1.
- `Logo.tsx`: the mark's v4 colours (§2.3).
- `SnapshotLine.tsx`, `DemoLine.tsx`, `SkipLink.tsx`: styles only; the narrow snapshot sentence
  already exists.
- **New** `Dock.tsx`: the bottom navigation for `display-mode: standalone` only.

### 7.4 Primitives (`src/components/ui/`)

- **New** `Band.tsx` (the band and its ground layer, eyebrow slot) and `Block.tsx` (variants
  plain, over, ink, panel; `dest` makes the whole block one link).
- **New** `DexFilter.tsx`: the radiogroup of §5.4, fed by `stats.byDex`.
- `Button.tsx`: variants primary, on band, ghost, on-band ghost, icon.
- `Fact.tsx`: value, glyph or triangle, comparison label; a facts-row container for the ink block.
- `Section.tsx`: becomes the sections sheet and its rows (§5.7), the Details trigger in the head
  and the panel under the visual.
- `SegmentedControl.tsx`: the band variant. `Sheet.tsx`: radius 24, primary "Done".
- `GradeGlyph.tsx`, `StatusChip.tsx`, `StatusWord.tsx`: kit fills, ink letters and words, shapes.
- `PoolsTable.tsx`, `Table.tsx`, `TableControls.tsx`, `TableScroll.tsx`, `PoolCells.tsx`: the
  table sheet, the 2 px header rule, sans meta lines, 25-row phone pages.
- `Popover.tsx`, `Glossary.tsx`, `Disclosure.tsx`, `CopyButton.tsx`, `EmbedBadge.tsx`,
  `BackLink.tsx`, `States.tsx`: styles; keyboard toggles stay instant.
- `Icon.tsx`: adds the three-line filter icon.

### 7.5 Charts (`src/components/charts/`)

- `DepthButterfly.tsx`, `butterflyModel.ts`: the band layout, head totals, per-pool segments of the
  total row, the hatched remainder, the concentration bracket (share from the model), the
  dim-and-readout lens, tap to dock and Up / Down keys. The field-of-light code is deleted.
- **New** `SquareField.tsx` and `squareFieldModel.ts`: the skyline packer, the scale search, the
  merge of sub-minimum squares and the exclusion of zero-depth pools, as pure functions.
- `DepthCurve.tsx`, `curveModel.ts`: flat areas, ringed square points, labels above the plot, the
  phone readout row; the halftone and lattice are deleted.
- **New** `KpiChart.tsx`: the latest sample per side against the KPI, with the shortfall hatch.
- `MarketMakerChart.tsx`, `mmModel.ts`: v4 paint; it renders in the first scorecard section.
- `SmallMultiples.tsx`: the labelled range bracket and an x domain fitted to the samples.
- `UptimeStrip.tsx`, `SpreadLollipop.tsx`, `HealthBar.tsx`, `ShareBar.tsx`, `TurnoverGlyph.tsx`,
  `BulletGraph.tsx`, `RowDepthGlyph.tsx`, `ChartTooltip.tsx`, `ChartTables.tsx`: sizes and colours
  of §5.9.
- `butterfly.css`, `butterflyStates.css`, `charts.css`, `series.css`, `glyphs.css`: rewritten to
  the v4 tokens. `useMorph.ts`: the v4 ease-in-out.

### 7.6 Library and pages

- `lib/motion.ts`: `easeInOut = bezier(0.65, 0, 0.35, 1)`; the tween clock is unchanged.
- **New** `lib/firstView.ts`: the session gate (`dw-first-view`, `?replay=1`) and
  `playFirstView(root)`, which starts the steps of §4.1 as Web Animations from one instant (so a
  test can pause and seek them) and plays the reduced-motion fade instead when asked.
- `pages/home/useIntro.ts`: deleted, replaced by `lib/firstView.ts`.
- **Home:** `Home.tsx`, `home/HomeHero.tsx` (the hero grid, actions in the hero, the butterfly on
  the band), `home/HomeFacts.tsx` (three blocks; one ink block on phones), `home/Previews.tsx`,
  `home/home.css`.
- **Pools:** `Pools.tsx`, `lists/PoolsControls.tsx` (the band, DEX filter, field, phone buttons),
  `lists/usePoolRows.ts` and `lists/poolsState.ts` (the `rows` parameter and 25-row phone pages),
  `lists/lists.css`.
- **Pool:** `PoolDetail.tsx`, `pool/PoolTitle.tsx`, `pool/PoolFacts.tsx` (the comparisons of §6.4),
  `pool/PoolSections.tsx` (the sheet), `pool/OverTime.tsx` (ranges, fitted axis, honest caption),
  `pool/PoolAbout.tsx` (panel, phone disclosure), `pool/pool.css`.
- **Scorecard:** `Scorecard.tsx`, `mm/ScorecardTitle.tsx` (eyebrow, chip, example sentence),
  `mm/ScorecardFocal.tsx` (the KPI chart on the band), `mm/ScorecardSections.tsx` and
  `mm/ScorecardMore.tsx` (the sheet, the time chart first), `mm/mm.css`.
- **Others:** `Scorecards.tsx` and `mm/MandateRows.tsx` (the empty state and the example block),
  `Gaps.tsx` and `lists/GapRows.tsx` (the block over the band, 20 rows, "Show all 48"),
  `Token.tsx` and `token/*`, `Methodology.tsx` and `docs/*`, `NotFound.tsx`.
- `index.html`: `theme-color` `#ffffff` (light) and `#0a0b0d` (dark). `public/favicon.svg`: §5.13.

### 7.7 Tests and documents that change with the build

- `src/styles.test.ts`: the new token blocks and names; the contrast pairs of §2.4; uppercase
  allowed only in the `.eyebrow` rule; the three v4 easings; `theme-color` values; the motion
  block rule (nothing moves outside `no-preference`) unchanged; the font and touch-target rules
  unchanged.
- Page and component tests that assert v3 classes or copy (field of light, lens morph, mono-less
  meta lines, "Example" twice) move to the v4 copy given here.
- **New tests:**
  - `squareFieldModel`: every drawn square's area over its depth is the same `k` within 1 %, the
    merged square's area is the sum of its pools, zero-depth pools are excluded and counted;
  - `butterflyModel`: the segments sum to the side totals, the bracket's share is the top pool over
    all depth;
  - `KpiChart`: the shortfall is KPI minus value, drawn only below the KPI;
  - `firstView`: the gate, every step ending by 450 ms, opacity only under reduced motion;
  - phone paging of the Pools rows.
- **Documents** updated in the same change: `principles.md` and `ia-v3.md` (the amendments of
  §1.8), `DESIGN.md` (its pointer to `visual-v3.md` §7), and the status line of `visual-v3.md`
  ("superseded by `visual-v4.md` where they differ").

---

## 8. Acceptance criteria

A build matches this spec when all of these hold.
1. **Gate.** `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm build:static` pass.
   The static site renders every route from a `live` bundle with the wide snapshot line at 1440 and
   the narrow one at 390.
2. **Brand.**
   - No Base mark (The Square, the Basemark, the logotype) in the DOM, the CSS or `public/`.
   - No element narrower than 48 px with a non-zero radius has a Base Blue background.
   - Every colour in the CSS, hex or `rgb()`, is a kit value of §2.2 (alpha allowed), or one of
     the badge's four API colours.
   - The footer says "Built on Base" in plain text; no page says "partner" or "partnership".
3. **Contrast.** Every pair of §2.4 meets its ratio in both themes; every text pair is at least
   4.5:1; every mark and control at least 3:1 against its surface.
4. **Fonts.** `document.fonts.check('16px "Hanken Grotesk"')` and the Plex Mono check are true
   before screenshots; the network log shows no font request to another host; every text node
   resolves to Hanken Grotesk or IBM Plex Mono.
5. **Type.** `text-transform: uppercase` appears only in the `.eyebrow` rule; nothing renders under
   12 px; mono appears only on eyebrows, addresses, ids, block numbers and code.
6. **Layout.** `scrollWidth === clientWidth` at 320, 360, 375, 390, 412, 430, 1280 and 1440, and at
   200 % zoom on 1280. Page heights meet §6.1 at 1440 and 390 in both themes.
7. **First viewport.** At 1440×900, "Browse pools" and the butterfly's head and total row are
   visible on Home. At 390×844, the top half of each focal element is inside the viewport (PH6).
   First-viewport data numbers meet §6.1.
8. **Motion.**
   - First view: on every route with `?replay=1`, the latest `endTime` of
     `document.getAnimations()` is at most 450 ms, and the properties are only `opacity`,
     `transform` and `clip-path`.
   - Pointer route change: only `<main>` animates, 100 ms out and 180 ms in from one instant; at
     80 ms the old view's opacity is at most 0.1 and the new one's at least 0.6.
   - Keyboard route change, keyboard disclosure, sheet and popover: no animation other than colour.
   - Reduced motion: no `transform` or `clip-path` animation on any route.
   - No animation has more than one iteration, and the text of a number never changes during an
     animation (frames at 0, 80, 160, 240 and 400 ms show final numbers only).
9. **Data integrity.**
   - Field squares: area over depth within 1 % of one constant for every square of 20 px or more;
     the merged square equals the sum of its pools; the caption's counts match the data.
   - Butterfly: the segments of each side sum to its total; every row and the total row share one
     scale; the bracket's percentage equals the top pool over all depth.
   - DEX filter bars are each DEX's share of all depth; the traded and depth bars share one track.
   - Sparklines label their own minimum and maximum; the x axis spans the samples.
   - Uptime and the badge text come from core's summary and the API's `renderBadge`.
10. **Keyboard and touch.** Every interactive element shows a visible focus ring (Yellow on the
    band); the field and the curve step with arrow keys; the butterfly's rows move with Up and
    Down; the sheet traps focus and Escape closes every layer. Every target is at least 44 × 44 on
    a coarse pointer; the first tap on a butterfly row or a field square reads it and the second
    opens it.
11. **Phone chrome.** No fixed or sticky element sits at the bottom of the viewport unless
    `display-mode: standalone` matches (PH3).
12. **Dark theme.** No block, panel or footer fills with Gray 10 or white in dark; the ink block is
    Gray 100 with a Gray 80 edge; text off the band is Gray 10, never pure white.

---

## 9. Sources

- The brief and the comparison of the three studies on visual impact, usability and data integrity
  (not in the repository).
- Base's brand kit, `github.com/base/brand-kit` at `eba9e73`: `guides/brand-guide.pdf` and
  `guides/editorial-style-guide.md`, through a summary of exact values made from them.
  base.org/brand and docs.base.org were not reachable; they are not quoted here and should be
  checked before release (AGENTS.md, "Where to look things up").
- In this repository: [`principles.md`](principles.md), [`ia-v3.md`](ia-v3.md),
  [`visual-v3.md`](visual-v3.md), `apps/api/src/badge.ts` (badge text and colours) and
  `packages/core/src/mm/scorecard.ts` (`computeUptime`).
- WebKit bug 281071 (fixed bottom bars in Safari tabs), as cited by PH3 in `principles.md`.
- The prototype and its tools (not in the repository): every measurement in §4 and §6 was
  taken with `tools/measure.cjs`, `tools/timing.cjs`, `tools/check.cjs`, `tools/rm.cjs`,
  `tools/shoot.cjs`, `tools/states.cjs` and `tools/strip.cjs` against the 25 Oct 2026 snapshot.
