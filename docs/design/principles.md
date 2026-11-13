# Depthwatch v3 design bar

Status: **binding for v3**. Every screen, component and pull request is checked against this list. If a rule cannot be met, change it here first and give the reason. Never break one silently.

This file distils the four research notes into rules that can be checked: [`research/product-ui.md`](research/product-ui.md), [`research/data-ui.md`](research/data-ui.md), [`research/motion.md`](research/motion.md) and [`research/type-a11y.md`](research/type-a11y.md). Those notes hold the full citations and say how each source was read. Rules here link their primary source; the list at the end gives every URL. The v2 failures behind these rules are in [`critique-v2.md`](critique-v2.md). The screen-by-screen structure is in [`ia-v3.md`](ia-v3.md).

**Amended rules.** The v3 visual spec changes the wording of some rules ([visual-v3.md §2](visual-v3.md#2-rules-this-spec-adds-to-principlesmd-and-ia-v3md)). That wording is carried in at the rules it changes, marked "amended", and wins over the older wording beside it. The v4 visual spec amends further rules ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)); its wording is carried in at those rules, marked "v4 amended", and wins over everything beside it.

**How to read this file**
- Rule IDs (`P3`, `T7`, …) are stable. Reviews cite them.
- **Test** says how to check a rule.
- Sizes are CSS px at 100 % zoom.
- The **first viewport** is 1440×900 on desktop and 390×844 on a phone, in both light and dark themes.
- A **data number** is a numeral the reader takes as a measurement or a count: money, %, bps, ×, scores, pool counts.
  - These do not count: axis ticks, the block number in the header, a pool's fee tier, and parameters that name a measurement, such as "±2 %", "$10K", "24 h" or "7 d".
  - A value repeated on the same screen, such as a chart label that repeats the answer sentence, counts once.

---

## 0. The idea

Depthwatch draws one thing: **the two sides of a market**. Every entity page leads with its depth signature, and the entities are Base as a whole, a pool, a token and a market maker. The signature shows the sell side in blue to the left of a centre line and the buy side in orange to the right, on a shared scale. Above it sits one plain sentence that states the answer with its number.

Everything else stays quiet:
- monochrome chrome;
- one sans family, set large and light;
- generous space;
- no boxes.

Colour belongs to data. The product earns trust by being calm, exact and open about what it does not know. The logo already holds this idea: its mark is depth bars in the two side colours.

The idea has three consequences, each of which can be checked:
1. A first viewport that shows neither a depth signature nor a ranked answer is wrong.
2. A chromatic colour outside a data mark, a status glyph, the focus ring or the logo is wrong. (v4 amended, [visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends): Base Blue may also be the band, the primary button and the nav indicator.)
3. A number that does not answer "compared to what?" moves behind disclosure or goes.

---

## 1. Hierarchy and information budget

- **P1. One focal element per screen.** It is the largest, highest-contrast and most saturated region of the first viewport. Everything around it is quieter ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI): de-emphasise the things around it). _Test:_ scale the screenshot to 25 %. Exactly one region reads heaviest, and the PR names it. It must be the focal element listed for that screen in `ia-v3.md`.
- **P2. Data-number budget for the first viewport.** These are maximums. _Test:_ count the data numbers in the 1440×900 and 390×844 screenshots.

  | Screen                       | Max data numbers                                                                                                                                                       |
  | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Home                         | 7                                                                                                                                                                      |
  | Pool                         | 8                                                                                                                                                                      |
  | Scorecard                    | 7 (two sides plus their targets)                                                                                                                                       |
  | Token                        | 6                                                                                                                                                                      |
  | Pools, Gaps, Scorecards list | 3 in the page header, plus at most 2 per visible row on desktop and 1 on a phone (Pools' default table is the stated exception: its 4 numeric columns are the content) |
  | Methodology                  | 0 outside formulas                                                                                                                                                     |

  Sources: [Few, 13 mistakes](https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/); [Cowan, about 4 chunks](https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): on Pools, the DEX filter's five shares are labels, exempt like the table's columns.
- **P3. The first viewport states its answer in one sentence that carries the key number.** The sentence has at most 20 words, for example "It takes $6.1M of buying to lift WETH 2 %". It is not a slogan ([Uniswap ChartHeader](https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartHeader.tsx)). _Test:_ the H1, or the answer directly under it, contains the screen's key number. Methodology is exempt; its answer is a sentence about provenance.
- **P4. Every visible number answers "compared to what?"** It needs a target, a band, a peer, a share, a scale or a previous value. Otherwise it moves to disclosure ([Few #2](https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/); [Tufte](https://kraft.blog/2006/02/envisioning-information-multiples-and-colors/)). _Test:_ for each number in the first viewport, name its comparison.
- **P5. Use at most two levels of disclosure.** A page holds sections, and a section may hold a "Details" disclosure. Never nest a disclosure inside a disclosure, and never put tabs inside an expander ([NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): more than two levels "typically have low usability"). _Test:_ the DOM has no `[aria-expanded]` control inside a collapsed region.
- **P6. Choose the disclosure mechanism by content type:**
  - **Section "Details" disclosure.** Use it for the numbers behind a visual (L2).
  - **Segmented control.** Use it only for parallel views of the same thing, such as a time window, chart side or list/table view. It is not for unrelated content ([NN/g tabs vs accordions](https://www.nngroup.com/videos/tabs-vs-accordions/)).
  - **Hover or focus tooltip.** It may only repeat or enlarge what is already reachable another way. It is never the only route to a value.
  - **"Show all N".** Use it for lists longer than their preview.
  - **Information people compare across sections stays expanded.** A long page is better than splitting what people need together ([NN/g accordions](https://www.nngroup.com/articles/accordions-on-desktop/)).
- **P7. Never show the same dataset twice on one page.** A list never appears in full on two primary screens. Home previews are an exception: they hold at most 3 rows and link out. _Test:_ no API list response is rendered in two places on one route.
- **P8. One explanation per page header, none per stat.**
  - The page lead is one sentence of at most 25 words.
  - Section takeaways are one sentence of at most 15 words.
  - There is no caption under a stat and no hint text in a section header.
  - Definitions live in glossary tooltips (`D8`) and Methodology.
  - _Test:_ count `<p>` elements in the first viewport. There are at most 2.
- **P9. Page length budgets.** All disclosures are closed when measuring. Methodology is exempt. _Test:_ `document.documentElement.scrollHeight`.

  | Page           | Phone (390 px) | Desktop (1440 px) |
  | -------------- | -------------- | ----------------- |
  | Home           | ≤ 2,100        | ≤ 1,500           |
  | Pool           | ≤ 2,600        | —                 |
  | Scorecard      | ≤ 2,600        | —                 |
  | Pools (6 rows) | ≤ 1,600        | —                 |
  | Gaps           | ≤ 1,600        | —                 |
  | Token          | ≤ 1,600        | —                 |

  The v2 phone heights were 3,564 (Home), 2,668 (Pool) and 4,273 (Scorecard).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the budgets of [visual-v4.md §6.1](visual-v4.md#61-budgets) replace this table: Home ≤ 2,000 on desktop and ≤ 2,900 on phones, Pool ≤ 3,000 / 3,200, Scorecard ≤ 2,500 / 2,900, Gaps ≤ 2,300 / 3,000, Scorecards list ≤ 1,000 / 1,200, Token ≤ 2,600 / 3,200, Not found one viewport; Pools ≤ 1,400 plus 64 per row on desktop (50 rows) and ≤ 1,600 plus 64 per row on phones (25 rows).
- **P10. Order by importance.** The answer sits top left, then the focal element, then facts, then sections in the order `ia-v3.md` gives, then "About". Group with space before using boxes ([Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout)).
- **P11. Per-view element budget:**
  - at most 1 filled button;
  - at most 3 text colours (`text-1`, `text-2`, `text-3`);
  - at most 2 weights in running text;
  - at most 1 chip per table row.

  Source: [product-ui §1](research/product-ui.md). _Test:_ visual audit of each screenshot.

## 2. Typography

- **T1. Families.**
  - **Hanken Grotesk** (variable, 100–900) sets every word and number.
  - **IBM Plex Mono** 400/500 sets only on-chain identifiers (addresses, pool ids, tx hashes, block numbers in "About" lists) and code (formulas, embed snippets).
  - No third family.
  - Inter, Geist, Space Grotesk, DM Sans, Plus Jakarta Sans and Manrope never appear as the visible face.

  Source: [type-a11y §1.5](research/type-a11y.md). _Test:_ the computed `font-family` of every text node resolves to one of the two families, and mono appears only on `.addr`, `.hash`, `.block` and `code`.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): IBM Plex Mono also sets eyebrows: the one line of metadata above a title, a band or a fact, uppercase, 12 px, 500, +0.09em. Nowhere else.
- **T2. Self-host the fonts.**
  - Build one woff2 subset per face from the `google/fonts` TTFs with the `pyftsubset` command in type-a11y §1.6. The subset keeps `tnum case frac ss01–ss04` and the glyphs `± × − ≥ ≈`.
  - Hanken has no `↑` and no thin, figure or narrow no-break spaces ([type-a11y §1.2](research/type-a11y.md), measured with fontTools). Every arrow (delta, sort, the ⇄ price swap, chevrons) is therefore an SVG icon, never a text glyph.
  - Never use `fonts.googleapis.com`, because the Google Fonts latin subset strips features and omits `→` and `≥`.
  - Preload the sans file only.
  - Use `font-display: swap` with a metric-matched fallback `@font-face` (`size-adjust`) ([Chrome font fallback](https://developer.chrome.com/blog/framework-tools-font-fallback/)).
  - _Test:_ the network log has no Google Fonts request, and `document.fonts.check('16px "Hanken Grotesk"')` is true before any screenshot.
- **T3. Fallback stacks:**
  - `--sans: "Hanken Grotesk", "Hanken Fallback", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
  - `--mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

  With fonts blocked, nothing may overflow and hierarchy must still read, because size and colour carry it, not weight (`T14`).
- **T4. Type scale tokens.** These are the only font sizes. Author them in rem.

  | Token         | Size (px)                                                | Line-height | Weight                        | Tracking | Use                                                                                                                |
  | ------------- | -------------------------------------------------------- | ----------- | ----------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
  | `--t-caption` | 12                                                       | 16          | 500                           | +0.01em  | Chart ticks, table header on phone, chips, timestamps                                                              |
  | `--t-small`   | 13                                                       | 18          | 400 / 500                     | 0        | Table headers, fact labels, secondary lines, footnotes                                                             |
  | `--t-data`    | 14                                                       | 20          | 400 (cells), 500 (pool names) | 0        | Table cells, nav, buttons, inputs ≥ 600 px                                                                         |
  | `--t-body`    | 15, or 16 below 600 px                                   | 24          | 400                           | −0.003em | UI copy, section takeaways                                                                                         |
  | `--t-prose`   | 16                                                       | 26          | 400                           | 0        | Methodology                                                                                                        |
  | `--t-lead`    | 18                                                       | 28          | 400                           | −0.01em  | Page lead sentence                                                                                                 |
  | `--t-title`   | 16                                                       | 22          | 600                           | −0.008em | Row titles in lists, dialog titles                                                                                 |
  | `--t-h2`      | `clamp(1.25rem, 1.152rem + 0.4348vw, 1.5rem)` (20→24)    | 1.25        | 500 (headings), 400 (answers) | −0.015em | Section headings. Also the answer sentence on Pool, Token, Gaps and Scorecard pages: weight 400, `text-1`, ≤ 44ch. |
  | `--t-h1`      | `clamp(1.625rem, 1.429rem + 0.8696vw, 2.125rem)` (26→34) | 1.15        | 500                           | −0.02em  | Page titles                                                                                                        |
  | `--t-kpi`     | `clamp(1.75rem, 1.457rem + 1.304vw, 2.5rem)` (28→40)     | 1.05        | 400                           | −0.025em | Fact values, focal score                                                                                           |
  | `--t-display` | `clamp(2.25rem, 1.761rem + 2.174vw, 3.5rem)` (36→56)     | 1.04        | 500                           | −0.03em  | The Home answer sentence only                                                                                      |

  Source: [type-a11y §2.1](research/type-a11y.md). _Test:_ grep the CSS. Every `font-size` is a token, and each clamp's max is at most 2.5 × its min ([utopia `checkWCAG`](https://github.com/trys/utopia-core/blob/main/src/index.ts)).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the type scale of [visual-v4.md §3.4](visual-v4.md#34-type-scale) replaces this table: `--t-mega` 96→196, `--t-title` 52→120, `--t-display` 32→64, `--t-say` 28→48, `--t-answer` 22→36, `--t-h2` 26→40, `--t-kpi` 36→56, `--t-figure` 24→40, then 19, 16, 15, 13 and 12 px. Page titles and section headings are lowercase words.
- **T5. The floor is 12 px.** Nothing renders below it. v2 used 11 px uppercase labels. _Test:_ `getComputedStyle` over all text nodes.
- **T6. Weights.**
  - Use 400, 500 and 600 only. Display and h1 use 500, and fact values use 400.
  - 700 or more is allowed only on the grade letter in the focal grade.
  - Weight never changes on hover or selection ([Rauno](https://github.com/raunofreiberg/interfaces)).
  - Large and light beats bold ([Uniswap fonts.ts](https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/fonts.ts)).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the weights of visual-v4.md §3.4: body 450, data 600, display sizes 750–850, so the oversized lowercase reads as Base's headlines do.
- **T7. Tracking tightens with size.**

  | Size     | Tracking           |
  | -------- | ------------------ |
  | 12–16 px | 0 to −0.01em       |
  | 20–28 px | −0.015 to −0.025em |
  | ≥ 32 px  | −0.02 to −0.04em   |

  Hanken has a low x-height, so stay at the loose end of each range. Positive tracking appears only at 12 px ([Inter dynamic metrics](https://d.rsms.me/inter-website/v3/dynmetrics/); [product-ui §2.3](research/product-ui.md)).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the tracking of visual-v4.md §3.4, down to −0.062em on the Home figure; eyebrows are tracked +0.09em.
- **T8. Line-height.**
  - Single-line UI: 1.25–1.43.
  - Reading copy: 1.5–1.63.
  - Headings: 1.15–1.25.
  - Display and KPI: 1.04–1.05.
  - Snap to a 2 px grid.
- **T9. Measure.**
  - Prose: at most 66ch.
  - Lead: at most 56ch.
  - Display: at most 20ch.
  - h1: at most 24ch.
  - Never justify ([WCAG 1.4.8](https://github.com/w3c/wcag/blob/main/guidelines/sc/20/visual-presentation.html)).
- **T10. Wrapping.** Set `text-wrap: balance` on h1–h3 and display, and `text-wrap: pretty` on prose.
- **T11. No uppercase.** Use sentence case for every label, table header, chip and button. _Test:_ `grep -r "text-transform: *uppercase" apps/web/src` returns nothing.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the one exception is `.eyebrow` (T1). _Test:_ `text-transform: uppercase` appears only in the `.eyebrow` rule.
- **T12. Tabular figures.**
  - Set `font-variant-numeric: tabular-nums` on every number that is compared or updates: tables, facts, axes and the block number.
  - Hanken is tabular by default. Set the property anyway for the fallback face.
- **T13. Answer sentences are one colour.** This covers the display sentence and the h2-size answers.
  - No accented word and no coloured number in a headline (tell SD5).
  - The number is set like the rest of the sentence.
- **T14. Hierarchy comes from size and colour, not weight.** With a fallback face, 500 may render as 400 ([data-ui §11](research/data-ui.md)).

## 3. Spacing and layout

- **S1. Spacing scale.** Use 4, 8, 12, 16, 24, 32, 48, 64 and 96. The only other lengths allowed are a 1 px hairline and a 2 px indicator. _Test:_ grep the CSS for `margin|padding|gap` values outside the tokens.
- **S2. Proximity.**
  - Within a group: 4–12.
  - Between groups: 24–32.
  - Between sections: 48 inside the product and 64–96 on Home.
  - There must be more space around a group than within it ([Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI)).
- **S3. Width.**
  - Content max-width is 1200 px, and tables are capped at 1200 px.
  - Everything is left-aligned on one grid. The only centred element is the butterfly's spine.
  - Do not stretch to fill wide screens ([Uniswap TokensTable](https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/Explore/tables/Tokens/TokensTable.tsx)).
- **S4. Gutters.**
  - 16 px plus `env(safe-area-inset-*)` below 600 px.
  - 24 px from 600 px.
  - 32 px from 1200 px.

  Source: [type-a11y §3](research/type-a11y.md).
- **S5. Breakpoints.**
  - `min-width` at 37.5em (600), 52.5em (840), 75em (1200) and 100em (1600), authored in em.
  - Components switch on container queries, not viewport.
  - v2's 379/399/639/1023/1279 px breakpoints go.
- **S6. Rhythm, not uniform padding.** Crowd related things and isolate sections. _Test:_ at 25 % zoom the sections differ in weight (squint test; [Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI): more space around a group than within it).
- **S7. Alignment.** On every page these share one left edge:
  - the page title;
  - the focal chart's plot area;
  - the first table column;
  - section headings.

  _Test:_ overlay a 1 px vertical guide on the screenshot.
- **S8. Chrome height.**
  - Desktop header: 56 px.
  - Demo notice: at most 28 px, on one line at every width.
  - Phone: top bar 52 px plus tab strip 44 px.
  - Set `scroll-padding-top` to the header height plus 8 px.

## 4. Colour

- **C1. Tokens.**
  - Author tokens in OKLCH.
  - Neutrals are tinted to hue 264 (Base blue). Chroma is 0.018–0.021 for dark surfaces, 0.004–0.009 for light surfaces and 0.005–0.020 for text.
  - No `#111`, `#0b0b0b` or untinted grey anywhere ([Linear LCH](https://linear.app/now/how-we-redesigned-the-linear-ui); [Radix scale](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale)).
  - Contrast below is the WCAG 2 ratio against the canvas. It was computed with the WCAG 2 relative-luminance formula, and OKLCH was converted with Ottosson's matrices. The neutrals, focus and status values come from type-a11y §6–7, and the side colours were computed for this file.

  | Role                     | Light                                     | Dark                                      | Use                                              |
  | ------------------------ | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------ |
  | `canvas`                 | `#f8f9fc`                                 | `#0e131c`                                 | Page, sections, tables: the only content surface |
  | `well`                   | `#f2f3f7`                                 | `#141923`                                 | Code blocks, skeletons, bar tracks               |
  | `raised`                 | `#ffffff`                                 | `#1b202a`                                 | Inputs, segmented thumb                          |
  | `overlay`                | `#ffffff` + shadow                        | `#222731` + 1 px `border`                 | Popover, menu, sheet, dialog                     |
  | `hover`                  | `#eceef3`                                 | `#262b36`                                 | Row and control hover                            |
  | `border-subtle`          | `#e5e8ed`                                 | `#292e38`                                 | Row separators (decorative)                      |
  | `border`                 | `#d8dbe1`                                 | `#343943`                                 | Section hairlines (decorative)                   |
  | `control`                | `#878c96` (3.21:1)                        | `#666c78` (3.53:1)                        | Input, button and segmented outlines             |
  | `text-1`                 | `#161b23` (16.4:1)                        | `#f0f2f5` (16.6:1)                        | Headlines, values, primary cells                 |
  | `text-2`                 | `#505561` (7.09:1)                        | `#d0d4dc` (12.5:1)                        | Body, labels, table headers, essential text      |
  | `text-3`                 | `#666c77` (5.02:1)                        | `#aab0bb` (8.54:1)                        | Non-essential metadata at ≥ 13 px                |
  | `focus`                  | `#1f5ed9` (5.45:1)                        | `#8fcdff` (10.9:1)                        | Focus ring only                                  |
  | `sell` (bid, price down) | `oklch(0.52 0.12 245)` `#196ea9` (5.19:1) | `oklch(0.72 0.11 242)` `#61ade4` (7.63:1) | Depth marks only                                 |
  | `buy` (ask, price up)    | `oklch(0.62 0.15 55)` `#c9690c` (3.62:1)  | `oklch(0.78 0.14 68)` `#f2a548` (9.08:1)  | Depth marks only                                 |
  | `ok` fg / bg             | `#036639` / `#daf7e3`                     | `#79dd9f` / `#173523`                     | Grades A–B, within KPI                           |
  | `warn` fg / bg           | `#875814` / `#fff0cc`                     | `#f5cb70` / `#3c2e0f`                     | Grade C                                          |
  | `bad` fg / bg            | `#b02a2d` / `#ffe7e5`                     | `#ff9e9b` / `#472020`                     | Grades D–F, breach                               |
  | `bad-mark`               | `oklch(0.585 0.12 25)` `#b85c57` (4.22:1) | `oklch(0.68 0.09 22)` `#ca827f` (6.2:1)   | Breach bands and strip cells (amended)           |

  Amended, these tokens are added:
  - `--bad-mark`: light `oklch(0.585 0.120 25)` `#b85c57` (4.22:1); dark `oklch(0.680 0.090 22)` `#ca827f` (6.2:1). Used for breach marks.
  - `--band-op`: 0.06 light, 0.09 dark.
  - The field tokens (visual-v3.md §3.7): `--ht-pitch` 3px and `--ht-r` 1px (the total row's dot pitch and radius); `--field-top` 1; `--field-low` 0.12 light, 0.1 dark; `--field-under` 0.14 light, 0.12 dark.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the locked Base brand kit hex values of [visual-v4.md §2.2](visual-v4.md#22-palette), never interpolated, with alpha allowed; the roles of §3.1. Gray 100 `#0A0B0D` is Base's black, chosen on purpose.

- **C2. The chrome is monochrome.** Links, buttons, nav, selection, segmented thumbs, row hover and section headings all use neutrals. Chromatic colour appears only in:
  - data marks;
  - status glyphs;
  - the focus ring;
  - the logo mark.

  Source: [Apple HIG Color](https://developer.apple.com/design/human-interface-guidelines/color), "one colour, one meaning"; [Linear calmer interface](https://linear.app/now/behind-the-latest-design-refresh). _Test:_ sample the screenshot. Every pixel with OKLCH chroma > 0.05 lies inside a chart, glyph, focus ring or logo.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): Base Blue may also be the band, the primary button and the nav indicator (and the light focus ring). It never marks data, a series, a link underline or a status.
- **C3. One colour, one meaning.**
  - `sell` blue and `buy` orange mark the two sides of a book and nothing else. They never colour text links, status or decoration.
  - v2 used `#1d4db5` for both links and bid bars, and that ends.
  - Blue and orange are the colour-blind-safe pair ([Okabe–Ito](https://siegal.bio.nyu.edu/color-palette/)).
  - Red and green never mark sides.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the sell side is Cerulean (white on the Blue band), the buy side Yellow everywhere (with a 1 px Gray 100 edge on white); value labels are ink; Blue never marks data.
- **C4. Status colour.**
  - Use status colour only for the grade band and for KPI state, and always pair it with a shape and a word.
  - Grade bands:
    - A–B = `ok`, circle;
    - C = `warn`, square;
    - D–F = `bad`, triangle.
  - Source: [Lighthouse](https://github.com/GoogleChrome/lighthouse/blob/main/report/assets/styles.css). _Test:_ grayscale the screenshot. Every status is still readable.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): Green, Tan and Red fill the grade glyph and the status chip behind an ink letter and shape; status words are ink with a coloured shape. Red and Green are never text.
- **C5. Where saturation goes.**
  - The most saturated region of a screen is its focal element.
  - On status strips, colour only the exceptions. Within-KPI cells are neutral `border`, and breach cells are `bad` ([data-ui §7](research/data-ui.md); [Few #10](https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/)).
  - Amended (with CH7 and CH8, breach marks): "Breach bands and breached strip cells use `--bad-mark`, not `--bad`. Bands sit at `--band-op` opacity. `--bad` stays for status words, shapes and chips."
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): breach bands and breached cells use Red (`--bad`, bands at `--breach-op`); `--bad-mark` and `--band-op` are retired.
- **C6. Contrast tiers.** All three gates must pass in both themes:
  - text-1: ≥ 15:1 and |Lc| ≥ 95;
  - text-2: ≥ 7:1 and |Lc| ≥ 75;
  - text-3: ≥ 4.5:1 and |Lc| ≥ 55, used only at ≥ 13 px;
  - controls and chart marks: ≥ 3:1.

  Sources: [WCAG 1.4.3](https://github.com/w3c/wcag/blob/main/guidelines/sc/20/contrast-minimum.html), [1.4.11](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/non-text-contrast.html); [APCA](https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md). _Test:_ the contrast script over the token pairs.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the contrast tiers of [visual-v4.md §2.4](visual-v4.md#24-contrast-rules): text-1 ≥ 15:1, text-2 ≥ 6:1 on the canvas (≥ 5.4:1 in wells), white and white at 80 % on the band; marks and controls ≥ 3:1.
- **C7. Dark mode is designed, not inverted.**
  - The canvas is tinted.
  - Elevation comes from lightness: canvas, then well, then raised, then overlay, about +3 L\* per step.
  - No shadows.
  - Text is never pure white.
  - Data colours are lighter and less saturated than in light mode ([Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode); [Material color spec](https://github.com/material-foundation/material-color-utilities/blob/main/typescript/dynamiccolor/color_spec_2021.ts)).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): dark is Gray 100 with Gray 80 edges; blocks are the canvas colour told apart by their edge; text is Gray 10, and white appears only on Blue.
- **C8. Plumbing.**
  - `color-scheme` is set.
  - `<meta name="theme-color">` equals `canvas` in each theme.
  - `<select>` has an explicit `background-color` and `color`.
  - No transitions fire during a theme switch ([next-themes](https://github.com/pacocoursey/next-themes)).
  - `prefers-contrast: more` maps text-3 to text-2 and borders to `control`.
- **C9. No decorative colour.**
  - No gradients except a chart area fill (side colour at 40 % fading to 0 %).
  - No tinted section backgrounds.
  - No glows.
  - No coloured icon backgrounds.
  - Amended (with E6, the field of light): "The C9 area fill may be drawn as a halftone screen, the field of light. It is side-colour dots on a lattice anchored at the spine, with dot opacity following the same top-to-baseline ramp (visual-v3.md §3.7), over a faint solid gradient. It is allowed only inside depth areas (the mirrored curve) and the butterfly's total row. The E6 background texture uses every fourth lattice point of the same grid behind the curve."
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): no gradients and no texture; hatching marks "the rest" (the butterfly's other pools, the field's merged square) and KPI shortfalls.

## 5. Surfaces and elevation

- **E1. The page is one surface.** Sections sit directly on `canvas`, separated by space and at most one `border` hairline. There is no bordered card per section, and no white card on a grey page ([Linear](https://linear.app/now/behind-the-latest-design-refresh); [Refactoring UI](https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI): "use fewer borders"). _Test:_ fewer than 3 elements per page have both a border and a background different from `canvas`. The exceptions are the inputs and overlays listed in `E2`.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the page has a flat Base Blue band, plane-1 blocks on the canvas, plane-2 blocks stacked over the band's lower edge and one sections sheet per detail page ([visual-v4.md §5.2](visual-v4.md#52-the-band-and-blocks), §5.7). Never a block in a block, never one block per section.
- **E2. At most one level of containment.**
  - The allowed containers are popover, menu, dialog, sheet, code block, input, the badge preview and a phone table's scroll wrapper.
  - Never put a card inside a card.
  - Source: [Apple HIG Layout](https://developer.apple.com/design/human-interface-guidelines/layout): group with alignment and space before reaching for containers.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the containers are the band, blocks (plain, over, ink, panel), the sections sheet and the floating layers; never a block in a block.
- **E3. Radii follow role and nest concentrically.**
  - Chips and grade glyphs: 4.
  - Buttons, inputs and the segmented outer edge: 6.
  - The segmented thumb: 4, which is 6 minus the 2 px inset.
  - Code blocks and badge preview: 8.
  - Popover and menu: 10.
  - Dialog and sheet: 12.
  - No pills, except the shields-style badge, which keeps its own shape.
  - Source: [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the radii of [visual-v4.md §3.6](visual-v4.md#36-radii): blocks 18, phone sheet 24, popover 16, tooltip 12, controls 12, segmented item 9, glyph 6, status chip 9; bars 0; no pills.
- **E4. Shadows belong to floating layers only.** Each is two layers plus a 1 px hairline. Light theme values:
  - `--shadow-pop`: `0 0 0 1px var(--border-subtle), 0 1px 2px rgb(22 27 35 / 0.06), 0 6px 16px rgb(22 27 35 / 0.08)`
  - `--shadow-dialog`: `0 0 0 1px var(--border-subtle), 0 2px 4px rgb(22 27 35 / 0.06), 0 16px 40px rgb(22 27 35 / 0.12)`

  The dark theme uses no shadows: `overlay` plus a 1 px `border`. _Test:_ `box-shadow` appears only on overlay selectors and focus rings.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the four planes of [visual-v4.md §3.7](visual-v4.md#37-elevation): blocks carry `--edge`, `--sh-1` or `--sh-band` and `--hl`; floating layers `--sh-3`; text and chart marks never carry a shadow, and `box-shadow` never animates.
- **E5. Hairlines.**
  - 1 px `border-subtle` between table rows.
  - 1 px `border` between major regions.
  - Never vertical rules in tables, never zebra stripes, never borders on both a row and its cells.
- **E6. Texture.** A 1 px dot on a 20 px grid at `border-subtle` sits only behind the focal depth chart, with a 40 px fade at the leading edge. Nothing else carries texture ([Uniswap chart texture](https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/hooks/useApplyChartTextureEffects.ts)).
  - Amended: "The E6 background texture uses every fourth lattice point of the same grid behind the curve" as the field of light (C9): 20 px on desktop, 16 px on phones. The field itself is the only other texture, inside depth areas and the butterfly's total row.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): no texture (C9).

## 6. Motion

- **M1. Tokens.** Motion uses only these ([motion §15](research/motion.md); [Emil Kowalski](https://github.com/emilkowalski/skills)):

  ```css
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);    /* enter, exit, press, popovers */
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1); /* on-screen movement: thumb, chart morph */
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);  /* phone sheet */
  --dur-press: 160ms; --dur-hover: 120ms; --dur-tooltip: 140ms; --dur-popover: 180ms;
  --dur-exit: 100ms; --dur-disclosure: 200ms; --dur-dialog: 240ms; --dur-route: 180ms;
  --dur-morph: 280ms; --dur-sheet: 500ms; --stagger: 30ms;
  --press-scale: 0.97; --enter-scale: 0.96;
  ```

  Hover colour changes use the `ease` keyword. Linear progress uses `linear`.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the motion tokens of [visual-v4.md §3.8](visual-v4.md#38-motion-tokens): `--ease-out` `cubic-bezier(0.16, 1, 0.3, 1)`, `--ease-in-out` `cubic-bezier(0.65, 0, 0.35, 1)`, `--ease-drawer` unchanged, and the `--d-*` durations.
- **M2. Frequency gate.**

  | How often it happens                              | Motion             |
  | ------------------------------------------------- | ------------------ |
  | 100+ times a day, or started from the keyboard    | None               |
  | Tens of times a day (hover, sort, toggles)        | Near-invisible     |
  | Occasional (popover, dialog, sheet, route change) | Standard           |
  | Once per session (first Home view)                | The only "delight" |

  Each animation names its purpose: feedback, spatial consistency, state change, preventing a jump, or explanation ([Emil](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md); [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)).
- **M3. Durations.**

  | Interaction                | Spec                                                                                                                                                               |
  | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | Press                      | `transform: scale(var(--press-scale))`, 160 ms `--ease-out`, on `:active`. It lands on pointer-down.                                                               |
  | Hover                      | Colour or background only, 120 ms `ease`, gated by `@media (hover: hover) and (pointer: fine)`                                                                     |
  | Table row hover            | 0 ms in, 150 ms `ease` out                                                                                                                                         |
  | Segmented thumb            | `transform` 200 ms `--ease-in-out`; 0 ms when moved by keyboard                                                                                                    |
  | Disclosure ("Details")     | Height and opacity ≤ 200 ms `--ease-out`; chevron rotates 180° over 200 ms                                                                                         |
  | Tooltip                    | Opens after 600 ms of hover, then 140 ms from `scale(0.97)` with opacity, from the trigger side. Others in the group open instantly within 400 ms. Closes in 0 ms. |
  | Popover or menu            | 180 ms in from `translateY(4px) scale(0.97)`, 100 ms out, `transform-origin` at the trigger                                                                        |
  | Dialog                     | 240 ms in from `scale(0.96)`, 100 ms out, centred origin. The backdrop fades with it.                                                                              |
  | Phone sheet                | `translateY(100%)` → 0 over 500 ms `--ease-drawer`. Dismiss on velocity > 0.4 px/ms or past 25 % of its height. Every gesture has a button alternative.            |
  | Route change               | React `<ViewTransition>` cross-fades `<main>` only, over 180 ms `--ease-out`. Back and Forward are instant. Header and demo notice sit outside the boundary.       |
  | Chart range switch         | Morph 280 ms `--ease-in-out`, only between corresponding marks, otherwise a 150 ms cross-fade                                                                      |
  | Copy confirmation          | Inline check and "Copied" for 2 s; no toast                                                                                                                        |
  | Lens (amended)             | Overlay slides to the spine, 280 ms `--ease-in-out` (a Web Animation that cancels the last); other marks dim over 150 ms `ease`; focus instant                     |
  | Total-row reveal (amended) | First Home view, with M6: `clip-path` from the spine, 300 ms `--ease-out` after 150 ms; labels fade in 150 ms at 300 ms; done by 450 ms                            |
  | Tween clock (amended)      | JS morphs (range, window, context) run 280 ms `--ease-in-out` on the Web Animation clock in `src/lib/motion.ts`; interruptible; keyboard 0 ms                      |

  Sources: [motion §2.2, §4, §6](research/motion.md); [React ViewTransition](https://react.dev/reference/react/ViewTransition); [Radix](https://www.radix-ui.com/primitives/docs/components/tooltip); [Base UI](https://base-ui.com/react/components/tooltip); [Vaul](https://github.com/emilkowalski/vaul).

  The last three rows come from visual-v3.md §4 (rows 1–5 and 9–11), which lists every animation in the product:
  - **Lens.** It enters on pointer over a pool row (fine pointer) or a tap on its bars (coarse): the stratum overlay moves `translateX(±offset × track width → 0)` over 280 ms `--ease-in-out`; other rows' bars, labels and Gap go to opacity 0.38, the total field, caps and gaps to 0.22 and row values to 1, each over 150 ms `ease`. Moving to another row shows the new overlay at the spine, opacity 0.4 → 1 over 150 ms `ease`. It exits when the pointer leaves the rows, focus leaves the figure, or on a tap outside or a second tap, over 150 ms `ease`. Focus is instant with no slide. Reduced motion: the overlay appears at the spine with a 150 ms opacity change.
  - **Total-row reveal.** On the first Home view, with M6's bars, the total field is revealed from the spine with `clip-path: inset()` over 300 ms `--ease-out` after a 150 ms delay; total values, caps, strata gaps and the "Gap" marker fade 0 → 1 over 150 ms `--ease-out` at 300 ms. All of it ends by 450 ms. Reduced motion: part of the 200 ms opacity fade.
  - **Tween clock.** The Pool range switch, the Scorecard window and the whole-pool context toggle morph over 280 ms `--ease-in-out` on the tween clock in `src/lib/motion.ts`: a no-op Web Animation times each tween, so a new tween on the same key starts from the current interpolated state. Ticks cross-fade (old `max(0, 1 − 2.5e)`, new `max(0, (e − 0.4) / 0.6)`) and scrubbing pauses while it runs. Keyboard changes pass 0 ms. Reduced motion: an instant change plus a 150 ms opacity 0.4 → 1 settle.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the motion catalogue of [visual-v4.md §4](visual-v4.md#4-motion-catalogue) replaces this table: press 120 ms, hover 160 ms, the route cross-fade 100 ms out and 180 ms in from the same instant, the disclosure fades and settles from −8 px (no height), the phone sheet closes over 260 ms.
- **M4. Animate only `transform`, `opacity` and occasionally `clip-path`.** Never use `transition: all`. Never animate `box-shadow`, `width`, `height`, `top`, `left` or `margin`, except the disclosure height. Never use `ease-in` on UI. _Test:_ `grep -rE "transition:\s*all|ease-in[^-]" apps/web/src` returns nothing.
- **M5. Every pressable element has `:active` feedback.** Set `-webkit-tap-highlight-color: transparent` and `touch-action: manipulation`. Never scale below 0.95. Never enter from `scale(0)`.
- **M6. The one orchestrated moment.** On the first Home view of a session, the butterfly bars grow out from the spine:
  - `scaleX` from 0.001, with the origin at the spine;
  - 300 ms `--ease-out` per row;
  - a 30 ms stagger;
  - at most 450 ms in total;
  - input is never blocked.

  Nothing else on any page animates on load ([motion §12.1](research/motion.md)). Under reduced motion it is a 200 ms opacity fade. The butterfly's total row is part of this moment (M3, "Total-row reveal").
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the first view plays once per session on whichever route the visitor lands (`dw-first-view` in `sessionStorage`, `?replay=1` replays it): the band drops, the title rises, bars grow from their spine and blocks settle over the band, every step ending by 450 ms ([visual-v4.md §4.1](visual-v4.md#41-the-first-view-the-one-orchestrated-moment)).
- **M7. Never:**
  - count-up numbers;
  - chart lines drawing in;
  - bars regrowing on refetch;
  - fade-up-on-scroll sections;
  - card hover lift;
  - bounce or elastic easing;
  - parallax;
  - scroll-jacking;
  - animated sort or row reorder;
  - a pulsing "live" dot;
  - a loop running longer than 5 s ([WCAG 2.2.2](https://www.w3.org/TR/WCAG22/));
  - transitions during a theme switch.
- **M8. Live values swap instantly.** These include the block number, "updated … ago" and refetched values. An optional 600 ms background tint marks a changed value, at most once per update.
- **M9. Reduced motion is designed, not deleted.**
  - Write CSS no-motion-first, with movement inside `@media (prefers-reduced-motion: no-preference)`.
  - Keep opacity and colour changes of 200 ms or less. Drop every translate, scale and morph.
  - Set `::view-transition-*` to `animation: none`.
  - _Test:_ emulate reduced motion. No `transform` animation runs.
- **M10. Loading timing.**
  - No loading UI for responses under 300 ms.
  - Once shown, a skeleton stays at least 400 ms.
  - After a parameter change, keep the old content. After 150 ms dim it to `opacity: 0.6` and show a 2 px indeterminate bar at the section top.
  - Never fall back to a skeleton once content exists ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); [TanStack keepPreviousData](https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries)).

## 7. Data presentation

- **D1. Each entity page leads with its depth signature:**
  - Home: a butterfly of pools.
  - Pool: a mirrored depth curve.
  - Token: a butterfly of the token's pools.
  - Scorecard: the market maker's depth per side against the KPI line.
  - Gaps and Pools lead with their ranked list.
- **D2. Anatomy of a page:**
  1. Title (with optional secondary line).
  2. Answer sentence (`P3`).
  3. Focal element.
  4. Facts row of 3–5.
  5. Sections.
  6. "About".

  The facts row is the only place for standalone headline numbers.
- **D3. A fact is value first, label second.**
  - The value uses `--t-kpi` at weight 400 in `text-1`.
  - Below it sits a 13 px `text-2` label that carries the comparison, for example "$28.2M" over "traded in 24 h".
  - No icons, no boxes, no caption paragraph ([Carbon anatomy](https://carbondesignsystem.com/data-visualization/chart-anatomy/)).
- **D4. A section is one visual, one takeaway sentence, and an optional "Details" disclosure** holding the table of numbers behind the visual. The section heading names the question in plain words ("Cost to trade", "Who provides it", "Over time").
- **D5. Secondary representations live at L2 or L3 only.** These are token amounts next to USD, the inverse price, raw HHI, buy and sell average prices, block numbers, and per-sample rows ([Uniswap DepthChartTooltip](https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartTooltip.tsx)).
- **D6. Unknown is "—", never 0.**
  - Show it in `text-3`, with a tooltip that gives the reason ("Token has no USD price", "Fewer than 3 snapshots").
  - Exhausted liquidity is drawn as a dashed segment ending in a short label.
- **D7. Demo honesty, said once.**
  - The demo notice in the chrome is the only place in the page that says "demo". The footer's data-source line names the source once.
  - Never add "synthetic" chips to rows or cards. Data strings such as a market maker named "Alice Markets (synthetic)" stay as they are.
- **D8. Glossary terms are explained once per page.** These are bps, HHI, turnover, KPI, mandate, tick spacing and band. On first use per page they get a 1 px dotted underline and a hover/focus tooltip of at most 2 lines that links to the Methodology anchor.
- **D9. Interaction state lives in the URL.** This covers filter, sort, window, view, columns and chart side. Restore scroll on Back ([Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); [Uniswap ChartSection](https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx)).

## 8. Numbers

Sources for this section: [data-ui §3](research/data-ui.md), [Uniswap formatters](https://github.com/Uniswap/interface/blob/main/packages/utilities/src/format/localeBasedFormats.ts), [MDN Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NumberFormat/NumberFormat) and [Few #3](https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/).
- **N1. USD** (amended). "Format with `Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: 'compact', minimumSignificantDigits: 3, maximumSignificantDigits: 3})`, then drop a bare `.0` before the suffix. Money therefore always has 3 significant figures with trailing zeros kept ($5.10M beside $6.08M, $7.40K beside $7.38K), except round values ($50K, $1M) and whole dollars below $1,000." The formatter this replaces set `maximumSignificantDigits: 3` alone.
  - Reason: strict `maximumSignificantDigits: 3` alone mixes `$5.1M` with `$6.08M` in one sentence, and `$7.9M` with `$9.77M` in one column (N8).
  - Chart ticks keep 2 significant figures.
  - Suffixes are uppercase `K M B`.
  - From $1 to $1,000, show whole dollars. Under $1, show the cents (`$0.42`); under half a cent a non-zero amount reads `<$0.01`. A non-zero amount is never `$0` (dust pools hold `$0.000…`).
  - Examples: `$11.2M`, `$31.5K`, `$260K`, `$412`, `$0.42`, `<$0.01`.
  - Never `$50.0k`, `$1.0k` or `$0.00`. _Test:_ the regex `/\$\d+(\.\d)?k|\.0[KMB]|\$0\.00/` finds nothing in the rendered text.
- **N2. Prices.**
  - At least 1: 2 decimals with grouping (`2,460.32`).
  - Below 1: 4 significant digits (`0.0004065`), shown only behind the inverse toggle. Always written out, never in exponent notation: `0.00000387`, not `3.87e-6`.
  - A price shows one direction ("1 WETH = 2,460.32 USDC") with a text toggle that flips it
    ("Show price in WETH").
- **N3. Basis points.** Below 100, 1 decimal. At 100 or more, an integer, with at most 4 significant digits. Write `10.4 bps` and `187 bps`. From 10,000 bps (a feasible spread never reaches it, docs/METRICS.md) a spread is not a number: the pool says `Can’t absorb $10K` where the spread would be. Where a round trip's cost is read by people who do not think in bps (the pool page), it leads with the percent and the dollars it comes to and puts the bps second: `0.18 %, about $18 (17.8 bps)` for a $10K round trip (`roundTripCost`); the percent keeps 2 significant figures below 10 % and is whole from there.
- **N4. Shares and uptime.**
  - LP shares and band shares are integers (`53 %`).
  - A share above 0 and below 1 % reads "under 1 %", never "0 %" (amended).
  - Uptime and stability have 1 decimal, and a whole value drops `.0` (`96.4 %`, `100 %`).
- **N5. Ratios.** Use `×` (U+00D7), with 1 decimal below 10 and an integer from 10 (`1.6×`, `51×`).
- **N6. Scores.**
  - The health score shows as an integer **truncated** (floor), so the number never contradicts its letter. `79.6` shows as `79 B`, matching `healthGrade(79.99) = 'B'`.
  - The 1-decimal value appears only in the score "Details" and the tooltip.
  - Gap score is an integer.
- **N7. Units and signs.**
  - A no-break space (U+00A0) sits between a number and its unit or %: `2 %`, `10.4 bps`, `24 h`.
  - Hanken has no thin or narrow spaces.
  - Use the true minus `−`, `±`, `×` and `≥` glyphs. _Test:_ no `\d%` and no `\d-\d` in the rendered text.
- **N8. Columns.** Numbers are right-aligned and tabular, with the same decimals down a column. Text is left-aligned, and nothing is centred ([Pajamas table](https://design.gitlab.com/components/table)).
- **N9. Deltas.** Use an explicit `+` and `−`. Colour the arrow, not the digits. Zero is neutral.
- **N10. Block numbers and times.**
  - Block numbers are grouped (`52,950,000`), set in mono only inside "About" lists.
  - Times are relative under 24 h (`2 h ago`) and absolute after (`21 Oct, 14:00 UTC`), with the full UTC time in a tooltip.
  - A value that repeats on every row becomes the table caption.
- **N11. Precision.**
  - Headline money has 3 significant figures.
  - Never show a token amount with more than 4 significant figures outside L3.
  - Never show both the USD value and the token amount in the same place at L0 or L1.

## 9. Charts

- **CH1. Frame.**
  - No gridlines, axis borders or tick marks.
  - Axis text is 12 px `text-3`, in sans with tabular figures, never mono.
  - Ticks fall on round values (`0, 5M, 10M`) and on time landmarks (`00:00, 06:00, 12:00, 18:00`, or day names for 7 d). There are never ticks like `06:56`, and never `$0.00`.
  - Axis labels are never rotated.

  Sources: [Uniswap ChartModelCore](https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartModelCore.ts); [Datawrapper ticks](https://www.datawrapper.de/blog/new-axis-ticks); [Carbon axes](https://carbondesignsystem.com/data-visualization/axes-and-labels/).
- **CH2. Interaction.**
  - The crosshair is 1 px at `border` colour and follows the pointer 1:1 with no easing.
  - Scrubbing a time series rewrites the section header value and its timestamp, with no floating box.
  - Snapshot charts (depth) use a tooltip. It is 150 px minimum wide, padded 8, radius 10, on `overlay`, 12–13 px text, and lists range, USD, token amount and reached/exhausted.

  Sources: [Robinhood Spark](https://github.com/robinhood/spark/blob/master/README.md); [Uniswap DepthChart](https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChart.tsx).
- **CH3. Mirrored depth curve** (the pool focal).
  - The sell side fills left of mid and the buy side right.
  - The x positions are log-spaced at −5, −2, −1, 0, +1, +2 and +5 %.
  - Straight segments join **measured points only**, each with a 6 px dot. Nothing is extrapolated past ±5 %.
  - The line is 2 px in the side colour, and the fill is the side colour fading from 40 % to 0 %.
  - The ±2 % band is shaded `well`, and a 1 px mid line is drawn in `border`.
  - There are exactly two direct labels, at ±2 %.
  - An exhausted side is drawn as a dashed segment labelled "Liquidity runs out".
  - If a side lacks a measured level, show a sentence instead of a misleading shape.
  - Height is 320–356 px on desktop and 240 px on phones.

  Sources: [Uniswap DepthChart helpers](https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.helpers.ts); [data-ui §1](research/data-ui.md).
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): flat white and Yellow areas on the band, 12 px square points ringed in the side colour, and the two ±2 % labels above the plot ([visual-v4.md §5.9.3](visual-v4.md#593-mirrored-depth-curve-pool-focal-ch3)).
- **CH4. Depth butterfly** (Home and Token focal).
  - One row per pool, with sell bars left and buy bars right of a centre spine, on **one shared linear scale**, sorted by depth.
  - Desktop (≥ 840 px):
    - the pair label sits in a 160 px centre column between the bars;
    - rows are 40 px high with 14 px bars (amended; was 36 px with 12 px bars).
  - Phone:
    - the label sits on its own line above a centred bar pair;
    - rows are 56 px high with 10 px bars (amended; was 52 px).
  - A non-zero side is at least 2 px wide.
  - Show at most 8 rows: the 7 deepest plus the largest gap if it is not among them. Add "Show all N pools" below.
  - Labels (amended; was "at most 2 direct value labels, on the deepest row"): "The butterfly closes with an **'All of Base'** total row below a `border-subtle` hairline. Its two sides are drawn as the field of light, stacked from the spine in row order, with a canvas gap at each pool boundary and a 2 px solid cap at the end. The shared scale's maximum is the larger total side. The two direct value labels sit on the total row; pool rows show their values on hover, focus or tap (the lens). A caption under the axis reads 'One scale for every pool'."
  - Every row is a link to its pool.

  Source: [data-ui §11 sketch](research/data-ui.md). _Test:_ rows share one `xScale`, and a $31.5K pool renders narrower than 4 px next to $6.1M.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the total row draws the 7 deepest pools as per-pool segments with a hatched rest, and a bracket states the share of the deepest pool ([visual-v4.md §5.9.1](visual-v4.md#591-depth-butterfly-home-focal-token)).
- **CH5. Time series.**
  - Stack small multiples that share the x axis. Never use dual y axes.
  - Range pills: 24 h and 7 d (plus 30 d for scorecards), stored in the URL.
  - Lines are 2 px with rounded joins and no fill.
  - Line y axes may crop; bars and areas start at zero.
  - Missing periods are not interpolated. Draw them as a dashed `text-3` segment.
  - Focal height is 320–356 px, and each small multiple is 120–160 px.

  Sources: [Pajamas charts](https://design.gitlab.com/data-visualization/charts); [Stripe chart layout](https://docs.stripe.com/stripe-apps/patterns/chart-layout).
- **CH6. Series colour.**
  - Per-side series use `sell` and `buy`.
  - A single series uses `text-1`.
  - Context series (the whole pool behind a market maker) are 1 px `text-3`.
  - No third hue. The v2 spread purple goes.
  - A legend appears only for 2 or more series, as inline words with 8 px swatches above the plot. Prefer direct labels ([Primer](https://github.com/primer/design/blob/main/content/ui-patterns/data-visualization.mdx)).
- **CH7. Targets and breaches.**
  - A KPI or target is a 1 px dashed `text-2` reference line with a direct label ("KPI $50K per side"). It is never red ([CDS ReferenceLine](https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/ReferenceLine/_webExamples.mdx)).
  - Breach episodes are `bad` bands at 12 % opacity behind the series.
  - Amended: breach bands use `--bad-mark` at `--band-op` opacity (0.06 light, 0.09 dark), not `bad` at 12 %. `--bad` stays for status words, shapes and chips.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): breach bands use Red at `--breach-op` (0.14 light, 0.22 dark).
- **CH8. Compact glyphs.**
  - **Bullet graph.** A 6 px bar in `text-1` on a `well` track, with a 2×14 px target tick in `text-2` ([Few bullet graph](https://en.wikipedia.org/wiki/Bullet_graph)).
  - **Weighted health bar.** Four segments sized 35 / 25 / 20 / 20, with 2 px gaps, each filled in `text-1` to its component score on a `well` track. It is 8 px high when focal and 4 px in tables (80 px wide).
  - **Uptime strip.** One row of cells, one per sample, with 2 px gaps, 12 px high. Within-KPI cells are `border`, breaches are `bad`, and unevaluable cells are hollow. It is never split into up and down rows.
    - Amended: breached strip cells use `--bad-mark`, not `bad`.
  - **Row depth glyph.** An 80×20 butterfly on the table's shared scale.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): breached strip cells use Red; the glyph sizes are those of visual-v4.md §5.9.8.
- **CH9. Every chart has an accessible equivalent:**
  - a title or takeaway sentence;
  - `role="img"` with an `aria-label` summary;
  - a "Show data" disclosure holding the numbers as a table.

  Source: [CDS LineChart](https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/LineChart/_webExamples.mdx).
- **CH10. Library defaults are off.**
  - Recharts: `isAnimationActive={false}` except the range morph, Tooltip `animationDuration={0}`, no `CartesianGrid`.
  - The Recharts defaults are a line draw-in of 1,500 ms, bars of 400 ms and tooltips of 400 ms ([Recharts](https://recharts.github.io/en-US/api/Line)).

## 10. Tables and lists

- **TB1. A table is for columnar data that people compare across rows.** These are Pools, the Gaps table view, Compare DEXes and raw samples. Feeds and entity lists are styled row lists: Home previews, the scorecards list and breach episodes ([marcus-skills Linear](https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md)).
- **TB2. Columns.**
  - At most 6 visible columns by default on desktop, including the glyph column.
  - The rest sit behind a "Columns" menu, stored in the URL as `?cols=`.
  - _Test:_ count `th` elements at 1440 px.
- **TB3. Rows.**
  - 56 px for primary tables and 44 px for dense sub-tables on a fine pointer; at least 52 px on a coarse pointer.
  - The whole row is the target: a single link in the first cell, stretched over the row with `::after`, giving one tab stop per row.

  Sources: [Uniswap table constants](https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/constants.ts); [Carbon data table](https://carbondesignsystem.com/components/data-table/style/).
- **TB4. Headers.**
  - 13 px, weight 500, `text-2`, sentence case.
  - The sorted column is `text-1` with a 12 px arrow. The others reveal the arrow on hover.
  - The first click sorts metrics descending.
  - Nulls sort last in both directions.
  - `aria-sort` is set ([Carbon usage](https://carbondesignsystem.com/components/data-table/usage/)).
- **TB5. One chip per row at most:** the grade glyph (28 px wide) or, for a pool with no grade, the "Not rated" chip (auto width, neutral, the words instead of a letter, its reason on hover, focus or tap, and above the row link with a 44 px touch area). DEX, fee and "stable" are muted secondary text in the pool cell ("Aerodrome Slipstream, 0.05 %"), never boxes ([L2BEAT StageBadge](https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/badge/StageBadge.tsx)).
- **TB6. Repeated values become captions.** "Updated just now" on every row becomes one caption above the table.
- **TB7. Phones.**
  - At most 3 data columns: pool, the metric of the current sort, and grade (or the "Not rated" chip, which is wider than the 28 px glyph). Everything else is one tap away.
  - Amended (with PH4, phone columns): "On phones the Sort sheet is also the column picker. The row's value is the sort metric, so every optional column is one tap away. Price is not sortable across pairs and stays on the pool page."
  - If a table must scroll sideways, it scrolls inside its own wrapper, with a sticky first column and an edge fade.
  - The page itself never scrolls sideways ([WCAG 1.4.10](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/reflow.html)).
- **TB8. Stickiness and pagination.**
  - The header sticks with 12 px clearance under the app bar.
  - Pages hold 50 rows, extended with a "Show more" button.
  - Sort, filter and page live in the URL.
- **TB9. List previews.**
  - Home sections show at most 3 rows. Section-level lists show at most 5 rows, then "Show all N".
  - Low-signal rows are grouped under one quiet line, such as "Show 5 more pools that trade less than 3× their depth", that expands. A **meaningful gap** is turnover of 3× or more (gap score ≥ 24), and every screen uses that threshold.

## 11. Components

- **K1. Buttons.**
  - Height 36 px on a fine pointer and 44 px on a coarse pointer, padding 0 14, radius 6, label 14 px / 500.
  - **Primary:** `text-1` fill with `canvas` label, at most one per view.
  - **Secondary:** transparent with a 1 px `control` outline.
  - **Quiet:** text only.
  - A loading button keeps its label and adds a 12 px spinner.
- **K2. Links.**
  - Prose links are `text-1`, with a 1 px underline at `text-3`, offset 3 px, turning `text-1` on hover.
  - Navigational links (rows, nav) have no underline.
  - Link text never carries an arrow.
  - A whole-row link may show a 16 px chevron icon (`aria-hidden`) on hover on desktop only.
  - Back link (amended): "Detail pages (Pool, Token, Scorecard) start with a back link to their list: a 16 px chevron icon plus the list name, 13 px / 500, `text-2`."
- **K3. Primary nav.**
  - Inactive items are `text-2`. The active item is `text-1` with a 2 px `text-1` indicator under it.
  - The indicator moves 200 ms `--ease-in-out` on click and 0 ms on keyboard.
  - Where section controls sit is amended under K10.
- **K4. Segmented control.**
  - 32 px high (44 coarse), outer radius 6, a `raised` thumb with radius 4 and a 2 px inset.
  - Implemented as a `radiogroup`, with arrow keys.
  - Use it only for parallel views (`P6`).
- **K5. Chips.**
  - Use them only for state that changes: grade, scorecard status.
  - 20 px high, radius 4, 12 px / 500, a tinted `bg` with same-hue `fg` plus a shape.
  - The grade glyph is a fixed 28 px wide; the "Not rated" chip is as wide as its words.
  - A status chip is filled only on the scorecard's own page, where it is the subject and the only filled chip. In lists (Home, Scorecards, Pool's mandates), status is the shape and word in the status colour, with no fill.
- **K6. Inputs.**
  - 36 px high (44 coarse), radius 6, 1 px `control` border, `raised` fill.
  - Font is 16 px below 600 px.
  - A visible label or `aria-label`; the placeholder is never the only label.
- **K7. Tooltips.**
  - Plain text of at most 2 lines, 13 px, on `overlay`, radius 10, with `--shadow-pop`.
  - They are hoverable and dismissed with Escape ([WCAG 1.4.13](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/content-on-hover-or-focus.html)).
  - They are never on disabled controls and never the only path to a value.
- **K8. Copy.** The button label becomes "Copied" with a check for 2 s, announced with `aria-live="polite"`.
- **K9. Icons.**
  - One stroke set, 16 px beside 13–14 px text, with a 1.5 px stroke.
  - No tinted squares.
  - In a list, either every item has an icon or none does.
  - Icon-only buttons carry an `aria-label`.
  - No emoji ([Apple HIG Icons](https://developer.apple.com/design/human-interface-guidelines/icons); [Raycast](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
- **K10. Disclosure.**
  - A quiet button reading "Details", "Show formula" or "Show data", with a 16 px chevron and `aria-expanded`.
  - The content follows it in the DOM.
  - Its open state is not stored in the URL.
  - Controls position (amended): "A section's Details control sits in its heading: under the takeaway in the left column on desktop, at the right end of the heading line on phones. Its panel opens under the visual."
- **K11. The logo is the mark plus wordmark:** a 20 px mark and a 16 px / 600 wordmark. The mark is the only place the side colours appear outside data.
  - **v4 amended** ([visual-v4.md §1.8](visual-v4.md#18-rules-this-spec-amends)): the mark's sides are Cerulean and Yellow (a 0.5 px Gray 100 edge on the Yellow in light), its spine `currentColor`; 22 px in the app bar and 28 px in the footer, with the wordmark at 21 / 850.

## 12. States

- **ST1. Loading.**
  - The skeleton mirrors the final layout exactly, using `well` blocks at the same heights. It is static: no shimmer, or a single 1 s pulse.
  - Timing follows `M10`.
  - _Test:_ CLS = 0 on every route.
  - Sources: [Vercel WIG](https://github.com/vercel-labs/web-interface-guidelines); [NN/g skeletons](https://www.nngroup.com/articles/skeleton-screens/).
- **ST2. Empty.**
  - Say what is empty and give the next step ("No mandates registered yet. Mandates are added with `depthwatch mm add`. How scorecards work").
  - Never render "No results" before data has loaded ([Raycast](https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md)).
- **ST3. Error.**
  - Say what happened and how to recover, and offer a "Retry" button.
  - No "we" and no apology: "Unable to load pools. Check that the API is running, then retry." ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **ST4. Not found.** One sentence, the id in mono, and two links.
- **ST5. Partial data.**
  - Nulls follow `D6`.
  - "Not tracked" and "exhausted" are words, not colours.
  - An unscored pool shows its meta and says "Not scored yet".
  - A scored pool with no grade (too thin on both sides, too thin on one side, or no USD price) shows the neutral chip "Not rated" in place of the letter, with the reason on hover, focus or tap and in the pool's Health Details. Never a letter, and in lists the unrated pools follow the rated ones: Pools shows them behind one row, "Show N unrated pools" (TB9), or leaves them out with "Rated only".
- **ST6. Every list is designed for 0, 1, 6 and 50+ items.** That includes the butterfly, which caps at 8 rows. _Test:_ storybook-style fixtures, or mock overrides, for each count.
- **ST7. API unreachable** is shown in the header freshness slot ("Offline") and in each failed section. It is never a full-page takeover when cached data exists. At start-up there is none, so a production build shows one full page: "The data service is not answering.", what to do and a "Try again" button that probes again. It never substitutes mock data.

## 13. Copy

- **CP1.** Use sentence case everywhere.
- **CP2.** No "we". Use active voice, and the second person sparingly ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing)).
- **CP3.** Buttons are a verb plus a noun, with no end punctuation: "Browse pools", "Copy Markdown", "Show all 6 pools" ([Stripe buttons](https://docs.stripe.com/stripe-apps/components/button)).
- **CP4.** A link names its destination: no "click here", no arrows.
- **CP5.** Headlines state facts with numbers. No slogans, no tricolons, no "Liquidity, measured." A headline that could open any product says nothing about this one ([Apple HIG Writing](https://developer.apple.com/design/human-interface-guidelines/writing): check each word to be sure it needs to be there).
- **CP6.** No middle-dot meta strings (`A · B · C`). Separate items with layout (spacing, separate elements) or with words and commas. _Test:_ `grep -rn " · " apps/web/src --include=*.tsx` returns only comments.
- **CP7.** No `WORD — fragment` labels. The em dash appears only as the null value.
- **CP8.** Use curly quotes, `…`, U+00A0 in glued terms, `−` and `×`.
- **CP9. Fixed vocabulary.**

  | Use                    | Instead of                     |
  | ---------------------- | ------------------------------ |
  | sell side (price down) | bid side, bid                  |
  | buy side (price up)    | ask side, ask                  |
  | market maker           | MM                             |
  | depth ±2 %             | Depth ±2%, 2% depth            |
  | spread at $10K         | spread $10k, round-trip spread |
  | within KPI, breached   | OK, fail, pass                 |
  | 24 h, 7 d              | 24H, 24h, 7D                   |
  | health and grade       | health score, rating           |
  | rated, not rated       | graded, ungraded               |
  | gap                    | liquidity hole, opportunity    |
  | mandate                | agreement, contract            |

  Bid and ask appear in the glossary tooltip ("the bid side"). Status chips may keep the short words "OK" and "Breached", because they are state labels.
- **CP10. Lengths.**
  - Page lead: 1 sentence of at most 25 words.
  - Section takeaway: at most 15 words.
  - Button: at most 3 words, plus a count.
  - Demo notice: at most 40 characters plus one link.

## 14. Accessibility

- **A1.** WCAG 2.2 AA at minimum, with contrast per `C6`.
- **A2. Focus ring.**
  - `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`, appearing instantly.
  - On coloured fills, use a two-tone ring: the outline plus `box-shadow: 0 0 0 4px var(--canvas)`.
  - Inside `overflow` containers, use `outline-offset: -2px` ([WCAG 2.4.13](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-appearance.html); [C40](https://github.com/w3c/wcag/blob/main/techniques/css/C40.html)).
- **A3. Focus is never covered.** Set `scroll-padding-top` to the header height plus 8 px ([WCAG 2.4.11](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/focus-not-obscured-minimum.html)).
- **A4.** "Skip to content" is the first focusable element: visible on focus and 44 px high.
- **A5. Target sizes.**
  - Every target is at least 24×24, and at least 44×44 under `(pointer: coarse)`.
  - Phone nav items are 48 px high, with 8 px between targets ([WCAG 2.5.8](https://github.com/w3c/wcag/blob/main/guidelines/sc/22/target-size-minimum.html); [2.5.5](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/target-size-enhanced.html)).
- **A6.** Status is never shown by colour alone: there is always a shape and a word (`C4`).
- **A7. Charts.**
  - Follow `CH9`.
  - The crosshair can be moved with the arrow keys when the chart has focus.
  - Tooltip content is also reachable on focus.
- **A8. Reflow and text spacing.**
  - Reflow works at 320 px.
  - 200 % zoom works at 1280 px.
  - WCAG 1.4.12 text spacing injection causes no clipping.
  - There is no 2-D scroll except inside a table wrapper ([WCAG 1.4.10](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/reflow.html), [1.4.12](https://github.com/w3c/wcag/blob/main/guidelines/sc/21/text-spacing.html)).
- **A9. Structure.**
  - One `h1` per page, and heading levels in order (visual size may differ).
  - Landmarks: `header`, `nav`, `main`, `footer`.
  - DOM order matches visual order.
- **A10. Preferences.** Honour `prefers-reduced-motion` (`M9`), `prefers-contrast: more` (`C8`) and `forced-colors: active`, under which focus rings and status shapes stay visible.
- **A11. Live regions.**
  - Copy confirmations and "Showing N pools" after a filter use `aria-live="polite"`.
  - The freshness text is not live, so it does not announce every refetch.

## 15. Phone

- **PH1. Safe areas.** Set `viewport-fit=cover`, with gutters of `max(16px, env(safe-area-inset-left/right))` and `calc(8px + env(safe-area-inset-bottom))` under anything fixed ([MDN env()](https://developer.mozilla.org/docs/Web/CSS/env)).
- **PH2. Chrome.**
  - The total is at most 124 px: a 28 px demo line, a 52 px top bar and a 44 px tab strip.
  - The top bar holds the logo and a freshness dot: a 44 px button that opens a popover with block and time.
  - There is no theme toggle. The app follows the system appearance, as v2 does ([Apple HIG Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)).
  - The tab strip holds Pools, Gaps, Scorecards and Methodology at 15 px / 500, 20 px apart, with a 2 px indicator. Below 360 px it scrolls sideways with an edge fade.
  - The strip may hide on scroll-down and return on scroll-up. The top bar never hides ([NN/g hidden navigation](https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/)).
- **PH3. No fixed bottom bar in a browser tab.** One is allowed only in `display-mode: standalone` ([WebKit 281071](https://bugs.webkit.org/show_bug.cgi?id=281071)).
- **PH4. Filters, sort and columns open in a bottom sheet.**
  - The Sort sheet is also the column picker; the row's value is the sort metric (TB7, amended).
  - It opens at a medium detent, traps focus and returns it on close.
  - Use `overscroll-behavior: contain` and `max-height: calc(100dvh - env(safe-area-inset-top) - 24px)`.
- **PH5. Text and inputs.** Body text is 16 px and inputs are 16 px. Never disable zoom.
- **PH6. The focal element starts inside the first viewport** (at least its top half). On phones the lead sentence may move below the focal element to make room.
- **PH7. Test widths:** 320, 360, 375, 390, 412 and 430. _Test:_ `scrollWidth === clientWidth` at each width, and again at 200 % zoom on 1280.
- **PH8. Charts.** 240 px high. The y axis may hide, in which case the header value replaces it.
- **PH9. Use `100dvh` and `100svh`, never bare `100vh`.**

## 16. Forbidden: template patterns

Any of these in a screenshot or diff blocks the merge. Each is a default that nothing in the product chose. The IDs in brackets refer to the rules above and to the pattern list in [product-ui §11](research/product-ui.md).
1. **Tracked ALL-CAPS labels**: `24H VOLUME`, `ALL SCORED POOLS`, `DEPTH ±2%` [SD4, T5]. _grep:_ `text-transform: uppercase`.
   - v4 amended: eyebrows are the one exception (T1, T11).
2. **Middle-dot meta strings** in UI text: `Open source · no token · no custody`, `±1 · 2 · 5 %` [SD4]. _grep:_ `·` in `.tsx`.
3. **Arrows glued to links**: `All gaps →`, `Open scorecard →` [CP3]. _grep:_ `→` or `->` inside link text.
4. **Mono for decorative labels**, axis ticks or scales such as `$1k · $10k · $100k` [SD4].
   - v4 amended: eyebrows are the one exception (T1).
5. **`WORD — fragment` labels**, such as `Demo data — synthetic …` [SD4].
6. **The card kit**: a bordered rounded card around every section, one radius everywhere, a white card on a grey page [K2].
   - v4 amended: v4 has the band, blocks stacked over it and one sections sheet per detail page (E1), never a card per section.
7. **Cards in cards**: KPI cards inside a KPI panel, uptime tiles inside an uptime panel [K11].
   - v4 amended: never a block in a block (E2).
8. **The stat-tile hero**: big number, small label, caption, in a 2×2 or 4-up grid [D2, D3].
9. **Identical feature cards**: four "What we measure" boxes with the same shape [L2].
10. **Chip soup**: more than one chip per row; chips for non-state data such as DEX, fee, "stable" or "synthetic" [K12].
11. **First-order framework defaults**:
    - purple-to-blue gradients;
    - gradient text;
    - glassmorphism;
    - glow shadows;
    - the same soft grey shadow on everything;
    - icons in tinted squares;
    - emoji bullets;
    - the default four-column footer.
12. **Default faces as the voice**: Inter, Roboto, Arial, system-ui, Geist, Space Grotesk, JetBrains Mono for labels. Also the Google Fonts `<link>`.
13. **Generic near-black canvases** (`#111`, `#0b0b0b`, v2's `#0b0e13`) and greys with no deliberate hue. Use the tinted ramp in `C1`.
    - v4 amended: Gray 100 `#0A0B0D` is Base's black, chosen on purpose (C1).
14. **An accented word or a differently coloured number in a headline** [SD5].
15. **Decorative devices**: glyph dividers between sections, `01 / 02 / 03` markers, ornamental icons.
16. **Motion clichés**:
    - count-up numbers;
    - fade-up on scroll;
    - hover lift;
    - bounce or elastic easing;
    - a pulsing live dot;
    - endless shimmer;
    - chart draw-in;
    - `transition: all`.
17. **Default chart styling**:
    - gridlines;
    - dual y axes;
    - `$0.00` on an axis;
    - ticks at odd times (`06:56`);
    - a legend for one series;
    - mono ticks;
    - a third accent hue for one metric;
    - the 84-cell red/green barcode.
18. **Slogans and hollow copy**: tricolons, "Liquidity on Base, measured pool by pool.", "We measure …", the audience described instead of served ("For ecosystem leads, protocol teams and market makers").
19. **A band of round stats** ("6 pools · $26.1M · 82.4") with no comparison.
20. **Repetition as decoration**: "synthetic" on every card, "just now" on every row, "depth up / depth down" chips 24 times in one table.
21. **Saturated status colour as the loudest pixels** on a page whose subject is not status.
22. **One colour with two meanings**: link blue equal to bid blue.
23. **Uniform padding and equal weight everywhere**, failing the squint test [S1].
24. **The second-order "tasteful" defaults** [SD1–SD3]:
    - cream with terracotta;
    - near-black with one acid accent;
    - broadsheet cosplay: 0 radius, hairlines everywhere, dense serif-and-mono columns.
25. **The Tailwind type fingerprint** 12/14/16/18/24/30/36/48/60/72 used as the scale: a framework default, not a chosen scale [T4].
26. **Generic CTA pairs**: a filled "Explore …" next to an outlined "Learn more" in a hero.
27. **Design drift across pages** [X1]: one page with cards, another without; different header anatomy per page.

## 17. Acceptance checklist

A v3 change is accepted when all of these hold:
1. **Fonts.** `document.fonts` reports Hanken Grotesk and IBM Plex Mono as `loaded` before screenshots. A second screenshot set with web fonts blocked shows no overflow and readable hierarchy. The fallback set is checked for layout, not character, because the resolved fallback face depends on the machine ([type-a11y fallback note](research/type-a11y.md)).
2. **Screenshots.** Taken at 1440×900, 1280×800, 390×844 and 320×640 (2× DPR on phones), light and dark, for every route in `ia-v3.md` §2.
3. **Squint test.** `P1` passes, and the PR names each screen's focal element.
4. **Number count.** Each first viewport is within `P2`. Page heights are within `P9`.
5. **Greps.** The greps in `T11`, `M4` and `CP6` and tells 1–3 all return nothing, and the `CP8` check in `apps/web/src/styles.test.ts` (no straight apostrophes in UI strings) passes.
6. **Contrast.** The script passes every token pair in both themes (`C6`).
7. **Keyboard.** Every interactive element can be tabbed to and has a visible ring. Segmented controls and charts work with the arrow keys. No keyboard action animates.
8. **Reduced motion.** With it emulated, no transform animation remains.
9. **Overflow.** `scrollWidth === clientWidth` at every phone width.
10. **Rule audit.** The PR lists every rule ID here that is not met, with a reason. An empty list is the goal.

---

## Sources

The research notes listed at the top. Every URL cited above, grouped:
- **Product and visual craft.**
  - Linear: https://linear.app/now/how-we-redesigned-the-linear-ui · https://linear.app/now/behind-the-latest-design-refresh
  - Vercel: https://github.com/vercel-labs/web-interface-guidelines
  - Rauno Freiberg: https://github.com/raunofreiberg/interfaces
  - Emil Kowalski: https://github.com/emilkowalski/skills · https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md · https://github.com/emilkowalski/vaul
  - Paco Coursey: https://github.com/pacocoursey/next-themes
  - Refactoring UI notes: https://github.com/kylecoberly/knowledge/wiki/Refactoring-UI
  - Radix: https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale · https://www.radix-ui.com/primitives/docs/components/tooltip
  - Base UI: https://base-ui.com/react/components/tooltip
  - Raycast: https://github.com/raycast/extensions/blob/main/docs/basics/prepare-an-extension-for-store.md
  - Linear patterns (third-party): https://github.com/marcus/marcus-skills/blob/main/skills/linear-design-patterns/references/linear-design-system.md
  - Stripe: https://docs.stripe.com/stripe-apps/components/button · https://docs.stripe.com/stripe-apps/patterns/chart-layout
- **Apple HIG.**
  - Layout: https://developer.apple.com/design/human-interface-guidelines/layout
  - Color: https://developer.apple.com/design/human-interface-guidelines/color
  - Dark mode: https://developer.apple.com/design/human-interface-guidelines/dark-mode
  - Motion: https://developer.apple.com/design/human-interface-guidelines/motion
  - Icons: https://developer.apple.com/design/human-interface-guidelines/icons
  - Writing: https://developer.apple.com/design/human-interface-guidelines/writing
- **Data UI.**
  - Uniswap interface: https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartHeader.tsx · https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/ChartModelCore.ts · https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Charts/hooks/useApplyChartTextureEffects.ts · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChart.tsx · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartModel.helpers.ts · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/DepthChartTooltip.tsx · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/PoolDetails/components/ChartSection/index.tsx · https://github.com/Uniswap/interface/blob/main/apps/web/src/components/Table/constants.ts · https://github.com/Uniswap/interface/blob/main/apps/web/src/pages/Explore/tables/Tokens/TokensTable.tsx · https://github.com/Uniswap/interface/blob/main/packages/utilities/src/format/localeBasedFormats.ts · https://github.com/Uniswap/interface/blob/main/packages/ui/src/theme/fonts.ts
  - Coinbase CDS: https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/ReferenceLine/_webExamples.mdx · https://github.com/coinbase/cds/blob/master/apps/docs/docs/components/charts/LineChart/_webExamples.mdx
  - Lighthouse: https://github.com/GoogleChrome/lighthouse/blob/main/report/assets/styles.css
  - L2BEAT: https://github.com/l2beat/l2beat/blob/main/packages/frontend/src/components/badge/StageBadge.tsx
  - Robinhood Spark: https://github.com/robinhood/spark/blob/master/README.md
  - GitLab Pajamas: https://design.gitlab.com/components/table · https://design.gitlab.com/data-visualization/charts
  - IBM Carbon: https://carbondesignsystem.com/data-visualization/chart-anatomy/ · https://carbondesignsystem.com/data-visualization/axes-and-labels/ · https://carbondesignsystem.com/components/data-table/style/ · https://carbondesignsystem.com/components/data-table/usage/
  - Primer: https://github.com/primer/design/blob/main/content/ui-patterns/data-visualization.mdx
  - Datawrapper: https://www.datawrapper.de/blog/new-axis-ticks
  - Recharts: https://recharts.github.io/en-US/api/Line
  - TanStack Query: https://tanstack.com/query/latest/docs/framework/react/guides/paginated-queries
  - MDN Intl.NumberFormat: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/NumberFormat/NumberFormat
  - Few: https://www.thedataschool.co.uk/anh-vu/are-you-making-these-13-dashboard-design-mistakes/ · https://en.wikipedia.org/wiki/Bullet_graph
  - Tufte: https://kraft.blog/2006/02/envisioning-information-multiples-and-colors/
  - Cowan: https://memory.psych.missouri.edu/assets/doc/articles/2001/cowan-bbs-2001.pdf
  - Okabe–Ito: https://siegal.bio.nyu.edu/color-palette/
- **Type and accessibility.**
  - Inter dynamic metrics: https://d.rsms.me/inter-website/v3/dynmetrics/
  - Utopia `checkWCAG`: https://github.com/trys/utopia-core/blob/main/src/index.ts
  - Chrome font fallback: https://developer.chrome.com/blog/framework-tools-font-fallback/
  - APCA: https://github.com/Myndex/SAPC-APCA/blob/master/documentation/APCA_in_a_Nutshell.md
  - Material color spec: https://github.com/material-foundation/material-color-utilities/blob/main/typescript/dynamiccolor/color_spec_2021.ts
  - WCAG 2.2: https://www.w3.org/TR/WCAG22/ and the w3c/wcag sources (SC 1.4.3, 1.4.8, 1.4.10, 1.4.11, 1.4.12, 1.4.13, 2.4.11, 2.4.13, 2.5.5, 2.5.8, technique C40) linked inline
  - MDN env(): https://developer.mozilla.org/docs/Web/CSS/env
  - WebKit bug 281071: https://bugs.webkit.org/show_bug.cgi?id=281071
  - React ViewTransition: https://react.dev/reference/react/ViewTransition
- **Information architecture (read through search excerpts).**
  - NN/g, Progressive disclosure: https://www.nngroup.com/articles/progressive-disclosure/
  - NN/g, Tabs vs. accordions: https://www.nngroup.com/videos/tabs-vs-accordions/
  - NN/g, Accordions on desktop: https://www.nngroup.com/articles/accordions-on-desktop/
  - NN/g, Scrolling and attention (57 % of viewing time above the fold, 74 % in the first two screens): https://www.nngroup.com/articles/scrolling-and-attention/
  - NN/g, Hidden navigation on mobile: https://www.nngroup.com/articles/find-navigation-mobile-even-hamburger/
  - NN/g, Skeleton screens: https://www.nngroup.com/articles/skeleton-screens/
