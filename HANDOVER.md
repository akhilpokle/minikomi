# Mini-Zine Maker — Handover / Spec

## 1. What it is
A tool where users add photos, arrange and crop them, then export a print-ready
A4 PDF of a classic 8-page mini-zine (one A4 sheet, folded three times + one
center cut).

**Non-goals:** no accounts, no cloud, no uploads/persistence, exactly 8 pages
(no unlimited photos / no gallery pool).

## 2. Scope
- **MVP 1 = desktop only** — hover-based controls are fine.
- **MVP 2 (later, deferred):** iPad/mobile responsiveness + tap-to-select controls.

## 3. Core model
- Single surface, the grid is the hero — no two-column split, no separate tray.
- Bottom-center toggle switches two modes, alongside the orange **PRINT IT** button:
  - **Arrange** (grid icon): overview of all 8 pages → reorder (drag), add, remove/replace.
  - **Refine** (book icon): two-page-spread booklet → flip left/right + crop/pan/zoom
    each image (shown flat & large while editing).
- Division of labor: structural moves in Arrange, precision work in Refine.

## 4. The 8 pages
- Fixed 8 slots, always present; empty ones show "Upload pic" placeholders.
  Keeps the fold valid at all times.
- Slot 1 = Cover, pinned (cannot be dragged; no drag handle). Holds an optional
  photo + editable Title / Sub title — flexible: photo, text, or both; nothing required.
- All other pages (including the back) are freely reorderable.
- Empty pages are kept customizable by design — users may leave them blank or
  style them; don't force a photo.
- Aspect ratio: **4:5** for every page.
- Deleting a photo returns the slot to an empty placeholder (grid never
  collapses below 8).

## 5. Interactions
- **Add:** bulk drop auto-fills empty slots in order and per-slot "Upload pic."
  Capped at 8.
- **Filled-slot controls** (desktop hover toolbar): Drag · Delete · Replace
  - The whole tile is draggable — the handle is just a signifier.
  - Third icon is Replace only (no crop here).
  - All icons need tooltips — must be stated in the prompt.
- **Empty-slot control:** upload only.
- **Reorder:** drag tiles in Arrange; cover stays pinned, everything else moves.
- **Crop / pan / zoom:** Refine (book) mode only — 4:5 locked, with a reset.
- **Booklet:** a real two-page spread that flips in 3D — a fanned deck of 4
  leaves, reading order 1→8. A horizontal **scrub bar** under it drives the flip:
  dragging turns the page continuously under the pointer and releases to the
  nearest spread. Its labels (`Cover · 1–2 · 3–4 · 5–6 · 7`) double as the
  position indicator and as jump targets. No prev/next arrows.

### As built in Refine (phase 4)
- Click (or Enter/Space on) a filled page to open it flat and large; **Done**
  returns to the spread.
- In the editor: drag to pan, scroll to zoom, zoom slider, **Reset**.
  Zoom range 1–4. Empty pages still take an upload; the cover's title fields
  stay live so the photo can be framed around the text.
- Refine deliberately has **no** drag / delete / replace — structural moves stay
  in Arrange (§3).

## 6. First-run / empty state
- Non-blocking inline hint (hand-drawn "add your pics" style). No modal, no
  banner-as-CTA.
- The empty grid + per-slot "Upload pic" is the primary cue; the whole canvas
  is a drop target.

## 7. Print / PDF
- **PRINT IT** → generates the imposed A4 PDF: top row rotated 180°,
  single-sided, folds to read 1→8; photos rendered with their 4:5 crops;
  cover text baked in; ~300 DPI. Empty slots export blank.
- Fold-and-cut instructions are shown when the user clicks PRINT IT. Built in
  6b as a five-step modal; PRINT IT opens it, and the PDF downloads from inside.
- PRINT IT is disabled until ≥1 photo is placed.
- Pages stay **4:5**, which does not match the 1:√2 A4 eighth. The page is
  centred in its cell and the leftover prints as head/foot padding — decided
  2026-07-30 in preference to re-cropping what the user framed in Refine.
- Each cell carries a **5mm content-safe inset**. The cell *grid* still spans the
  full sheet, because paper is folded edge-to-edge and the creases have to land
  on the sheet's true midlines; the inset is what keeps content clear of the cut
  line and of whatever a non-borderless printer trims.

## 8. Privacy & state
- Fully ephemeral — nothing persists; images never leave the device.
- Refresh/close warning ("you'll lose your zine").

## 9. Tech
- Vanilla HTML/CSS/JS, no framework/build step (a light file split is fine for
  phased dev).
- jsPDF via CDN allowed (app code only; user images never uploaded).

## 10. Visual language
- Monospace UI + italic display title, light dotted-grid background, thin
  borders with a contrast bump (so it doesn't read as half-loaded), a single
  orange accent reserved for the primary action.
- Tooltips on all icon controls.
- (The faint background shapes in the mocks are a watermark — ignore.)

## 11. Build process (MVP 1)
Phased; Claude stops for review after each phase:

1. ✅ Static frontend — full UI, no logic, placeholder images
   (+ grid sizes itself to always fit the viewport, no scrolling)
2. ✅ Add / remove / replace
3. ✅ Drag-to-reorder
4. ✅ Crop in Refine (book) mode
   (+ the Arrange↔Refine toggle now switches views; spread view with basic
   prev/next so every page is reachable)
5. ✅ Booklet navigation — horizontal scrub bar replaces the prev/next arrows
   and the planned arrow-key nav; it is also the spread indicator
6. **a** ✅ A4 PDF export with imposition
   **b** ✅ Fold-and-cut instructions — interactive step-through modal on print
7. ✅ 3D page flip — fanned deck driven by the scrub bar; carries the page-turn
   feel moved out of phase 5. Ported from a spec the user supplied from another
   project, extended to run continuously off the scrub bar.
8. ✅ Seamless turn — pile-relative depth. Fixes a mid-turn tear at the gutter
   that phase 7 shipped with. Built from a 17-frame storyboard the user supplied
   2026-07-30. Also added the dev flip tuner (`#tune`).

Deferred to MVP 2: iPad/mobile responsiveness + tap-to-select.
Deferred out of phase 8: the pages' *curvature* (§ Phase 8 notes).

## 12. Assets
- [x] Arrange-mode mockup (grid screenshot) — Phase 1 built from it
- [x] Icon SVGs — `assets/images/`: container (grid), book-open, drag, delete,
      replace. `replace.svg` landed 2026-07-30 (framed-photo glyph, 16×16
      viewBox — the others are 24×24); the temporary inline `REPLACE_ICON` it
      stood in for is gone.
- [x] `paper_background.png` — tiled at 40% over `#fafafa`
- [x] Imposition diagram (page→cell map, top row 180°) — supplied 2026-07-30,
      encoded as `IMPOSITION` in script.js. **Note its cells are numbered from
      the back page** (the cell marked `1` is also marked BACK PAGE, `2` is
      FRONT PAGE); see the comment above `IMPOSITION` for the reconciliation.
- [x] Fold-and-cut instruction copy — drafted in 6b (`FOLD_STEPS` in script.js),
      not supplied. Edit the wording there; it's five plain strings.
- [x] Refine/booklet mode mockup — none supplied; phases 4–5 derived the surface
      (spread, crop editor, scrub bar) from the Arrange visual language. Send one
      if it should look different.
- [x] Paper spec — A4 landscape, 5mm cell inset, 300 DPI (decided 2026-07-30)
- [ ] Sample photos, mixed orientations (currently testing with generated images)

Fonts not specified, so: Geist Mono for UI, Caveat for the italic display title
and hint. Swap if you had something else in mind.

## 13. Code map
Four app files at the root, plus three for the flip lab, no build step.

**The flip lab — `/flip.html` + `flip.css` + `flip.js`.** A standalone rig for
experimenting with the booklet flip: a fractional scene slider that parks
anywhere mid-turn, a measured gutter probe, a per-leaf readout, outline and x-ray
modes, and sliders for every flip token. Not linked from the app, reachable only
by URL. Two things make it worth trusting:

- **It does not reimplement the flip.** `flip.js` fetches `script.js` as text and
  links the real `clamp` / `token` / `bury` / `readFlipTokens` / `depthAt` /
  `slotAtDepth` / `applyScene` out of it (see `NEEDS`), so the geometry and the
  whole token pipeline are the shipped ones. Rename any of those and the lab
  throws a visible error rather than quietly testing a stale copy. It also shares
  `styles.css`, so the hinge, transitions and gutter are the real rules too. The
  lab owns only placeholder pages, the transport and the controls.
- **The probe measures rather than models.** It reads each leaf's rendered `left`,
  which *is* the inner edge — the leaf pivots on `transform-origin: left center`,
  so no rotation moves it — and reports the distance to the spine. So it stays
  honest mid-transition and doesn't just restate `slotAtDepth`.

The dependency runs one way: nothing in the app imports the lab.

`script.js` is organised by banner comment — these section names are the reliable
way to navigate it:

| Section | Holds |
|---|---|
| *(top)* | `state` — `pages[8]`, `mode`, `spread`, `editing` — and all DOM refs |
| Photo state | `setPhoto` / `deletePhoto` / `assignPhotos` / `openPicker` |
| Crop | `cropBounds`, `cropTransform`, `applyCrop`, `refreshCropTransforms` |
| Rendering | shared `buildPhotoImg` / `buildLabel` / `buildEmptyPlaceholder`, `renderSlot`, `renderArrange`, and the `render()` dispatcher |
| Reorder | drag-to-reorder; DOM-only during the drag, `commitOrder()` on drop |
| Refine — booklet spread | `SPREADS`, `setMode`, `renderRefine`, `buildPage` |
| Refine — the book | `depthAt`, `slotAtDepth`, `applyScene`, `buildFace`, `buildBook`, `instantly`, `bury`, `liftRange`, `goToSpread` |
| Refine — scrub bar | `spreadFraction` / `spreadLabel` / `spreadAria`, `buildScrubber`, `syncScrubber`, `spreadFromPointer`, pointer + keyboard handlers |
| Refine — crop editor | `openEditor` / `closeEditor`, `renderEditor`, `setZoom`, pointer + wheel handlers |
| Export — sheet geometry | `SHEET_MM`, `CELL_MM`, `CELL_INSET_MM`, `fitPage`, `PAGE_MM/PX`, `IMPOSITION` |
| Export — page composition | `cropSourceRect`, `drawCoverText`, `loadImage`, `composePage` |
| Export — the PDF | `composeAllPages`, `exportPdf` |
| Print — fold guide | `FOLD_STEPS`, `thumbnail`, `arrow` / `scissors`, `buildFoldStage`, `renderFoldStep`, `openPrintModal` / `closePrintModal` |
| Derived chrome | `notify`, `syncChrome`, the `beforeunload` guard |
| Drag and drop | file-drop paths, gated on `dataTransfer` carrying `"Files"` |
| Layout | `fitTiles(availW, availH, cols, rows, gap)` → `layoutSurfaces()` |

Things worth knowing before editing:
- **One render dispatcher.** `render()` routes to Arrange or Refine by
  `state.mode`; call it, not the surface renderers, from state-changing code.
- **`render()` rebuilds the book; flips don't.** `buildBook()` recreates all 4
  leaves and is only reached through `render()`, because page labels and the
  `2j`/`2j+1` leaf pairing are both positional and a reorder has to invalidate
  them. Every flip path goes through `applyScene()`, which writes inline styles
  only. Don't call `buildBook()` from a navigation path.
- **Page labels and spreads are positional**, derived from array index, so
  reordering needs no bookkeeping.
- **Never call `render()` from an async callback** that can land mid-typing — it
  rebuilds the grid and drops focus from the cover inputs. Use
  `refreshCropTransforms()` for repaints.
- **`fitTiles` sizes all three surfaces** from the same `.grid-wrap` box, so
  every mode is correct the moment it becomes visible. `--tile-w/h`,
  `--page-w/h` and `--edit-w/h` are all set from JS.
- **`rotateY(0deg)` on `.leaf-face--front` is load-bearing, not dead code.**
  Inside a `preserve-3d` context the browser only descends hit-testing into
  children carrying their own transform, so a `transform: none` face becomes the
  hit target for its whole subtree. Delete it and the cover's Title/Sub title
  inputs and every "Upload pic" placeholder stop responding on front faces —
  you click and get no caret. The back face gets this free from its `180deg`.
- **Page content is scaled, never resized.** The fan narrows background pages;
  `.page-content` is a box fixed at one page that gets `scale()`d. Sizing it
  directly would re-wrap the cover title on every frame of a flip, because
  `.cover-title` is `calc(var(--tile-w) * 0.092)`. Don't "simplify" it to a
  percentage width.
- **The scrub bar is positioned in percentages, never measured pixels.** It
  lives inside `#refine-browse`, which is `hidden` in Arrange mode and while the
  crop editor is open — a `getBoundingClientRect()` there returns 0 and the
  thumb would collapse to the left edge. Percentages also survive a resize with
  no JS. Same reasoning as the crop transform.
- **`[hidden] { display: none !important }`** in styles.css is load-bearing —
  the surfaces are toggled with the `hidden` attribute and `.grid { display:
  grid }` would otherwise outrank the UA rule.
- Pages reuse the `.slot` class for their treatment and locally override
  `--tile-w`, which is what scales the cover title on larger surfaces.

## Status
All phases complete. Run with `npx http-server . -p 5173` (or the `zine-static`
config in `.claude/launch.json`), then open http://localhost:5173.

Add `#tune` to the URL for the flip tuner (§ Phase 8 notes).

Phase 4 was reviewed and signed off by the user on 2026-07-29.
Phases 5, 6a, 6b, 7 and 8 are built and awaiting review.

### Phase 5 notes
- **One control, two jobs.** The scrub bar navigates *and* indicates position,
  which is why the separate spread indicator from the original phase-5 plan is
  gone. The prev/next arrows are removed entirely.
- **Stops come from `SPREADS`**, evenly spaced, one per spread — nothing about
  the fold layout is duplicated in the bar. `spreadLabel()` reuses the same
  positional `0 → "Cover"`, `n → String(n)` naming as `buildLabel()`, so the
  labels can't drift from the page labels.
- Drag snaps to the nearest stop, so a scrub always lands on a real spread.
  Labels are `<button>`s that jump; the track is a `role="slider"` and supports
  Left/Right/Home/End **only when focused** — the widget being operable, not the
  global arrow-key nav that was explicitly not wanted.
- **The layout reserve moved from horizontal to vertical**: `NAV_RESERVE` (132px
  of arrow gutters) became `SCRUB_RESERVE` (64px under the spread), so spread
  pages now render meaningfully wider.
- `.scrubber` is `calc(var(--page-w) * 2 + var(--spine-gap))` wide, so the bar
  spans exactly the spread and reads as part of the booklet rather than as
  page chrome.
- Orange stays reserved for PRINT IT (§10) — the active stop is `--ink`, and
  orange appears only as the `:focus-visible` ring.
- No page-turn animation: deferred to phase 7 (§11).

### Phase 4 notes
- **Spreads** follow the folded sheet: Cover alone · 1|2 · 3|4 · 5|6 · 7 alone.
  Single pages get a same-sized empty half so the spine never shifts.
- **Crop model** — the decision phase 6 depends on. `crop.zoom` ≥ 1, and
  `crop.x` / `crop.y` are normalized to [-1, 1]: a fraction of the maximum legal
  offset, **not pixels**. Rendering keeps `object-fit: cover` and layers
  `translate(…%, …%) scale(zoom)` on top.

  Because the translation is a percentage of the frame, one stored crop renders
  correctly in a thumbnail, a spread page and the editor, and survives a resize
  with no JS. Clamping is just `clamp(v, -1, 1)`, so the image can never uncover
  the frame — zooming out pulls the framing back inside the bounds on its own.
  `{zoom:1, x:0, y:0}` is the identity transform, so an untouched photo renders
  exactly as it did in phases 1–3.
- Non-4:5 photos can pan at zoom 1 (cover-fit already overflows one axis); an
  exact 4:5 photo is locked until zoomed, and the cursor reflects that.
- Source dimensions are probed asynchronously. Until they land, `cropBounds()`
  treats the photo as exactly filling the frame, which renders identically to
  plain cover-fit — so a slow decode degrades invisibly.
- Also in this phase: `layoutGrid` became `fitTiles` + `layoutSurfaces`, which
  fixed a latent bug where `.grid-wrap`'s 80px horizontal padding was counted as
  available width. Filled Refine pages got `role="button"` / `tabindex` /
  Enter-Space to match the empty placeholders.

### Phase 6a notes
- **Geometry.** Cell 74.25×105mm; minus the 5mm inset, the largest 4:5 page that
  fits is **64.25×80.31mm**, width-constrained. The 14.69mm of vertical slack is
  split evenly → 12.34mm at head and foot. Nothing runs off the sheet (max
  extent 292×197.7mm).
- **Page raster is 760×950px**, rounded to a multiple of 4 so 4:5 survives as
  whole pixels (300.5 effective DPI). This matters: at 759×950 the frame ratio
  drifts to 0.7998, and cover-fit would then bind on the *width* for an
  exactly-4:5 photo and leave a hairline gap along the bottom edge.
- **`cropSourceRect` inverts the on-screen render** — `object-fit: cover` plus
  `translate(…%) scale(zoom)` — into a source-pixel rect. It calls the existing
  `cropBounds()` rather than re-deriving the bounds; if those two ever diverged,
  the print would be framed differently from Refine and nothing on screen would
  show it. Verified against an independent projection of the CSS transform
  across 11 aspect/zoom/pan cases (exact 4:5, panorama, extreme pan, max zoom,
  upscaled tiny source) — all matched to floating-point precision.
  Cover-fit scale comes from the frame's real pixel dimensions, not nominal 4:5.
- **Rotation happens at compose time**, not in jsPDF, so imposition is pure
  placement. The cover is in the bottom row and is never rotated.
- **Cover text is rasterised** onto the page canvas rather than set as PDF text,
  which avoids embedding a font binary and guarantees it matches the screen.
  Every dimension is a fraction of page width, as the CSS does it. Gated on
  `document.fonts.ready`, or the fallback monospace gets baked in. Placeholders
  never print. One approximation: the scrim's inset is fixed px in CSS, so it's
  scaled against the 220px reference tile.
- Photo pages export as JPEG q0.92, text-only and blank pages as PNG — crisp
  type where it's free, small files where it isn't.
- `setPhoto`'s async dimension probe is self-healed in `composePage`, so an
  export fired moments after a drop still measures the real photo.

### Phase 6b notes
- **PRINT IT now opens the guide, not a download.** The modal composes the pages
  in the background and the primary button becomes DOWNLOAD PDF when they land.
  So instructions come first, and re-reading them doesn't re-download.
- **`composeAllPages()` is shared** by the diagram and the PDF, so the guide
  shows the user's real sheet and a download after browsing costs nothing extra.
  Recomposed on every open, so the guide can never show a stale zine — cheaper
  than getting cache invalidation right for eight canvases.
- **One SVG holds every step's layer**, cross-faded via CSS off `data-step`. The
  eight thumbnails are therefore encoded once, and transitions are free. The
  sheet, the folded strip and the booklet are *separate groups* rather than one
  morphing shape — flat, legible, and nothing to break across browsers. True
  perspective folding is phase 7's job.
- **The diagram is drawn in millimetres** (`viewBox="0 0 297 210"`), so cells,
  creases and the cut line are placed straight from the export constants and
  can't drift from what prints. Verified all layers sit inside the viewBox.
- Marks carry a **white halo** (`.fs-halo`, `.fs-glyph-halo`) — an ink arrow or
  cut line over a dark photo is otherwise invisible.
- **Step 4's instruction folds the top half *behind* the sheet.** Folding it
  forward puts the two printed sides face-to-face, which gives a booklet with
  blank covers. Easy to get backwards in the copy.
- Escape closes, the backdrop closes on mousedown, Tab is trapped in the dialog,
  and focus is restored to PRINT IT. `renderFoldStep()` moves focus off Back/Next
  before disabling it, or focus would fall to `<body>` and take the tab trap and
  Escape with it.
- `isFileDrag()` returns false while the modal is open, so a stray drop can't
  edit the zine behind a guide that's showing the old sheet.
- Copy lives in `FOLD_STEPS` as five plain strings — the wording was drafted
  here, not supplied, so it's meant to be edited.

### Phase 7 notes
Ported from a fanned-deck flip-book spec the user supplied from another project,
then extended so the scrub bar drives it continuously.

- **Leaf `j` carries page `2j` on its front and `2j+1` on its back**, which
  reproduces `SPREADS` exactly — verified scene by scene. 4 leaves, 5 scenes,
  `LEAF_COUNT === SPREADS.length - 1`. `SPREADS` stays the source of truth for
  the scrub bar; the book derives everything else from it.
- **Nothing is tabulated.** Every position comes from `depth` — how many pages
  sit in front of this one on its own side of the spine. `i - 1 - j` for turned
  leaves is what lands the most recently turned leaf flush at the spine.
- **Simpler than the source spec:** Minikomi has no `card-open`/`card-end`, since
  all 8 pages are leaf faces, so `depthAt` is the leaf branch alone and
  `slotAtDepth` has two cases rather than three. `buildGhost()` is gone —
  `.book-paper` holds the spine still instead, so an empty half now shows paper
  rather than nothing.
- **Continuous flip is the one departure from the spec**, which deliberately
  writes rest states only. A fractional scene (`t = 2.37`) works because of two
  facts, both verified numerically:
  1. the turning leaf sits at depth 0 on *both* sides, so its `left` and `width`
     are identical before and after — **only `rotateY` interpolates**, and the
     side-swap is carried entirely by the rotation;
  2. every other leaf shifts depth by exactly ±1 and never changes side, so its
     position is a plain lerp inside one side's formula.
- **z-index comes from the integer scene, never interpolated** — a fractional z
  would round and pop mid-turn. The turning leaf rides at `z: 100` instead, or it
  sweeps *through* the stack rather than over it.
- **No input lock.** The source's `isFlipping` would reject all but the first of
  a drag's crossings. CSS transitions retarget mid-flight natively; `flipGen`
  guards the settle timer so a stale one can't clobber a newer flip.
- `liftRange()` handles multi-scene jumps, which turn several leaves at once and
  read as a riffle. Ordered so the leaf ending on top of its side is highest.
- **Two values that could not be copied from the spec.** Perspective is set from
  JS as 3.5× page width — the source's fixed `1200px` was tuned for a 340px page
  and over-distorts Minikomi's ~580px one. Duration is 400ms, not 700ms: 700
  feels slow for 8 pages and much slower again while scrubbing.
- **Layout.** The fan overhangs the resting spread, so the book is wider than two
  pages and `.grid-wrap` would otherwise clip it. *(Phase 8 changed the numbers:
  the overhang is now `(MAX_DEPTH - 1) * (FAN_X - FAN_W) = 0.025` of a page each
  side and `BOOK_SPAN = 2.05`, because pile depth collapses the top two pages of
  each pile. It was `MAX_DEPTH * … = 0.0375` and `2.075`.)*
  `fitTiles` takes that as a *fractional* column count and needed no changes.
  Costs ~3% of page width — not the ~11% first estimated, which wrongly ignored
  that pages narrow as they recede.
- **A bug the persistent DOM introduced.** The cover's fields now live in up to
  three places at once (Arrange tile, book cover face, crop editor) and none is
  rebuilt on a flip, so `syncCoverText()` pushes edits to the others, skipping
  the focused one. Previously the per-flip rebuild hid this.
- **A wart it removed:** the cover's inputs used to be destroyed and recreated on
  every flip, losing focus.
- `bury()` sets `inert` *and* an `.is-buried` class — `inert` does the tab order
  and accessibility tree, the class is a `pointer-events` net for browsers
  without it, so a fanned-back page can never open its crop editor.
- `endScrub()` forces a reflow after removing `.is-scrubbing` and before writing
  the target, or the browser can coalesce both changes and skip the animation
  home.

### Phase 8 notes — pile-relative depth
Phase 7 shipped a real defect: mid-turn, a band of `.book-paper` showed through at
the spine. The user caught it, then supplied a 17-frame storyboard of the
behaviour they wanted.

- **The cause was not the fan.** `depthAt` re-ranks the two leaves flanking the
  turning one — they swap depth 0 and 1 across a turn — so the page about to be
  revealed spent the spread *fanned back*, smaller and off the spine, and had to
  grow into place while the page opposite receded out of it. With the turning leaf
  edge-on at the midpoint it covered neither, exposing
  `FAN_X_RATIO` of a page width (25.4px at `pageW = 580`).
- **The fix is one line of geometry.** `slotAtDepth` derives its box from
  **pile depth** `v = max(0, d - 1)`, which puts the top *two* pages of each pile
  on the same box — full size, inner edge exactly on the spine. So the revealed
  page is already in its final place and gets *uncovered* rather than grown, and
  its opposite number stays put. Verified 0px exposure on every side that has a
  page, at the original fan settings.
- **The fan survives.** It now only ever applies to pages already hidden behind a
  full-size one, so it cannot open the gutter. Two earlier conclusions in this
  file's history were wrong and are worth not re-deriving: that a visible fan and
  a sealed gutter are mutually exclusive (they are not — only *re-ranking the
  spread pages mid-turn* forces the gap), and that the fix required subdividing
  pages into strips.
- **`slot.d` stays the TRUE depth.** `z-index` and `bury()` both read it. Collapse
  those onto pile depth as well and the covered top-of-pile page sorts level with
  the page covering it and stays reachable by click and Tab.
- **`--paper-z` is load-bearing, not decoration.** Pile depth deliberately makes
  two leaves per side coplanar, and coplanar quads inside `preserve-3d` are
  depth-sorted by real 3D position rather than `z-index` — they stitch and
  flicker. `applyScene` writes `translateZ(-PAPER_Z * trueDepth)`, ~0.5px, which
  breaks the tie and reads as paper thickness. Depth 0 gets no offset, and
  perspective scales about the spine — where these pages' inner edges already
  sit — so the cost is nil.
- **`.book-paper` stopped being a patch.** With the gutter sealed its jobs are the
  empty half of a single-page spread (Cover alone, page 7 alone) and the crease.
  Hence near-white rather than the dark tint an earlier pass gave it, plus a tight
  shaded band on the spine only.
- **The first and last turns still expose one half**, by construction — there is
  no page on that side yet. That is correct book behaviour, not a regression.
- **Not done: the pages are flat.** The storyboard's pages are *curved* — bowed at
  rest as well as mid-turn — and CSS cannot bend a quad. Either subdivide each
  face into strips (real curvature, but it needs N clipped copies of each photo
  and a re-derived `cropSourceRect`, or the print silently diverges from the
  screen) or fake it with a gradient that reads as curvature. Deferred
  deliberately: with the gutter sealed this is purely aesthetic. The `.leaf-hinge`
  wedge is a crude two-panel stand-in and matches the storyboard's thin centre
  sliver at the edge-on frame.
- **Dev tuner.** `#tune` in the URL builds a slider panel for every flip token;
  COPY yields a paste-ready `:root` block. Scaffolding, gated so it cannot reach a
  user, and confined to one clearly-marked section in each of script.js and
  styles.css. It exists because half these tokens are read by JS once at load, so
  devtools edits silently did nothing — `readFlipTokens()` re-reads them.

### Phase 7 addendum — hinge structure, cross-checked against a second reference
The user supplied a second flip-book reference (a rigid hard-page / board-book
style, no paper curl) for comparison. Reviewed for its **hinge mechanism only** —
its other three mechanics (directional shade, cast shadow, camera `rotateX`
tilt) were considered and **explicitly declined**; don't re-propose them.

The hinge is what turns a single animated property into a page that looks solid
and readable on both sides, and it's the same mechanism in both projects:

- **Pivot at the spine.** `transform-origin: left center` on the leaf itself,
  positioned so that edge sits exactly on the spine. Everything about the flip
  reduces to rotating this one element.
- **One rotation drives the whole flip** — resting-right to resting-left
  (`0° → -180°` in the reference; `ROT_RIGHT → ROT_FLIPPED` here, i.e.
  `-5° → -175°`, short of a full half-turn because `BOOK_TILT` is baked into the
  rest angles rather than left flat).
- **The back face is pre-rotated 180° in the markup**, so that once the leaf
  itself has swung -180°, the back face's *net* rotation is 0° — right-way-round
  and readable, not mirrored.
- **Both faces set `backface-visibility: hidden`.** Combined with the
  pre-rotation above, exactly one face is ever camera-facing at any rotation —
  this is what makes the flip read as solid paper instead of a transparent pane
  with two images bleeding through each other.

All four of those are already exactly what `.leaf` / `.leaf-face--front` /
`.leaf-face--back` do (styles.css) and what `slotAtDepth`/`applyScene`
(script.js) drive. The reference's version is a simpler *two-pile* stack with no
fan; Minikomi's leaves additionally move through a continuum of `left`/`width`
for the fan. But for the one leaf actually turning at any instant, its `left`
and `width` don't change through its own turn (§ Phase 7 notes above) — so the
turning leaf's flip already reduces to exactly this same core mechanism. **No
structural change follows from this review; it confirms what's built.**

### Phase 6 groundwork (already in place)
- Every photo carries `width` / `height` (natural pixels) plus its crop, which
  is all the export needs: cover-fit + zoom + normalized offsets converts to a
  source-pixel rect without re-deriving anything.
- Empty pages and cover text are already distinguishable in state
  (`page.photo === null`, `page.title` / `page.subtitle`).

**All phases are built, and phase 7 is closed with no further work identified.**
Its hinge mechanism was cross-checked against a second reference and confirmed
to already match; that reference's shading/cast-shadow/camera-tilt embellishments
were reviewed and declined — don't revisit them without the user raising it
again. What's left is your review, plus MVP 2 (iPad/mobile responsiveness +
tap-to-select), which §2 defers.

**Next step — verification, not more building:**
1. **Print one single-sided at actual size**, fold it, and confirm it reads 1→8.
   The one test only paper can settle.
2. **Read the five `FOLD_STEPS` strings** (script.js) while actually folding —
   the copy was drafted here, not supplied, and instruction wording is easy to
   get subtly backwards (§ Phase 6b notes already caught one).
3. **Supply sample photos, mixed orientations** — phase 6 was verified against
   generated images plus the numeric crop checks in § Phase 6a notes, not real
   photos.
4. **Try the phase 7 flip itself** — drag the scrub bar, click a distant label,
   type into the cover fields on a front-facing page. None of this has been
   opened in a browser by Claude — by design, testing is the user's pass.
