// COMPLETE (phases 1-7) — add / remove / replace, drag-to-reorder, Refine mode
// (a 3D booklet flipped by the scrub bar, plus crop/pan/zoom a page flat), the
// imposed A4 PDF, and the five-step fold-and-cut guide.
//
// Photos are held only as in-memory object URLs. Nothing is uploaded, and
// nothing survives a refresh.

const PAGE_COUNT = 8;

const state = {
  pages: Array.from({ length: PAGE_COUNT }, (_, i) =>
    i === 0
      ? { id: "p0", isCover: true, title: "", subtitle: "", photo: null }
      : { id: `p${i}`, photo: null }
  ),
  mode: "arrange", // | "refine"
  spread: 0, // index into SPREADS
  editing: null, // page index open in the crop editor, or null
};

// photo = { url, name, width, height, crop: { zoom, x, y } }

const grid = document.getElementById("grid");
const fileInput = document.getElementById("file-input");
const printBtn = document.getElementById("print-btn");
const noticeEl = document.getElementById("notice");
const hintEl = document.querySelector(".hint");

const modeBtns = Array.from(document.querySelectorAll(".mode-btn"));
const refineEl = document.getElementById("refine");
const browseEl = document.getElementById("refine-browse");
const bookEl = document.getElementById("book");
const editorEl = document.getElementById("editor");
const editorFrame = document.getElementById("editor-frame");
const scrubTrack = document.getElementById("scrub-track");
const scrubFill = document.getElementById("scrub-fill");
const scrubThumb = document.getElementById("scrub-thumb");
const scrubLabels = document.getElementById("scrub-labels");
const zoomSlider = document.getElementById("zoom-slider");
const cropReset = document.getElementById("crop-reset");
const cropDone = document.getElementById("crop-done");

// Which upload the picker is currently serving.
let pendingIntent = null; // { mode: "fill" | "replace", index }

/* ==========================================================================
   Photo state
   ========================================================================== */

function photoCount() {
  return state.pages.filter((p) => p.photo).length;
}

function hasContent() {
  const cover = state.pages[0];
  return (
    photoCount() > 0 ||
    cover.title.trim() !== "" ||
    cover.subtitle.trim() !== ""
  );
}

function setPhoto(index, file) {
  const page = state.pages[index];
  if (page.photo) URL.revokeObjectURL(page.photo.url);

  const url = URL.createObjectURL(file);
  const photo = {
    url,
    name: file.name,
    width: 0,
    height: 0,
    crop: { zoom: 1, x: 0, y: 0 },
  };
  page.photo = photo;

  // The crop maths need the source aspect ratio, and phase 6 export needs the
  // pixel dimensions. Until the probe resolves, cropBounds() treats the photo
  // as exactly filling the frame, which renders identically to plain cover-fit.
  const probe = new Image();
  probe.onload = () => {
    photo.width = probe.naturalWidth;
    photo.height = probe.naturalHeight;
    // Repaint transforms in place rather than re-rendering: a full render()
    // here would blow away a focused cover input.
    refreshCropTransforms();
  };
  probe.src = url;
}

function deletePhoto(index) {
  const page = state.pages[index];
  if (!page.photo) return;
  URL.revokeObjectURL(page.photo.url);
  page.photo = null;
  render();
  syncChrome();
}

/**
 * Routes a set of dropped/picked files into pages.
 * - replace: swaps the photo at startIndex, first file only
 * - fill: startIndex (when empty) first, then remaining empties — forward
 *   from startIndex before wrapping — so picking 3 photos on page 5 fills
 *   5, 6, 7 rather than jumping back to the start.
 */
function assignPhotos(fileList, startIndex, mode) {
  const all = Array.from(fileList || []);
  const files = all.filter((f) => f.type.startsWith("image/"));

  if (files.length === 0) {
    if (all.length > 0) notify("Only image files can be added.");
    return;
  }

  if (mode === "replace" && typeof startIndex === "number") {
    setPhoto(startIndex, files[0]);
    render();
    syncChrome();
    return;
  }

  const targets = [];
  if (typeof startIndex === "number") {
    if (!state.pages[startIndex].photo) targets.push(startIndex);
    for (let step = 1; step <= PAGE_COUNT; step++) {
      const i = (startIndex + step) % PAGE_COUNT;
      if (!state.pages[i].photo && !targets.includes(i)) targets.push(i);
    }
  } else {
    // Bulk drop with no target slot: straight ascending, cover first.
    for (let i = 0; i < PAGE_COUNT; i++) {
      if (!state.pages[i].photo) targets.push(i);
    }
  }

  if (targets.length === 0) {
    notify("All 8 pages are full — delete or replace one first.");
    return;
  }

  const used = Math.min(files.length, targets.length);
  for (let i = 0; i < used; i++) setPhoto(targets[i], files[i]);

  const skipped = files.length - used;
  if (skipped > 0) {
    notify(`Only 8 pages — ${skipped} photo${skipped > 1 ? "s" : ""} skipped.`);
  }

  render();
  syncChrome();
}

function openPicker(index, mode) {
  pendingIntent = { mode, index };
  fileInput.multiple = mode !== "replace";
  fileInput.click();
}

fileInput.addEventListener("change", () => {
  const intent = pendingIntent || { mode: "fill", index: null };
  assignPhotos(fileInput.files, intent.index, intent.mode);
  pendingIntent = null;
  // Without this, picking the same file twice in a row never fires `change`.
  fileInput.value = "";
});

/* ==========================================================================
   Crop
   ==========================================================================
   `crop.zoom` is >= 1 and `crop.x` / `crop.y` are normalized to [-1, 1] — a
   fraction of the maximum legal offset, not pixels. Rendering keeps the
   existing object-fit: cover and layers a transform on top of it.

   Normalizing buys three things:
   - Percentage translations resolve against the frame, so one stored crop
     renders correctly in a 220px thumbnail and a 600px editor, and survives a
     resize with no JS.
   - Clamping is just clamp(v, -1, 1); the image can never uncover the frame.
   - { zoom: 1, x: 0, y: 0 } is the identity transform, so an untouched photo
     renders exactly as it did before this phase.
   ========================================================================== */

const FRAME_AR = 4 / 5;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * How far the image may travel on each axis, as a fraction of the frame.
 * Under cover-fit a non-4:5 photo already overflows one axis at zoom 1, so
 * panning works before the user zooms at all.
 */
function cropBounds(photo) {
  const imgAR = photo.width && photo.height ? photo.width / photo.height : FRAME_AR;
  const zoom = photo.crop.zoom;
  return {
    x: Math.max(0, ((Math.max(1, imgAR / FRAME_AR) * zoom) - 1) / 2),
    y: Math.max(0, ((Math.max(1, FRAME_AR / imgAR) * zoom) - 1) / 2),
  };
}

function cropTransform(photo) {
  const bounds = cropBounds(photo);
  const { zoom, x, y } = photo.crop;
  return `translate(${x * bounds.x * 100}%, ${y * bounds.y * 100}%) scale(${zoom})`;
}

function applyCrop(img, photo) {
  img.style.transform = cropTransform(photo);
}

// Re-applies transforms to whatever is on screen, without a re-render.
function refreshCropTransforms() {
  const byId = new Map(state.pages.map((p) => [p.id, p]));
  document.querySelectorAll("img[data-page-id]").forEach((img) => {
    const page = byId.get(img.dataset.pageId);
    if (page && page.photo) applyCrop(img, page.photo);
  });
}

/* ==========================================================================
   Rendering
   ========================================================================== */

function buildToolbar(index, page) {
  const toolbar = document.createElement("div");
  toolbar.className = "slot-toolbar";

  // The cover is pinned — it never gets a drag handle.
  if (!page.isCover) {
    const drag = document.createElement("button");
    drag.type = "button";
    drag.className = "btn-drag";
    drag.setAttribute("data-tip", "Drag to reorder");
    drag.innerHTML = `<img src="assets/images/drag.svg" alt="Drag to reorder" draggable="false" />`;
    // Only a signifier — the whole tile is the drag surface.
    toolbar.appendChild(drag);
  }

  const replace = document.createElement("button");
  replace.type = "button";
  replace.setAttribute("data-tip", "Replace");
  replace.setAttribute("aria-label", "Replace photo");
  replace.innerHTML = `<img src="assets/images/replace.svg" alt="Replace photo" />`;
  replace.addEventListener("click", (e) => {
    e.stopPropagation();
    openPicker(index, "replace");
  });
  toolbar.appendChild(replace);

  const del = document.createElement("button");
  del.type = "button";
  del.setAttribute("data-tip", "Delete");
  del.setAttribute("aria-label", "Delete photo");
  del.innerHTML = `<img src="assets/images/delete.svg" alt="Delete photo" />`;
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    deletePhoto(index);
  });
  toolbar.appendChild(del);

  return toolbar;
}

function buildCoverText(page) {
  const wrap = document.createElement("div");
  wrap.className = "cover-text";

  const title = document.createElement("input");
  title.type = "text";
  title.className = "cover-input cover-title";
  title.placeholder = "Title";
  title.value = page.title;
  title.setAttribute("aria-label", "Zine title");

  const subtitle = document.createElement("input");
  subtitle.type = "text";
  subtitle.className = "cover-input cover-subtitle";
  subtitle.placeholder = "Sub title";
  subtitle.value = page.subtitle;
  subtitle.setAttribute("aria-label", "Zine sub title");

  // Deliberately no re-render here: rebuilding the grid on each keystroke
  // would blow away the focused input.
  title.addEventListener("input", () => {
    page.title = title.value;
    syncCoverText(page);
  });
  subtitle.addEventListener("input", () => {
    page.subtitle = subtitle.value;
    syncCoverText(page);
  });

  // Clicks inside the fields must not reach the slot's upload handler.
  wrap.addEventListener("click", (e) => e.stopPropagation());

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  return wrap;
}

/**
 * The cover's fields now exist in up to three live places at once — the Arrange
 * tile, the book's cover face and the crop editor — and none of them is rebuilt
 * on a flip any more, so an edit in one has to be pushed to the others. The
 * focused field is skipped, or typing would fight the caret.
 */
function syncCoverText(page) {
  document
    .querySelectorAll(".cover-title, .cover-subtitle")
    .forEach((input) => {
      if (input === document.activeElement) return;
      const value = input.classList.contains("cover-title")
        ? page.title
        : page.subtitle;
      if (input.value !== value) input.value = value;
    });
}

/* The three pieces below are shared by the Arrange grid, the Refine spread and
   the crop editor, so a page looks and behaves the same on every surface. */

function buildPhotoImg(page) {
  const img = document.createElement("img");
  img.className = "slot-photo";
  img.src = page.photo.url;
  img.alt = "";
  // Lets refreshCropTransforms() find this element again without a re-render.
  img.dataset.pageId = page.id;
  // Images are natively draggable and would otherwise hijack the tile drag.
  img.draggable = false;
  applyCrop(img, page.photo);
  return img;
}

// Labels are derived from position, so phase 3 reordering keeps them correct
// with no extra bookkeeping.
function buildLabel(index) {
  const label = document.createElement("span");
  label.className = "slot-label";
  label.textContent = index === 0 ? "Cover" : String(index);
  return label;
}

function buildEmptyPlaceholder(index) {
  const empty = document.createElement("div");
  empty.className = "slot-empty";
  empty.setAttribute("role", "button");
  empty.setAttribute("tabindex", "0");
  empty.setAttribute(
    "aria-label",
    index === 0 ? "Upload cover photo" : `Upload photo for page ${index}`
  );
  empty.innerHTML = `<span>Upload pic</span>`;
  empty.addEventListener("click", () => openPicker(index, "fill"));
  empty.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker(index, "fill");
    }
  });
  return empty;
}

function renderSlot(page, index) {
  const el = document.createElement("div");
  el.className = "slot";
  if (page.isCover) el.classList.add("slot-cover");
  if (page.photo) el.classList.add("slot--filled");
  el.dataset.index = String(index);
  el.dataset.id = page.id;

  if (page.photo) el.appendChild(buildPhotoImg(page));
  el.appendChild(buildLabel(index));
  if (page.isCover) el.appendChild(buildCoverText(page));

  if (!page.photo) {
    el.appendChild(buildEmptyPlaceholder(index));
  } else {
    el.appendChild(buildToolbar(index, page));
    attachReorder(el, page);
  }

  return el;
}

function renderArrange() {
  grid.innerHTML = "";
  state.pages.forEach((page, i) => grid.appendChild(renderSlot(page, i)));
}

function render() {
  if (state.mode === "arrange") renderArrange();
  else renderRefine();
}

/* ==========================================================================
   Reorder (drag tiles in Arrange)
   ========================================================================== */

// A custom MIME keeps reorder drags out of the file-drop path, which gates on
// dataTransfer carrying "Files".
const REORDER_MIME = "application/x-minikomi-page";

let draggedId = null;
let didDrop = false;

/**
 * Only the DOM is touched while dragging; state is committed on drop. A
 * cancelled drag (Esc, or released off-grid) therefore just re-renders from
 * untouched state, which restores the original order for free.
 */
function attachReorder(el, page) {
  // The cover is pinned, and empty tiles are upload targets rather than
  // drag sources — every arrangement is still reachable by moving photos.
  if (page.isCover || !page.photo) return;

  el.draggable = true;

  el.addEventListener("dragstart", (e) => {
    draggedId = page.id;
    didDrop = false;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(REORDER_MIME, page.id);
    document.body.classList.add("is-reordering");
    // Deferred so the drag image is captured before the tile dims.
    requestAnimationFrame(() => el.classList.add("is-dragging"));
  });

  el.addEventListener("dragend", () => {
    el.classList.remove("is-dragging");
    document.body.classList.remove("is-reordering");
    if (!didDrop) render();
    draggedId = null;
  });
}

// Labels and indices are positional, so they have to follow the live DOM
// moves — otherwise a mid-drag file drop would target the wrong page.
function refreshPositions() {
  Array.from(grid.children).forEach((el, i) => {
    el.dataset.index = String(i);
    const label = el.querySelector(".slot-label");
    if (label) label.textContent = i === 0 ? "Cover" : String(i);
  });
}

grid.addEventListener("dragover", (e) => {
  if (!draggedId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";

  const dragged = grid.querySelector(`[data-id="${draggedId}"]`);
  const target = e.target.closest && e.target.closest(".slot");
  if (!dragged || !target || target === dragged) return;

  const coverEl = grid.firstElementChild;
  if (target === coverEl) {
    // Position 0 is reserved for the cover; the closest legal slot is 1.
    grid.insertBefore(dragged, coverEl.nextSibling);
  } else {
    const rect = target.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    grid.insertBefore(dragged, after ? target.nextSibling : target);
  }
  refreshPositions();
});

grid.addEventListener("drop", (e) => {
  if (!draggedId) return;
  e.preventDefault();
  didDrop = true;
  commitOrder();
});

function commitOrder() {
  const byId = new Map(state.pages.map((p) => [p.id, p]));
  const ordered = Array.from(grid.children)
    .map((el) => byId.get(el.dataset.id))
    .filter(Boolean);

  // Bail rather than corrupt the zine if the DOM ever disagrees with state.
  if (ordered.length === state.pages.length && ordered[0].isCover) {
    state.pages = ordered;
  }
  render();
  syncChrome();
}

/* ==========================================================================
   Refine — booklet spread
   ========================================================================== */

// How the 8 pages face each other once the sheet is folded: the cover and the
// back page stand alone, everything between them reads as a true spread.
// Positional, like the page labels, so reordering needs no bookkeeping.
const SPREADS = [[0], [1, 2], [3, 4], [5, 6], [7]];

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  if (mode !== "refine") state.editing = null;

  modeBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === mode)
  );
  grid.hidden = mode !== "arrange";
  refineEl.hidden = mode !== "refine";

  render();
  syncChrome();
}

modeBtns.forEach((btn) =>
  btn.addEventListener("click", () => setMode(btn.dataset.mode))
);

function renderRefine() {
  const isEditing = state.editing !== null;
  browseEl.hidden = isEditing;
  editorEl.hidden = !isEditing;

  if (isEditing) {
    renderEditor(state.editing);
    return;
  }

  // A rebuild is a state change, not a navigation — the book should be sitting
  // at the current spread already, not animate to it from wherever it was.
  buildBook();
  instantly(() => applyScene(state.spread));
  syncScrubber();
}

function buildPage(index) {
  const page = state.pages[index];
  const el = document.createElement("div");
  el.className = "slot page";
  if (page.isCover) el.classList.add("slot-cover");
  if (page.photo) el.classList.add("slot--filled", "page--filled");
  el.dataset.index = String(index);
  el.dataset.id = page.id;

  if (page.photo) el.appendChild(buildPhotoImg(page));
  el.appendChild(buildLabel(index));
  if (page.isCover) el.appendChild(buildCoverText(page));

  if (!page.photo) {
    el.appendChild(buildEmptyPlaceholder(index));
  } else {
    // Precision work only — drag, delete and replace stay in Arrange.
    el.setAttribute("data-tip", "Crop this page");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute(
      "aria-label",
      index === 0 ? "Crop the cover photo" : `Crop page ${index}`
    );
    el.addEventListener("click", () => openEditor(index));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openEditor(index);
      }
    });
  }

  return el;
}

/* ==========================================================================
   Refine — the book
   ==========================================================================
   A fanned deck. Leaf j carries page 2j on its front and 2j+1 on its back,
   which reproduces SPREADS exactly:

     leaf 0: Cover | 1     none turned -> Cover alone
     leaf 1:   2   | 3     leaf 0 turned -> 1|2
     leaf 2:   4   | 5     leaf 1 turned -> 3|4
     leaf 3:   6   | 7     leaf 2 turned -> 5|6
                           leaf 3 turned -> 7 alone

   Nothing is tabulated. Every page's position derives from one number: `depth`,
   how many pages sit in front of it on its own side of the spine. Depth 0 is
   flush at the spine — the page you're reading. Each step back moves out by
   FAN_X, narrows by FAN_W, and drops a z-level.

   JS only ever writes rest states; the CSS transitions do the turns. The one
   departure from that is a drag on the scrub bar, which writes interpolated
   states with transitions suppressed so the page tracks the pointer.
   ========================================================================== */

const LEAF_COUNT = SPREADS.length - 1; // 4 leaves, 5 scenes
const MAX_DEPTH = LEAF_COUNT - 1; // scenes 0 and 4 stack every leaf on one side

const rootStyle = getComputedStyle(document.documentElement);
// Number.isFinite rather than `||`, so a deliberate 0 — a flat book, no tilt —
// isn't silently replaced by the fallback.
function token(name, fallback) {
  const value = parseFloat(rootStyle.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

const Z_TOP = 30;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* The flip's feel. Every value here derives from a token in styles.css :root —
   `let` and re-read by readFlipTokens() rather than frozen at load, so the
   tuner can move them live. Nothing else may write them. */
let FAN_X_RATIO; // step out per depth, as a ratio of page width
let FAN_W_RATIO; // narrow per depth
let BOOK_TILT; // deg of open-book lean
let LEAF_WEDGE; // half-angle of the V each leaf is folded into, deg
let PERSPECTIVE_RATIO; // of page width, so the look is size-invariant
let PAPER_Z; // px of z-separation per true depth; breaks coplanarity
let BOOK_SPAN; // total width to reserve, in page widths
let ROT_RIGHT; // rest angle, right side
let ROT_FLIPPED; // rest angle, turned onto the left
let FLIP_MS; // tracks --flip-duration; drives the settle timer in liftRange

/**
 * BOOK_SPAN — how wide the deck is, in page widths. A receding page steps out
 * by FAN_X but also narrows by FAN_W, so the overhang past the resting spread
 * is only the difference: 0.0375 of a page each side at the defaults, not the
 * full step.
 *
 * Rest angles — the open-book tilt, each outer edge leaning slightly towards
 * the viewer. The sign asymmetry is correct: a right-side page's outer edge is
 * at +x from its pivot and a left-side page's is at -x, so they need opposite
 * signs to lean the same way. A flipped leaf lands just short of a half turn,
 * which resolves to the same lean once mirrored onto the left. Don't "fix" it.
 *
 * Both angles absorb LEAF_WEDGE, because these position the LEAF and every face
 * is offset from it by the wedge (see .leaf-hinge in styles.css). Subtracting it
 * here is what leaves the visible face resting at exactly -BOOK_TILT, so the
 * resting book looks the same at any wedge, and a wedge of 0 reproduces the
 * flat pre-phase-8 build. Change one of these without the other and the book
 * will rest tilted by the wedge.
 */
function readFlipTokens() {
  FAN_X_RATIO = token("--fan-x-ratio", 0.04375);
  FAN_W_RATIO = token("--fan-w-ratio", 0.03125);
  BOOK_TILT = token("--book-tilt", 5);
  LEAF_WEDGE = token("--leaf-wedge", 5);
  PERSPECTIVE_RATIO = token("--perspective-ratio", 3.5);
  PAPER_Z = token("--paper-z", 0.5);
  // MAX_DEPTH - 1, not MAX_DEPTH: pile depth collapses the top two pages of each
  // pile onto 0, so the deepest page fans one step less far than it used to.
  BOOK_SPAN = 2 + 2 * (MAX_DEPTH - 1) * (FAN_X_RATIO - FAN_W_RATIO); // 2.05
  ROT_RIGHT = -(BOOK_TILT + LEAF_WEDGE);
  ROT_FLIPPED = -(180 - BOOK_TILT - LEAF_WEDGE);
  FLIP_MS = reducedMotion ? 0 : token("--flip-duration", 400);
}

readFlipTokens();

// Page box in px, mirrored from the CSS vars layoutSurfaces() sets.
let pageW = 0;
let pageH = 0;

const leafEls = [];

// How many pages sit in front of leaf j, on its own side, at scene i.
// `i - 1 - j` for turned leaves is what lands the most recently turned leaf
// flush at the spine.
function depthAt(j, i) {
  return j < i ? i - 1 - j : j - i;
}

/**
 * A leaf's rest state at a given depth. `left` means different things per side:
 * a flipped leaf pivots on its left edge, so after rotateY(-180) its box `left`
 * is its visual RIGHT edge — hence the subtraction.
 *
 * PILE DEPTH is the whole of phase 8. Geometry comes from `max(0, d - 1)`, not
 * from `d`, which puts the top TWO pages of a pile on the same box: full size,
 * inner edge exactly on the spine. So the page under the turning leaf is already
 * in its final place and gets *uncovered* rather than grown, and the page on the
 * far side stays put rather than receding — which is what seals the gutter. The
 * fan survives untouched, because it now only ever applies to pages already
 * hidden behind a full-size one. Verified: 0px exposure on every side that has a
 * page, versus 25.4px before, at the same fan settings.
 *
 * `d` in the returned slot stays the TRUE depth. z-index and bury() both read it,
 * and collapsing those as well would leave the covered top-of-pile page sorted
 * level with its cover and reachable by click and Tab.
 */
function slotAtDepth(flipped, d) {
  const v = Math.max(0, d - 1);
  const w = pageW - pageW * FAN_W_RATIO * v;
  const step = pageW * FAN_X_RATIO * v;
  return {
    left: flipped ? pageW - step : pageW + step,
    w,
    // Derived from the real box, not 5/4, so pile depth 0 lands on --page-h.
    h: w * (pageW ? pageH / pageW : 5 / 4),
    rot: flipped ? ROT_FLIPPED : ROT_RIGHT,
    d,
  };
}

function bury(el, buried) {
  if (!el) return;
  el.inert = buried;
  el.classList.toggle("is-buried", buried);
}

/**
 * Positions every leaf for scene `t`, which may be fractional while the scrub
 * bar is being dragged: t = 2.37 means leaves 0-1 turned, leaf 2 is 37% through
 * its turn, leaf 3 upcoming.
 */
function applyScene(t) {
  if (!leafEls.length || !pageW) return;

  const i = clamp(Math.floor(t), 0, LEAF_COUNT);
  const f = clamp(t - i, 0, 1);
  // Exactly one leaf turns between adjacent scenes: the one indexed by the
  // lower of the two.
  const moving = f > 0 && i < LEAF_COUNT ? i : -1;

  leafEls.forEach((el, j) => {
    let slot;
    if (j === moving) {
      // The turning leaf is at depth 0 on both sides, so its left and width are
      // identical before and after — only the rotation moves. The whole
      // side-swap is carried by the rotation, which is the point of pivoting on
      // the spine.
      slot = slotAtDepth(false, 0);
      slot.rot = ROT_RIGHT + f * (ROT_FLIPPED - ROT_RIGHT);
    } else {
      // Every other leaf shifts depth by exactly +/-1 across a turn and never
      // changes side, so a plain lerp inside one side's formula is safe.
      const from = depthAt(j, i);
      const to = i < LEAF_COUNT ? depthAt(j, i + 1) : from;
      slot = slotAtDepth(j < i, from + f * (to - from));
    }

    el.style.left = `${slot.left}px`;
    el.style.width = `${slot.w}px`;
    el.style.height = `${slot.h}px`;
    // translateY(-50%) is the vertical centring and has to stay in the same
    // string — setting `transform` wholesale would otherwise drop it.
    //
    // translateZ is keyed on TRUE depth and is what makes pile depth safe: the
    // top two pages of a pile share one box, and coplanar quads in a preserve-3d
    // context are depth-sorted by real 3D position, not z-index, so they would
    // stitch and flicker. It applies after the rotation, i.e. straight back from
    // the viewer. Scaling from it is nil — perspective scales about the spine,
    // which is where these pages' inner edges already sit, and depth 0 gets no
    // offset at all.
    el.style.transform =
      `translateY(-50%) translateZ(${(-slot.d * PAPER_Z).toFixed(2)}px)` +
      ` rotateY(${slot.rot}deg)`;

    // Taken from the integer scene, never interpolated: a fractional z would
    // round and pop mid-turn. The turning leaf rides above everything instead,
    // or it sweeps through the stack rather than over it.
    el.style.zIndex = String(
      j === moving ? 100 : Math.round(Z_TOP - depthAt(j, i))
    );

    // The fan narrows background pages; their content scales rather than
    // reflowing. See .page-content in styles.css.
    const scale = slot.w / pageW;
    el.querySelectorAll(".page-content").forEach((box) => {
      box.style.transform = `scale(${scale})`;
    });

    // Every page is in the DOM at once, fanned behind the spread, so without
    // this Tab walks into buried pages and their crop targets stay clickable.
    // `inert` does the tab order and the accessibility tree in one call; the
    // class is a pointer-events safety net for browsers without it.
    const onSpread = slot.d < 0.001;
    const flipped = j < i;
    bury(el, !onSpread);
    bury(el.querySelector(".leaf-face--front"), !onSpread || flipped);
    bury(el.querySelector(".leaf-face--back"), !onSpread || !flipped);
  });
}

// Wraps a page in the fixed-size box that gets scaled instead of resized.
function buildFace(index, side) {
  const box = document.createElement("div");
  box.className = `page-content page-content--${side}`;
  box.appendChild(buildPage(index));
  return box;
}

/**
 * Rebuilds all 4 leaves. Called from render(), because page labels and leaf
 * pairing are both positional — a reorder has to invalidate them. Flips only
 * write inline styles and never come through here.
 */
function buildBook() {
  bookEl.querySelectorAll(".leaf").forEach((el) => el.remove());
  leafEls.length = 0;

  for (let j = 0; j < LEAF_COUNT; j++) {
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.dataset.leaf = String(j);

    const front = document.createElement("div");
    front.className = "leaf-face leaf-face--front";
    front.appendChild(buildFace(2 * j, "right"));

    const back = document.createElement("div");
    back.className = "leaf-face leaf-face--back";
    back.appendChild(buildFace(2 * j + 1, "left"));

    // Faces hang off hinges rather than the leaf, so each can carry the wedge
    // that keeps the gutter covered while the leaf passes edge-on. The faces'
    // own transforms are untouched by this — see .leaf-hinge in styles.css.
    const frontHinge = document.createElement("div");
    frontHinge.className = "leaf-hinge leaf-hinge--front";
    frontHinge.appendChild(front);

    const backHinge = document.createElement("div");
    backHinge.className = "leaf-hinge leaf-hinge--back";
    backHinge.appendChild(back);

    const edge = document.createElement("div");
    edge.className = "leaf-edge";
    edge.setAttribute("aria-hidden", "true");

    leaf.append(frontHinge, backHinge, edge);
    bookEl.appendChild(leaf);
    leafEls.push(leaf);
  }
}

// Applies a layout with transitions off, so it lands rather than animating in.
function instantly(fn) {
  bookEl.classList.add("is-instant");
  fn();
  void bookEl.offsetWidth; // force the reflow before transitions come back
  bookEl.classList.remove("is-instant");
}

/* A multi-scene jump turns several leaves at once, which reads as a riffle. Each
   one needs to ride above the stack for its own sweep, ordered so the leaf that
   ends up on top of its side is the highest. */
let flipGen = 0;
let settleTimer;

function liftRange(from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const forward = to > from;

  for (let j = lo; j < hi; j++) {
    if (leafEls[j]) {
      leafEls[j].style.zIndex = String(100 + (forward ? j - lo : hi - j));
    }
  }

  // No input lock: CSS transitions retarget mid-flight, which is what a
  // scrubbable bar needs. The generation guard is what stops a stale timer from
  // clobbering a newer flip.
  const gen = ++flipGen;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    if (gen === flipGen) applyScene(state.spread); // rewrites settled z
  }, FLIP_MS + 20);
}

function goToSpread(index) {
  const from = state.spread;
  const target = clamp(index, 0, LEAF_COUNT);
  state.spread = target;

  applyScene(target);
  if (target !== from) liftRange(from, target);
  syncScrubber();
}

/* ==========================================================================
   Refine — scrub bar
   ==========================================================================
   Navigation and position indicator in one control: drag it to flip spreads,
   read it to see where you are in the booklet.

   Stops, ticks and labels are all derived from SPREADS, like the page labels,
   so the fold layout stays the single source of truth.

   Positions are percentages, never measured pixels. The bar lives inside
   #refine-browse, which is `hidden` in Arrange mode and while the crop editor
   is open — getBoundingClientRect() would report 0 there, and the thumb would
   collapse to the left edge. Percentages also survive a resize with no JS.
   ========================================================================== */

const LAST_SPREAD = SPREADS.length - 1;

// Fraction along the track, 0 → 1. Evenly spaced, one stop per spread.
function spreadFraction(index) {
  return LAST_SPREAD === 0 ? 0 : index / LAST_SPREAD;
}

// "Cover", "1–2", "7" — the same positional naming as buildLabel().
function spreadLabel(index) {
  return SPREADS[index].map((i) => (i === 0 ? "Cover" : String(i))).join("–");
}

// Spoken form, for aria-valuetext.
function spreadAria(index) {
  const pages = SPREADS[index];
  if (pages.length === 1) {
    return pages[0] === 0 ? "Cover" : `Page ${pages[0]}`;
  }
  return `Pages ${pages.join(" and ")}`;
}

// SPREADS is fixed, so the ticks and labels are built once and only restyled
// afterwards — no DOM churn on every flip.
function buildScrubber() {
  scrubTrack.setAttribute("aria-valuemax", String(LAST_SPREAD));
  scrubTrack.querySelectorAll(".scrub-tick").forEach((el) => el.remove());
  scrubLabels.innerHTML = "";

  SPREADS.forEach((_, index) => {
    const pct = `${spreadFraction(index) * 100}%`;

    const tick = document.createElement("div");
    tick.className = "scrub-tick";
    tick.style.left = pct;
    scrubTrack.appendChild(tick);

    const label = document.createElement("button");
    label.type = "button";
    label.className = "scrub-label";
    label.dataset.spread = String(index);
    label.style.left = pct;
    label.textContent = spreadLabel(index);
    label.setAttribute("aria-label", `Go to ${spreadAria(index).toLowerCase()}`);
    label.addEventListener("click", () => goToSpread(index));
    scrubLabels.appendChild(label);
  });

  // Arrange is the opening mode, so the first render() never reaches the book —
  // set the thumb explicitly rather than leaning on `auto`.
  syncScrubber();
}

/**
 * `pos` may be fractional mid-drag: the thumb and fill follow the pointer
 * continuously, while the labels and the announced value snap to the nearest
 * stop so the readout stays legible while a page is half-turned.
 */
function syncScrubber(pos = state.spread) {
  const pct = `${spreadFraction(pos) * 100}%`;
  scrubThumb.style.left = pct;
  scrubFill.style.width = pct;

  const nearest = Math.round(pos);
  scrubTrack.setAttribute("aria-valuenow", String(nearest));
  scrubTrack.setAttribute("aria-valuetext", spreadAria(nearest));

  Array.from(scrubLabels.children).forEach((label) => {
    label.classList.toggle(
      "is-active",
      Number(label.dataset.spread) === nearest
    );
  });
}

let scrubbing = null; // { id } while a drag is in flight

/**
 * Pointer x → a continuous scene, 0 .. LAST_SPREAD. Deliberately not snapped:
 * the fractional part is what turns the page under the pointer.
 */
function sceneFromPointer(clientX) {
  const rect = scrubTrack.getBoundingClientRect();
  if (rect.width === 0) return state.spread;
  return clamp((clientX - rect.left) / rect.width, 0, 1) * LAST_SPREAD;
}

function scrubDrag(clientX) {
  const t = sceneFromPointer(clientX);
  // The nearest stop is the committed spread, so releasing — or any other
  // navigation path — resumes from somewhere real.
  state.spread = Math.round(t);
  applyScene(t);
  syncScrubber(t);
}

scrubTrack.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault(); // suppress text selection during the drag
  scrubbing = { id: e.pointerId };
  scrubTrack.setPointerCapture(e.pointerId);
  scrubTrack.classList.add("is-scrubbing");
  // Transitions off, or the page eases along behind the pointer instead of
  // tracking it.
  bookEl.classList.add("is-scrubbing");
  // So the keyboard can take over where the drag left off.
  scrubTrack.focus();
  scrubDrag(e.clientX);
});

scrubTrack.addEventListener("pointermove", (e) => {
  if (!scrubbing || e.pointerId !== scrubbing.id) return;
  scrubDrag(e.clientX);
});

function endScrub(e) {
  if (!scrubbing || e.pointerId !== scrubbing.id) return;
  if (scrubTrack.hasPointerCapture(scrubbing.id)) {
    scrubTrack.releasePointerCapture(scrubbing.id);
  }
  scrubbing = null;
  scrubTrack.classList.remove("is-scrubbing");
  bookEl.classList.remove("is-scrubbing");
  // Commit the transitions-enabled state before the new values land, or the
  // browser can coalesce both changes and skip the animation home.
  void bookEl.offsetWidth;
  // So a half-turned page eases the rest of the way rather than snapping.
  applyScene(state.spread);
  syncScrubber();
}

scrubTrack.addEventListener("pointerup", endScrub);
scrubTrack.addEventListener("pointercancel", endScrub);

// Only while the track itself has focus — this is the slider being operable,
// not global arrow-key page navigation.
scrubTrack.addEventListener("keydown", (e) => {
  const moves = {
    ArrowLeft: state.spread - 1,
    ArrowRight: state.spread + 1,
    ArrowUp: state.spread + 1,
    ArrowDown: state.spread - 1,
    Home: 0,
    End: LAST_SPREAD,
  };
  if (!(e.key in moves)) return;
  e.preventDefault();
  goToSpread(moves[e.key]);
});

/* ==========================================================================
   Refine — crop editor
   ========================================================================== */

function openEditor(index) {
  state.editing = index;
  renderRefine();
}

function closeEditor() {
  state.editing = null;
  renderRefine();
}

function editingPhoto() {
  if (state.editing === null) return null;
  const page = state.pages[state.editing];
  return page && page.photo ? page.photo : null;
}

// A photo that exactly fills the frame has nowhere to go; the cursor and the
// pointer handlers both key off this.
function syncPanAffordance(photo) {
  const bounds = photo ? cropBounds(photo) : { x: 0, y: 0 };
  editorFrame.classList.toggle("is-locked", bounds.x === 0 && bounds.y === 0);
}

function renderEditor(index) {
  const page = state.pages[index];

  editorFrame.innerHTML = "";
  editorFrame.className = "slot editor-frame";
  if (page.isCover) editorFrame.classList.add("slot-cover");
  if (page.photo) editorFrame.classList.add("slot--filled");
  editorFrame.dataset.index = String(index);
  editorFrame.dataset.id = page.id;

  if (page.photo) editorFrame.appendChild(buildPhotoImg(page));
  editorFrame.appendChild(buildLabel(index));
  // Shown while cropping so the photo can be framed around the title.
  if (page.isCover) editorFrame.appendChild(buildCoverText(page));

  zoomSlider.value = String(page.photo ? page.photo.crop.zoom : MIN_ZOOM);
  syncPanAffordance(page.photo);
}

function setZoom(zoom) {
  const photo = editingPhoto();
  if (!photo) return;

  photo.crop.zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  // Offsets are normalized, so tightening the bounds pulls the framing back
  // inside them on its own — zooming out can never uncover the frame.
  photo.crop.x = clamp(photo.crop.x, -1, 1);
  photo.crop.y = clamp(photo.crop.y, -1, 1);

  zoomSlider.value = String(photo.crop.zoom);
  syncPanAffordance(photo);
  refreshCropTransforms();
}

let pan = null;

editorFrame.addEventListener("pointerdown", (e) => {
  const photo = editingPhoto();
  if (!photo || e.button !== 0) return;
  // Let clicks through to the cover's title fields.
  if (e.target.closest(".cover-text")) return;

  const bounds = cropBounds(photo);
  if (bounds.x === 0 && bounds.y === 0) return;

  pan = { id: e.pointerId, x: e.clientX, y: e.clientY };
  editorFrame.setPointerCapture(e.pointerId);
  editorFrame.classList.add("is-panning");
});

editorFrame.addEventListener("pointermove", (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  const photo = editingPhoto();
  if (!photo) return;

  const rect = editorFrame.getBoundingClientRect();
  const bounds = cropBounds(photo);
  const dx = e.clientX - pan.x;
  const dy = e.clientY - pan.y;
  pan.x = e.clientX;
  pan.y = e.clientY;

  // Pixels travelled / pixels of travel available = normalized delta.
  if (bounds.x > 0) {
    photo.crop.x = clamp(photo.crop.x + dx / (bounds.x * rect.width), -1, 1);
  }
  if (bounds.y > 0) {
    photo.crop.y = clamp(photo.crop.y + dy / (bounds.y * rect.height), -1, 1);
  }
  refreshCropTransforms();
});

function endPan(e) {
  if (!pan || e.pointerId !== pan.id) return;
  if (editorFrame.hasPointerCapture(pan.id)) {
    editorFrame.releasePointerCapture(pan.id);
  }
  pan = null;
  editorFrame.classList.remove("is-panning");
}

editorFrame.addEventListener("pointerup", endPan);
editorFrame.addEventListener("pointercancel", endPan);

editorFrame.addEventListener(
  "wheel",
  (e) => {
    const photo = editingPhoto();
    if (!photo) return;
    // Also keeps a trackpad pinch from reaching the browser as a page zoom.
    e.preventDefault();
    setZoom(photo.crop.zoom * Math.exp(-e.deltaY * 0.0015));
  },
  { passive: false }
);

zoomSlider.addEventListener("input", () => setZoom(Number(zoomSlider.value)));

cropReset.addEventListener("click", () => {
  const photo = editingPhoto();
  if (!photo) return;
  photo.crop = { zoom: MIN_ZOOM, x: 0, y: 0 };
  setZoom(MIN_ZOOM);
});

cropDone.addEventListener("click", closeEditor);

/* ==========================================================================
   Export — sheet geometry
   ==========================================================================
   A4 landscape, 4 columns x 2 rows. The grid spans the whole sheet on purpose:
   you fold paper edge-to-edge, so the creases land on the sheet's true
   midlines and the cell boundaries have to agree with them. Keeping content
   clear of the printer's unprintable margin is the inset's job instead.
   ========================================================================== */

const MM_PER_INCH = 25.4;
const DPI = 300;

const SHEET_MM = { w: 297, h: 210 };
const CELL_MM = { w: SHEET_MM.w / 4, h: SHEET_MM.h / 2 }; // 74.25 x 105
const CELL_INSET_MM = 5; // clear of both the cut line and the printer's margin

/**
 * Largest 4:5 page that fits inside a cell's inset box — the same "tighter
 * axis wins" logic as fitTiles(), in millimetres. Width is the binding
 * constraint on A4, which leaves ~14.7mm of vertical slack per cell.
 */
function fitPage() {
  const boxW = CELL_MM.w - CELL_INSET_MM * 2;
  const boxH = CELL_MM.h - CELL_INSET_MM * 2;
  const w = Math.min(boxW, boxH * FRAME_AR);
  return { w, h: w / FRAME_AR };
}

const PAGE_MM = fitPage(); // 64.25 x 80.31

// The slack is split evenly, so every page prints with the same margin at head
// and foot and nothing sits near the cut line.
const PAGE_OFFSET_MM = {
  x: CELL_INSET_MM,
  y: (CELL_MM.h - PAGE_MM.h) / 2,
};

/**
 * Print resolution, rounded so 4:5 survives as whole pixels. A frame whose
 * pixel ratio drifted a fraction from 4:5 would leave a hairline gap along one
 * edge of an exactly-4:5 photo, because cover-fit would bind on the other axis.
 */
const PAGE_PX = (() => {
  const w = Math.round((PAGE_MM.w / MM_PER_INCH) * DPI / 4) * 4;
  return { w, h: (w / 4) * 5 };
})(); // 760 x 950

/**
 * Where each page lands on the sheet, read off the supplied imposition
 * diagram. `col` and `row` are zero-based; the top row prints rotated 180.
 *
 * The diagram numbers its cells from the back page — the cell marked 1 is also
 * marked BACK PAGE, and 2 is FRONT PAGE. Tracing reading order from the FRONT
 * PAGE cell instead walks a closed loop around the sheet whose only two
 * crossings of the horizontal midline fall in columns 1 and 4 — the two
 * columns the cut does not sever, which is what makes the fold work. Every
 * cell below then matches the diagram.
 */
const IMPOSITION = [
  { col: 3, row: 1, rot: false }, // 0  Cover — bottom right (FRONT PAGE)
  { col: 3, row: 0, rot: true },  // 1
  { col: 2, row: 0, rot: true },  // 2
  { col: 1, row: 0, rot: true },  // 3
  { col: 0, row: 0, rot: true },  // 4
  { col: 0, row: 1, rot: false }, // 5
  { col: 1, row: 1, rot: false }, // 6
  { col: 2, row: 1, rot: false }, // 7  back page (BACK PAGE)
];

/* ==========================================================================
   Export — page composition
   ========================================================================== */

/**
 * Inverts the on-screen render — object-fit: cover plus
 * translate(...%) scale(zoom) — back into a rect in source pixels.
 *
 * Deliberately calls cropBounds() rather than re-deriving the bounds: if the
 * two ever disagreed, the print would be framed differently from Refine and
 * nothing on screen would reveal it.
 */
function cropSourceRect(photo) {
  const iw = photo.width;
  const ih = photo.height;
  const { zoom, x, y } = photo.crop;

  const W = PAGE_PX.w;
  const H = PAGE_PX.h;

  // cover-fit scales by whichever axis would otherwise leave a gap. Taken from
  // the frame's real dimensions, not the nominal 4:5 — the same thing
  // object-fit does, and it can't leave a sliver if the two ever disagree.
  const scale = Math.max(W / iw, H / ih) * zoom;

  // Top-left of the displayed image, in frame pixels.
  const bounds = cropBounds(photo);
  const dx = W / 2 - (iw * scale) / 2 + x * bounds.x * W;
  const dy = H / 2 - (ih * scale) / 2 + y * bounds.y * H;

  // The frame, expressed back in source pixels.
  const sw = Math.min(W / scale, iw);
  const sh = Math.min(H / scale, ih);
  return {
    sx: clamp(-dx / scale, 0, Math.max(0, iw - sw)),
    sy: clamp(-dy / scale, 0, Math.max(0, ih - sh)),
    sw,
    sh,
  };
}

/* Mirrors .cover-text / .cover-title / .cover-subtitle in styles.css. Every
   dimension is a fraction of page width, exactly as the CSS does it, so the
   printed cover can't drift from the one on screen.

   The one approximation: the scrim's inset is a fixed -14px/-18px in CSS, so
   it's scaled here against the 220px reference tile (--tile-w's default). */
const COVER_PRINT = {
  inset: 0.12, // .cover-text left / right
  fontScale: 0.092, // .cover-title / .cover-subtitle font-size
  gapScale: 0.054, // .cover-title margin-bottom
  lineHeight: 1.2,
  shiftY: -0.1, // translateY(-10%) of the block's own height
  scrimX: 18 / 220,
  scrimY: 14 / 220,
  scrimRadius: 4 / 220,
};

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function drawCoverText(ctx, page) {
  // Placeholders are prompts, not content — they must never print.
  const title = page.title.trim();
  const subtitle = page.subtitle.trim();
  if (!title && !subtitle) return;

  const W = PAGE_PX.w;
  const H = PAGE_PX.h;
  const fontSize = W * COVER_PRINT.fontScale;
  const lineH = fontSize * COVER_PRINT.lineHeight;
  const gap = W * COVER_PRINT.gapScale;

  const lines = [];
  if (title) lines.push({ text: title, weight: 600, color: "#1c1e21" });
  if (subtitle) lines.push({ text: subtitle, weight: 500, color: "#69737b" });

  const blockH = lines.length * lineH + (lines.length - 1) * gap;
  const left = W * COVER_PRINT.inset;
  const blockW = W * (1 - COVER_PRINT.inset * 2);
  const top = H / 2 + blockH * COVER_PRINT.shiftY;

  // Keeps the text legible where it sits over a photo.
  if (page.photo) {
    const padX = W * COVER_PRINT.scrimX;
    const padY = W * COVER_PRINT.scrimY;
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    roundRectPath(
      ctx,
      left - padX,
      top - padY,
      blockW + padX * 2,
      blockH + padY * 2,
      W * COVER_PRINT.scrimRadius
    );
    ctx.fill();
  }

  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.font = `${line.weight} ${fontSize}px "Geist Mono", ui-monospace, monospace`;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, left, top + i * (lineH + gap), blockW);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode a photo."));
    img.src = src;
  });
}

/**
 * Renders one page at print resolution. Rotating here rather than in jsPDF
 * keeps the imposition step to pure placement.
 */
async function composePage(index, rotate180) {
  const page = state.pages[index];
  const canvas = document.createElement("canvas");
  canvas.width = PAGE_PX.w;
  canvas.height = PAGE_PX.h;
  const ctx = canvas.getContext("2d");

  // Empty pages export blank by design — users may leave them so (§4).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (rotate180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  }

  if (page.photo) {
    const img = await loadImage(page.photo.url);
    // Self-heal if setPhoto()'s async probe hasn't landed yet, so an export
    // fired moments after a drop still measures the real photo.
    if (!page.photo.width || !page.photo.height) {
      page.photo.width = img.naturalWidth;
      page.photo.height = img.naturalHeight;
    }
    const r = cropSourceRect(page.photo);
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, 0, 0, PAGE_PX.w, PAGE_PX.h);
  }

  if (page.isCover) drawCoverText(ctx, page);

  return canvas;
}

/* ==========================================================================
   Export — the PDF
   ========================================================================== */

/**
 * Renders all 8 pages, each already rotated for its cell. The fold guide and
 * the PDF share these canvases, so the diagram shows the real sheet and a
 * download after browsing costs nothing.
 */
async function composeAllPages() {
  // Geist Mono has to be resolved before any cover text is rasterised,
  // otherwise the fallback monospace gets baked in.
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const canvases = [];
  for (let i = 0; i < PAGE_COUNT; i++) {
    canvases.push(await composePage(i, IMPOSITION[i].rot));
  }
  return canvases;
}

function exportPdf(canvases) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    notify("Couldn't load the PDF library — check your connection.");
    return;
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  IMPOSITION.forEach((cell, i) => {
    // Photos want JPEG for the file size; a text-only or blank page stays PNG,
    // where it costs almost nothing and keeps the type crisp.
    const hasPhoto = Boolean(state.pages[i].photo);
    const data = hasPhoto
      ? canvases[i].toDataURL("image/jpeg", 0.92)
      : canvases[i].toDataURL("image/png");

    doc.addImage(
      data,
      hasPhoto ? "JPEG" : "PNG",
      cell.col * CELL_MM.w + PAGE_OFFSET_MM.x,
      cell.row * CELL_MM.h + PAGE_OFFSET_MM.y,
      PAGE_MM.w,
      PAGE_MM.h
    );
  });

  doc.save("minikomi.pdf");
}

/* ==========================================================================
   Print — fold-and-cut guide
   ==========================================================================
   Five steps over one SVG. The sheet, the folded strip and the finished booklet
   are separate groups that cross-fade, rather than one shape being morphed —
   flat, legible at modal size, and nothing to go wrong across browsers. True
   perspective folding belongs with the phase 7 flourish.

   The diagram is drawn in millimetres (viewBox 297x210), so every cell, crease
   and cut line is placed straight from the export geometry above and can't
   drift from what actually prints.
   ========================================================================== */

const FOLD_STEPS = [
  {
    title: "Print",
    text: "Print on A4, single-sided, at actual size. Turn off “fit to page” — if the printer shrinks the sheet, the folds won’t line up.",
  },
  {
    title: "Crease",
    text: "Fold the top edge down to the bottom edge, and unfold. Then fold the left edge across to the right, and in half once more. Unfold everything — eight creased panels.",
  },
  {
    title: "Cut",
    text: "Fold the left edge across to the right again. Cut along the middle crease, from the folded edge in to the next crease. Unfold: a slit across the two middle panels.",
  },
  {
    title: "Fold",
    text: "Fold the top half behind the sheet, taking the top edge down to the bottom edge. Both printed sides now face outwards, and the slit is an opening along the folded edge.",
  },
  {
    title: "Flatten",
    text: "Hold the two short ends and push them towards each other. The slit opens into a diamond — flatten it into a booklet, cover on the outside.",
  },
];

const modalEl = document.getElementById("print-modal");
const foldStage = document.getElementById("fold-stage");
const foldTitle = document.getElementById("fold-title");
const foldText = document.getElementById("fold-text");
const foldDots = document.getElementById("fold-dots");
const foldBack = document.getElementById("fold-back");
const foldNext = document.getElementById("fold-next");
const foldDownload = document.getElementById("fold-download");
const foldClose = document.getElementById("fold-close");

let foldStep = 0;
let foldPages = null; // composed canvases while the modal is open
let lastFocus = null;

// Small enough to inline eight of them as data URLs without bloating the DOM.
const THUMB_W = 170;

function thumbnail(canvas) {
  const t = document.createElement("canvas");
  t.width = THUMB_W;
  t.height = Math.round(THUMB_W * (canvas.height / canvas.width));
  t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.82);
}

/* Marks are drawn over photos, so each one gets a white halo beneath it —
   otherwise an arrow or a cut line disappears against a dark image. */

// An arrow as one path: shaft plus two chevron strokes at the tip.
function arrow(x1, y1, x2, y2) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 5;
  const spread = 0.42;
  const hx1 = x2 - head * Math.cos(angle - spread);
  const hy1 = y2 - head * Math.sin(angle - spread);
  const hx2 = x2 - head * Math.cos(angle + spread);
  const hy2 = y2 - head * Math.sin(angle + spread);
  const d = `M${x1} ${y1}L${x2} ${y2}M${hx2} ${hy2}L${x2} ${y2}L${hx1} ${hy1}`;
  return `<path class="fs-halo" d="${d}"/><path class="fs-arrow" d="${d}"/>`;
}

function scissors(x, y) {
  return `<g class="fs-scissors" transform="translate(${x} ${y})">
      <rect class="fs-glyph-halo" x="-5.8" y="-5.8" width="13.6" height="11.6" rx="2"/>
      <circle cx="-3.4" cy="-3.4" r="1.8"/>
      <circle cx="-3.4" cy="3.4" r="1.8"/>
      <path d="M-1.9 -2.4L6.5 2.6M-1.9 2.4L6.5 -2.6"/>
    </g>`;
}

/**
 * Builds the whole diagram once, with every step's layer present. Stepping is
 * then pure CSS off `data-step`, so transitions come free and the eight
 * thumbnails are only encoded once.
 */
function buildFoldStage(canvases) {
  const thumbs = canvases.map(thumbnail);
  const { w: cw, h: ch } = CELL_MM;
  const { w: pw, h: ph } = PAGE_MM;
  const off = PAGE_OFFSET_MM;

  // --- the flat sheet, steps 1-3 -----------------------------------------
  const cells = IMPOSITION.map(
    (cell, i) =>
      `<image href="${thumbs[i]}" x="${cell.col * cw + off.x}" y="${
        cell.row * ch + off.y
      }" width="${pw}" height="${ph}" preserveAspectRatio="none"/>`
  ).join("");

  const creases = [
    `<line x1="0" y1="${ch}" x2="${SHEET_MM.w}" y2="${ch}"/>`,
    ...[1, 2, 3].map(
      (c) => `<line x1="${c * cw}" y1="0" x2="${c * cw}" y2="${SHEET_MM.h}"/>`
    ),
  ].join("");

  // --- the cut, step 3 ---------------------------------------------------
  // Spans the two middle columns, exactly as on the supplied diagram.
  const cutFrom = cw;
  const cutTo = cw * 3;
  const cut =
    `<line class="fs-halo" x1="${cutFrom}" y1="${ch}" x2="${cutTo}" y2="${ch}"/>` +
    `<line class="fs-cutline" x1="${cutFrom}" y1="${ch}" x2="${cutTo}" y2="${ch}"/>` +
    [cutFrom, (cutFrom + cutTo) / 2, cutTo].map((x) => scissors(x, ch)).join("");

  // --- the folded strip, step 4 ------------------------------------------
  // Half height, so the sheet's midline is now its top edge and the cut is an
  // opening along it. Only the bottom row faces this way.
  const stripY = (SHEET_MM.h - ch) / 2;
  const bottomRow = IMPOSITION.map((cell, i) => ({ ...cell, i })).filter(
    (cell) => cell.row === 1
  );
  const strip =
    `<path class="fs-paper-edge" d="M0 ${stripY}L${cutFrom} ${stripY}M${cutTo} ${stripY}L${SHEET_MM.w} ${stripY}
       M0 ${stripY}L0 ${stripY + ch}L${SHEET_MM.w} ${stripY + ch}L${SHEET_MM.w} ${stripY}"/>` +
    `<line class="fs-slit" x1="${cutFrom}" y1="${stripY}" x2="${cutTo}" y2="${stripY}"/>` +
    bottomRow
      .map(
        (cell) =>
          `<image href="${thumbs[cell.i]}" x="${cell.col * cw + off.x}" y="${
            stripY + off.y
          }" width="${pw}" height="${ph}" preserveAspectRatio="none"/>`
      )
      .join("") +
    arrow(14, stripY + ch + 16, 52, stripY + ch + 16) +
    arrow(SHEET_MM.w - 14, stripY + ch + 16, SHEET_MM.w - 52, stripY + ch + 16);

  // --- the finished booklet, step 5 --------------------------------------
  const bh = 150;
  const bw = bh * FRAME_AR;
  const bx = (SHEET_MM.w - bw) / 2;
  const by = (SHEET_MM.h - bh) / 2;
  const booklet =
    [3, 2, 1] // page edges behind the cover, to read as a thickness
      .map(
        (n) =>
          `<rect class="fs-leaf" x="${bx + n * 1.8}" y="${by - n * 1.8}" width="${bw}" height="${bh}" rx="1.5"/>`
      )
      .join("") +
    `<image href="${thumbs[0]}" x="${bx}" y="${by}" width="${bw}" height="${bh}" preserveAspectRatio="none"/>` +
    `<rect class="fs-leaf-outline" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="1.5"/>`;

  foldStage.innerHTML = `
    <svg viewBox="0 0 ${SHEET_MM.w} ${SHEET_MM.h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g class="fs-sheet">
        <rect class="fs-paper" x="0" y="0" width="${SHEET_MM.w}" height="${SHEET_MM.h}" rx="1"/>
        ${cells}
        <g class="fs-creases">${creases}</g>
      </g>
      <g class="fs-folds">
        ${arrow(SHEET_MM.w / 2 - 42, 22, SHEET_MM.w / 2 - 42, SHEET_MM.h - 22)}
        ${arrow(28, SHEET_MM.h / 2 - 34, SHEET_MM.w - 28, SHEET_MM.h / 2 - 34)}
      </g>
      <g class="fs-cut">${cut}</g>
      <g class="fs-strip">${strip}</g>
      <g class="fs-booklet">${booklet}</g>
    </svg>`;
}

function renderFoldStep() {
  const step = FOLD_STEPS[foldStep];
  foldStage.dataset.step = String(foldStep + 1);
  foldTitle.textContent = `Step ${foldStep + 1} — ${step.title}`;
  foldText.textContent = step.text;

  foldBack.disabled = foldStep === 0;
  foldNext.disabled = foldStep === FOLD_STEPS.length - 1;

  // Disabling the button that currently has focus would drop focus to <body>,
  // taking Escape and the tab trap with it.
  if (document.activeElement && document.activeElement.disabled) {
    (foldNext.disabled ? foldBack : foldNext).focus();
  }

  Array.from(foldDots.children).forEach((dot, i) => {
    dot.classList.toggle("is-active", i === foldStep);
    dot.setAttribute("aria-current", i === foldStep ? "step" : "false");
  });
}

function goToFoldStep(index) {
  foldStep = clamp(index, 0, FOLD_STEPS.length - 1);
  renderFoldStep();
}

function buildFoldDots() {
  foldDots.innerHTML = "";
  FOLD_STEPS.forEach((step, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "step-dot";
    dot.setAttribute("aria-label", `Step ${i + 1} — ${step.title}`);
    dot.setAttribute("data-tip", step.title);
    dot.addEventListener("click", () => goToFoldStep(i));
    foldDots.appendChild(dot);
  });
}

async function openPrintModal() {
  lastFocus = document.activeElement;
  foldStep = 0;
  modalEl.hidden = false;
  foldDownload.disabled = true;
  foldDownload.textContent = "PREPARING…";
  // The diagram needs the composed pages, so the steps are readable before it
  // arrives rather than sitting in an empty frame.
  foldStage.innerHTML = `<p class="fold-stage-wait">Rendering your pages…</p>`;
  renderFoldStep();
  foldNext.focus();

  try {
    // Recomposed on every open, so the guide can never show a stale sheet.
    foldPages = await composeAllPages();
    buildFoldStage(foldPages);
    foldDownload.disabled = false;
    foldDownload.textContent = "DOWNLOAD PDF";
  } catch (err) {
    console.error(err);
    foldDownload.textContent = "DOWNLOAD PDF";
    notify("Couldn't prepare the pages for printing.");
  }
}

function closePrintModal() {
  modalEl.hidden = true;
  foldPages = null;
  foldStage.innerHTML = "";
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}

printBtn.addEventListener("click", openPrintModal);
foldClose.addEventListener("click", closePrintModal);
foldBack.addEventListener("click", () => goToFoldStep(foldStep - 1));
foldNext.addEventListener("click", () => goToFoldStep(foldStep + 1));

foldDownload.addEventListener("click", () => {
  if (!foldPages) return;
  try {
    exportPdf(foldPages);
  } catch (err) {
    console.error(err);
    notify("Something went wrong making the PDF.");
  }
});

// A click that starts on the backdrop and not the dialog dismisses it.
modalEl.addEventListener("mousedown", (e) => {
  if (e.target === modalEl) closePrintModal();
});

modalEl.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    closePrintModal();
    return;
  }
  // Keep Tab inside the dialog while it's modal.
  if (e.key !== "Tab") return;
  const focusable = Array.from(
    modalEl.querySelectorAll("button:not([disabled])")
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

buildFoldDots();

/* ==========================================================================
   Derived chrome
   ========================================================================== */

let noticeTimer;
function notify(message) {
  noticeEl.textContent = message;
  noticeEl.classList.add("is-visible");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => noticeEl.classList.remove("is-visible"), 3200);
}

function syncChrome() {
  const count = photoCount();
  printBtn.disabled = count === 0;
  // The hint points at the empty Arrange grid, so it has no business in Refine.
  hintEl.classList.toggle("is-hidden", count > 0 || state.mode !== "arrange");
}

// Browsers ignore custom text here and show their own generic dialog.
window.addEventListener("beforeunload", (e) => {
  if (!hasContent()) return;
  e.preventDefault();
  e.returnValue = "";
});

/* ==========================================================================
   Drag and drop
   ========================================================================== */

// Phase 3 reorder drags carry custom data and no files, so gating on "Files"
// keeps the two drag systems from colliding.
function isFileDrag(e) {
  // A drop while the fold guide is open would edit the zine behind it, leaving
  // the diagram and the pending PDF showing a sheet that no longer exists.
  if (!modalEl.hidden) return false;
  return Array.from(e.dataTransfer?.types || []).includes("Files");
}

// `dragleave` fires when the cursor crosses onto a child element, so a plain
// boolean flag would flicker. Count enters against leaves instead.
let dragDepth = 0;

document.addEventListener("dragenter", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  document.body.classList.add("is-dragover");
});

document.addEventListener("dragover", (e) => {
  if (isFileDrag(e)) e.preventDefault();
});

document.addEventListener("dragleave", (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("is-dragover");
});

document.addEventListener("drop", (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("is-dragover");

  // Matches an Arrange tile, a Refine page or the editor frame — all three
  // carry their page index.
  const slot = e.target.closest ? e.target.closest("[data-index]") : null;
  if (slot) {
    const index = Number(slot.dataset.index);
    const mode = state.pages[index].photo ? "replace" : "fill";
    assignPhotos(e.dataTransfer.files, index, mode);
  } else {
    assignPhotos(e.dataTransfer.files, null, "fill");
  }
});

/* ==========================================================================
   Layout — keep the whole zine inside the viewport, no scrolling
   ========================================================================== */

const GRID_GAP = 22;
const SAFETY_MARGIN = 2;
const SCRUB_RESERVE = 64; // scrub track + labels beneath the spread
const CONTROLS_RESERVE = 66; // crop controls beneath the editor frame

/**
 * Largest 4:5 tile that fits a cols x rows arrangement inside the given box.
 * The tighter of available width/height wins; the other dimension is derived
 * to preserve the locked ratio.
 */
function fitTiles(availW, availH, cols, rows, gap) {
  const fromWidth = (availW - gap * (cols - 1)) / cols;
  const fromHeight = (availH - gap * (rows - 1)) / rows;

  if (fromWidth * (5 / 4) <= fromHeight) {
    return { w: fromWidth, h: fromWidth * (5 / 4) };
  }
  return { w: fromHeight * (4 / 5), h: fromHeight };
}

function setTileVars(wVar, hVar, tile) {
  const root = document.documentElement;
  root.style.setProperty(wVar, `${Math.floor(tile.w)}px`);
  root.style.setProperty(hVar, `${Math.floor(tile.h)}px`);
}

// All three surfaces share the same box, so all three are sized together and
// every mode is correct the moment it becomes visible.
function layoutSurfaces() {
  const wrap = document.querySelector(".grid-wrap");
  if (!wrap) return;

  const pad = getComputedStyle(wrap);
  const availW =
    wrap.clientWidth -
    parseFloat(pad.paddingLeft) -
    parseFloat(pad.paddingRight) -
    SAFETY_MARGIN;
  const availH = wrap.clientHeight - SAFETY_MARGIN;

  setTileVars("--tile-w", "--tile-h", fitTiles(availW, availH, 4, 2, GRID_GAP));
  // The book is BOOK_SPAN page-widths across, not 2 — the fan overhangs the
  // resting spread and .grid-wrap clips. fitTiles takes that as a fractional
  // column count, which with no gap reduces to availW / BOOK_SPAN.
  const book = fitTiles(availW, availH - SCRUB_RESERVE, BOOK_SPAN, 1, 0);
  setTileVars("--page-w", "--page-h", book);
  // Mirror what setTileVars actually wrote, so the book's maths and the CSS
  // agree to the pixel.
  pageW = Math.floor(book.w);
  pageH = Math.floor(book.h);
  // Scaled with the page, or the same perspective over-distorts a large book.
  document.documentElement.style.setProperty(
    "--perspective",
    `${Math.round(pageW * PERSPECTIVE_RATIO)}px`
  );
  setTileVars(
    "--edit-w",
    "--edit-h",
    fitTiles(availW, availH - CONTROLS_RESERVE, 1, 1, 0)
  );

  // Leaf boxes are sized in px by applyScene(), so a resize has to re-derive
  // them — and land them, rather than animating from the old size.
  if (state.mode === "refine" && state.editing === null) {
    instantly(() => applyScene(state.spread));
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ==========================================================================
   Dev — flip tuner
   ==========================================================================
   Scaffolding, not product. Never built unless the URL carries #tune, so it
   cannot reach a user by accident. Delete this section and the .tuner block in
   styles.css to remove it — nothing else in either file references them.

   Each knob writes a custom property on :root, then re-runs readFlipTokens()
   followed by layoutSurfaces(). That order is the whole trick: the tokens stay
   the single source of truth, and layoutSurfaces() is what turns the changed
   ones into pixels — it recomputes --perspective from PERSPECTIVE_RATIO,
   re-fits the page box from BOOK_SPAN, and already ends by landing the scene
   instantly when Refine is showing. --flip-duration and --flip-ease also reach
   the CSS transitions directly, with no JS involvement at all.
   ========================================================================== */

// Checked on demand, not captured at load: adding #tune to an already-open page
// fires hashchange without reloading, and the panel should still appear.
function tunerEnabled() {
  return location.hash.includes("tune");
}

/* `unit` is appended when writing the property — the fan ratios and the tilt
   are deliberately unitless, because token() parses them as plain numbers.
   `show` is a readout suffix only and never reaches the CSS. */
const TUNER_KNOBS = [
  { name: "--flip-duration", label: "flip duration", min: 80, max: 1200, step: 10, unit: "ms" },
  { name: "--book-tilt", label: "book tilt", min: 0, max: 24, step: 0.5, unit: "", show: "°" },
  { name: "--leaf-wedge", label: "leaf wedge", min: 0, max: 30, step: 0.5, unit: "", show: "°" },
  { name: "--fan-x-ratio", label: "fan step out", min: 0, max: 0.12, step: 0.00125, unit: "" },
  { name: "--fan-w-ratio", label: "fan narrow", min: 0, max: 0.12, step: 0.00125, unit: "" },
  { name: "--paper-z", label: "paper z-gap", min: 0, max: 3, step: 0.1, unit: "px" },
  { name: "--perspective-ratio", label: "perspective", min: 1.5, max: 12, step: 0.1, unit: "", show: "×" },
  { name: "--edge-thickness", label: "paper edge", min: 0, max: 12, step: 0.5, unit: "px" },
  { name: "--gutter-bleed", label: "gutter bleed", min: 0, max: 24, step: 1, unit: "px" },
];

const TUNER_COLORS = [
  ["--edge-color", "edge colour"],
  ["--gutter-tint", "gutter tint"],
];

const TUNER_EASES = [
  ["in-out cubic (default)", "cubic-bezier(0.645, 0.045, 0.355, 1)"],
  ["linear", "linear"],
  ["out quad", "cubic-bezier(0.25, 0.46, 0.45, 0.94)"],
  ["in-out quart", "cubic-bezier(0.77, 0, 0.175, 1)"],
  ["snap out", "cubic-bezier(0.16, 1, 0.3, 1)"],
  ["overshoot", "cubic-bezier(0.34, 1.36, 0.64, 1)"],
];

/* Listed in the same order as the :root block, so the export pastes straight
   over it. */
const TUNER_EXPORT = [
  "--flip-duration",
  "--flip-ease",
  "--book-tilt",
  "--leaf-wedge",
  "--fan-x-ratio",
  "--fan-w-ratio",
  "--paper-z",
  "--edge-thickness",
  "--edge-color",
  "--gutter-tint",
  "--gutter-shade",
  "--gutter-bleed",
  "--perspective-ratio",
];

function tunerRead(name) {
  return rootStyle.getPropertyValue(name).trim();
}

// The slider's step carries the precision: 0.00125 needs 5 decimals, 10 none.
function tunerDecimals(step) {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function buildTuner() {
  if (!tunerEnabled() || document.querySelector(".tuner")) return;

  // Captured before any knob moves, so RESET restores the stylesheet's values
  // rather than whatever the panel happened to open with.
  const defaults = new Map(TUNER_EXPORT.map((name) => [name, tunerRead(name)]));
  const syncers = [];

  const panel = document.createElement("aside");
  panel.className = "tuner";

  const head = document.createElement("header");
  head.className = "tuner-head";
  const title = document.createElement("span");
  title.className = "tuner-title";
  title.textContent = "flip tuner";
  const collapse = document.createElement("button");
  collapse.type = "button";
  collapse.className = "tuner-collapse";
  collapse.textContent = "–";
  collapse.setAttribute("aria-expanded", "true");
  collapse.setAttribute("aria-label", "Collapse the tuner");
  head.append(title, collapse);

  const body = document.createElement("div");
  body.className = "tuner-body";

  const note = document.createElement("p");
  note.className = "tuner-note";
  note.textContent = "Switch to Refine (book) to see these.";
  body.appendChild(note);

  const out = document.createElement("textarea");
  out.className = "tuner-out";
  out.readOnly = true;
  out.rows = 11;
  out.spellcheck = false;
  out.setAttribute("aria-label", "Current tuning as CSS");

  const apply = () => {
    readFlipTokens();
    layoutSurfaces();
    out.value = TUNER_EXPORT.map((name) => `  ${name}: ${tunerRead(name)};`).join("\n");
  };

  // A labelled row wrapping one control, so clicking the label focuses it.
  function addRow(label, control) {
    const row = document.createElement("label");
    row.className = "tuner-row";
    const rowHead = document.createElement("span");
    rowHead.className = "tuner-row-head";
    const name = document.createElement("span");
    name.className = "tuner-label";
    name.textContent = label;
    rowHead.append(name);
    row.append(rowHead, control);
    body.appendChild(row);
    return rowHead;
  }

  TUNER_KNOBS.forEach((knob) => {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "tuner-range";
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String(knob.step);

    const value = document.createElement("span");
    value.className = "tuner-value";

    const decimals = tunerDecimals(knob.step);
    const paint = () => {
      const suffix = knob.show || knob.unit;
      value.textContent = `${Number(input.value).toFixed(decimals)}${suffix}`;
    };

    // token() rather than parseFloat, so a deliberate 0 survives.
    const load = () => {
      input.value = String(token(knob.name, knob.min));
      paint();
    };
    load();
    syncers.push(load);

    input.addEventListener("input", () => {
      document.documentElement.style.setProperty(
        knob.name,
        `${input.value}${knob.unit}`
      );
      paint();
      apply();
    });

    addRow(knob.label, input).append(value);
  });

  const ease = document.createElement("select");
  ease.className = "tuner-select";
  TUNER_EASES.forEach(([label, curve]) => {
    const option = document.createElement("option");
    option.value = curve;
    option.textContent = label;
    ease.appendChild(option);
  });
  // A curve not in the list leaves the select on its first entry, which is the
  // default anyway — so there is nothing to reconcile.
  ease.value = tunerRead("--flip-ease");
  ease.addEventListener("change", () => {
    document.documentElement.style.setProperty("--flip-ease", ease.value);
    apply();
  });
  addRow("flip ease", ease);
  syncers.push(() => {
    ease.value = defaults.get("--flip-ease");
  });

  TUNER_COLORS.forEach(([name, label]) => {
    const color = document.createElement("input");
    color.type = "color";
    color.className = "tuner-color";
    color.value = tunerRead(name);
    color.addEventListener("input", () => {
      document.documentElement.style.setProperty(name, color.value);
      apply();
    });
    addRow(label, color);
    syncers.push(() => {
      color.value = defaults.get(name);
    });
  });

  const foot = document.createElement("div");
  foot.className = "tuner-foot";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "tuner-btn";
  copy.textContent = "COPY";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "tuner-btn";
  reset.textContent = "RESET";
  foot.append(copy, reset);

  copy.addEventListener("click", () => {
    // The clipboard API needs a secure context — localhost qualifies, but fall
    // back to selecting the textarea so the values are never trapped.
    const fallback = () => {
      out.select();
      notify("Couldn't reach the clipboard — copy the selection.");
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(out.value)
        .then(() => notify("Tuning copied."), fallback);
    } else {
      fallback();
    }
  });

  reset.addEventListener("click", () => {
    defaults.forEach((value, name) => {
      document.documentElement.style.setProperty(name, value);
    });
    syncers.forEach((sync) => sync());
    apply();
  });

  collapse.addEventListener("click", () => {
    const willOpen = body.hidden;
    body.hidden = !willOpen;
    collapse.textContent = willOpen ? "–" : "+";
    collapse.setAttribute("aria-expanded", String(willOpen));
    collapse.setAttribute(
      "aria-label",
      willOpen ? "Collapse the tuner" : "Expand the tuner"
    );
  });

  body.append(out, foot);
  panel.append(head, body);
  document.body.appendChild(panel);
  apply();
}

// Ticks and labels first — syncScrubber() runs inside the first render.
buildScrubber();
render();
syncChrome();
layoutSurfaces();
buildTuner();
window.addEventListener("hashchange", buildTuner);
window.addEventListener("resize", debounce(layoutSurfaces, 100));
window.addEventListener("load", layoutSurfaces);
