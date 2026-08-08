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

const modeToggle = document.querySelector(".mode-toggle");
const modeBtns = Array.from(document.querySelectorAll(".mode-btn"));
const refineEl = document.getElementById("refine");
const browseEl = document.getElementById("refine-browse");
const bookEl = document.getElementById("book");
const editorEl = document.getElementById("editor");
const editorFrame = document.getElementById("editor-frame");
const scrubberEl = document.getElementById("scrubber");
const scrubTrack = document.getElementById("scrub-track");
const scrubThumb = document.getElementById("scrub-thumb");
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
  // Last net under the FILE_KINDS table: a format that is image/* but that this
  // browser cannot decode (an exotic TIFF, a JPEG XL, a truncated download)
  // would otherwise sit in the page as a filled slot that paints nothing and
  // prints blank. Unlike onload this has to re-render — the slot goes back to
  // being empty — but it can only fire moments after a drop or a pick, never
  // while the cover fields are being typed into.
  probe.onerror = () => {
    if (page.photo !== photo) return; // already superseded by another pick
    URL.revokeObjectURL(url);
    page.photo = null;
    render();
    syncChrome();
    notify([`“${file.name}” couldn’t be opened.`, PHOTO_FORMATS]);
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

/* --------------------------------------------------------------------------
   Naming what was rejected

   The picker carries accept="image/*", but a drop bypasses it entirely, so a
   .docx only ever gets named here. Each kind matches on MIME first and falls
   back to the extension, because files dragged out of some file managers — and
   every dropped folder — arrive with an empty `type`.

   HEIC and Photoshop are in the table even though both are image/*: no browser
   paints them in an <img>, so without an entry they would clear the gate and
   land as a blank page. Anything else undecodable is caught by setPhoto's
   probe.onerror, so this table only has to cover what's worth naming.
   -------------------------------------------------------------------------- */

const PHOTO_FORMATS = "Minikomi takes JPEG, PNG, GIF, WebP or AVIF.";

const FILE_KINDS = [
  { label: "HEIC photos", mime: /^image\/hei[cf]/, ext: ["heic", "heif"] },
  { label: "Photoshop files", mime: /photoshop/, ext: ["psd", "psb"] },
  {
    label: "Word documents",
    mime: /msword|wordprocessingml|opendocument\.text/,
    ext: ["doc", "docx", "odt", "rtf", "pages"],
  },
  { label: "PDFs", mime: /^application\/pdf$/, ext: ["pdf"] },
  {
    label: "Spreadsheets",
    mime: /ms-excel|spreadsheetml|opendocument\.spreadsheet/,
    ext: ["xls", "xlsx", "ods", "csv", "numbers"],
  },
  {
    label: "Presentations",
    mime: /ms-powerpoint|presentationml|opendocument\.presentation/,
    ext: ["ppt", "pptx", "odp", "key"],
  },
  {
    label: "Audio files",
    mime: /^audio\//,
    ext: ["mp3", "wav", "m4a", "aac", "flac", "ogg", "aiff", "wma"],
  },
  {
    label: "Videos",
    mime: /^video\//,
    ext: ["mp4", "mov", "avi", "mkv", "webm", "m4v"],
  },
  {
    label: "Archives",
    mime: /zip|x-rar|x-7z|x-tar|gzip/,
    ext: ["zip", "rar", "7z", "tar", "gz", "dmg", "iso"],
  },
  { label: "Text files", mime: /^text\//, ext: ["txt", "md", "log"] },
];

// Only consulted when `type` is empty — a browser that knows the format at all
// reports it as image/*.
const PHOTO_EXT = ["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "ico"];

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function matchedKind(file) {
  const type = file.type || "";
  const ext = extensionOf(file.name || "");
  return (
    FILE_KINDS.find(
      (kind) =>
        (type && kind.mime.test(type)) || (ext && kind.ext.includes(ext))
    ) || null
  );
}

function isPhoto(file) {
  if (matchedKind(file)) return false;
  const type = file.type || "";
  if (type.startsWith("image/")) return true;
  return !type && PHOTO_EXT.includes(extensionOf(file.name || ""));
}

function joinLabels(labels) {
  if (labels.length < 2) return labels[0] || "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** "Word documents and audio files can't be added." */
function rejectionMessage(rejects) {
  const labels = [];
  for (const file of rejects) {
    const kind = matchedKind(file);
    // An unrecognised extension names itself — ".xyz files" beats "other files"
    // when the drop was a single mystery file.
    const ext = extensionOf(file.name || "");
    const label = kind ? kind.label : ext ? `.${ext} files` : "unnamed files";
    if (!labels.includes(label)) labels.push(label);
  }
  const listed = labels.length > 3 ? [...labels.slice(0, 2), "other files"] : labels;
  const sentence = `${joinLabels(listed)} can’t be added.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/**
 * One toast for whatever a drop couldn't do. Rejected kinds lead, because a
 * wrong file type is the harder failure; counts follow. When rejection is the
 * only thing to say, the list of accepted formats rides along as the answer to
 * "then what can I add?".
 */
function reportDrop(rejects, ...countLines) {
  const lines = countLines.filter(Boolean);
  if (rejects.length > 0) lines.unshift(rejectionMessage(rejects));
  if (lines.length === 1 && rejects.length > 0) lines.push(PHOTO_FORMATS);
  if (lines.length > 0) notify(lines);
}

/**
 * Routes a set of dropped/picked files into pages.
 * - replace: swaps the photo at startIndex, first file only
 * - fill: startIndex (when empty) first, then remaining empties — forward
 *   from startIndex before wrapping — so picking 3 photos on page 5 fills
 *   5, 6, 7 rather than jumping back to the start.
 *
 * Anything it declines to place is reported through reportDrop, so a drop is
 * never silently partly-ignored.
 */
function assignPhotos(fileList, startIndex, mode) {
  const all = Array.from(fileList || []);
  if (all.length === 0) return;

  const files = all.filter(isPhoto);
  const rejects = all.filter((f) => !isPhoto(f));

  if (files.length === 0) {
    reportDrop(rejects);
    return;
  }

  if (mode === "replace" && typeof startIndex === "number") {
    setPhoto(startIndex, files[0]);
    render();
    syncChrome();
    const extra = files.length - 1;
    reportDrop(
      rejects,
      extra > 0
        ? `Replaced with the first photo — ${extra} more skipped.`
        : ""
    );
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
    reportDrop(rejects, "All 8 pages are full — delete or replace one first.");
    return;
  }

  const used = Math.min(files.length, targets.length);
  for (let i = 0; i < used; i++) setPhoto(targets[i], files[i]);

  render();
  syncChrome();

  // Report what landed rather than what didn't: the count of imported photos is
  // what the user is about to check against the grid.
  const skipped = files.length - used;
  reportDrop(
    rejects,
    skipped > 0
      ? `Only ${used} of ${files.length} photos ${
          used === 1 ? "was" : "were"
        } added.`
      : "",
    skipped > 0 ? "A zine has 8 pages — delete one to swap another in." : ""
  );
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

function buildEmptyPlaceholder(index) {
  const empty = document.createElement("div");
  empty.className = "slot-empty";
  empty.setAttribute("role", "button");
  empty.setAttribute("tabindex", "0");
  empty.setAttribute(
    "aria-label",
    index === 0 ? "Upload cover photo" : `Upload photo for page ${index}`
  );
  empty.addEventListener("click", () => openPicker(index, "fill"));
  empty.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker(index, "fill");
    }
  });

  const label = document.createElement("span");
  label.className = "slot-empty-label";
  label.textContent = "Upload image";
  empty.appendChild(label);

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

// Indices are positional, so they have to follow the live DOM moves —
// otherwise a mid-drag file drop would target the wrong page.
function refreshPositions() {
  Array.from(grid.children).forEach((el, i) => {
    el.dataset.index = String(i);
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
  // Closing the crop editor back to Arrange is the one case that skips the
  // morph: flying tiles out of a single full-bleed editor frame wouldn't read
  // as anything, and it's a rare path.
  const wasEditing = state.editing !== null;
  state.mode = mode;
  if (mode !== "refine") state.editing = null;

  modeBtns.forEach((btn) =>
    btn.classList.toggle("active", btn.dataset.mode === mode)
  );
  modeToggle.dataset.mode = mode;

  if (reducedMotion || wasEditing) {
    grid.hidden = mode !== "arrange";
    refineEl.hidden = mode !== "refine";
    render();
    syncChrome();
    return;
  }

  morphModes(mode === "refine");
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
let FAN_OUT_RATIO; // fore-edge extension per pile step, as a ratio of page width
let FAN_SHRINK_RATIO; // height reduction per pile step
let BOOK_TILT; // deg of open-book lean
let LEAF_WEDGE; // half-angle of the V each leaf is folded into, deg
let PERSPECTIVE_RATIO; // of page width, so the look is size-invariant
let PAPER_Z; // px of z-separation per true depth; breaks coplanarity
let BOOK_SPAN; // total width to reserve, in page widths
let ROT_RIGHT; // rest angle, right side
let ROT_FLIPPED; // rest angle, turned onto the left
let FLIP_MS; // tracks --flip-duration; drives the settle timer in liftRange
let DETENT_BREAKAWAY; // 0..1, fraction of a detent's span before the thumb releases
let DETENT_STRAIN_MAX; // px, visible "give" at the breakaway threshold

/**
 * BOOK_SPAN — how wide the deck is, in page widths. A receding page stays pinned
 * to the spine and splays at the fore-edge only, so each side reaches
 * 1 + FAN_OUT * maxPileDepth page widths out: 0.025 of a page of overhang per
 * side at the defaults.
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
  FAN_OUT_RATIO = token("--fan-out-ratio", 0.0125);
  FAN_SHRINK_RATIO = token("--fan-shrink-ratio", 0.03125);
  BOOK_TILT = token("--book-tilt", 5);
  LEAF_WEDGE = token("--leaf-wedge", 5);
  PERSPECTIVE_RATIO = token("--perspective-ratio", 3.5);
  PAPER_Z = token("--paper-z", 0.5);
  // Each side reaches (1 + out * maxPileDepth) page-widths from the spine, and
  // maxPileDepth is MAX_DEPTH - 1 because pile depth collapses the top two pages
  // of each pile onto 0.
  BOOK_SPAN = 2 * (1 + FAN_OUT_RATIO * (MAX_DEPTH - 1)); // 2.05
  ROT_RIGHT = -(BOOK_TILT + LEAF_WEDGE);
  ROT_FLIPPED = -(180 - BOOK_TILT - LEAF_WEDGE);
  FLIP_MS = reducedMotion ? 0 : token("--flip-duration", 400);
  DETENT_BREAKAWAY = token("--detent-breakaway", 0.65);
  DETENT_STRAIN_MAX = token("--detent-strain-max", 2);
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
 * A leaf's rest state at a given depth.
 *
 * EVERY PAGE IS BOUND AT THE SPINE. `left` is always `pageW` — the spine — for
 * both sides, and since a leaf pivots on `transform-origin: left center`, no
 * rotation ever moves that edge. So the inner edge of every page, at every
 * depth, sits exactly on the spine. Two consequences:
 *   - the gutter cannot open, at any scene or fraction, trivially;
 *   - the deck reads as a *bound* book. The fan used to translate whole pages
 *     away from the spine, which detached them and made the book look like a
 *     pile of loose sheets.
 * The fan instead grows the page's WIDTH so it splays at the fore-edge only,
 * which is what a real book's pages do.
 *
 * PILE DEPTH is the other half. Geometry comes from `max(0, d - 1)`, not from
 * `d`, so the top TWO pages of a pile share one box at full size. The page under
 * the turning leaf is therefore already in its final place and gets *uncovered*
 * rather than grown, and the page opposite stays put rather than receding.
 *
 * The box is non-uniform — width grows while height shrinks — which is why
 * applyScene scales page content on both axes. Both factors are exactly 1 at pile
 * depth 0, so every page you can actually read is undistorted; the stretch only
 * lands on fore-edge slivers nobody looks at.
 *
 * `d` in the returned slot stays the TRUE depth. z-index and bury() both read it,
 * and collapsing those as well would leave the covered top-of-pile page sorted
 * level with its cover and reachable by click and Tab.
 */
function slotAtDepth(flipped, d) {
  const v = Math.max(0, d - 1);
  return {
    left: pageW, // the spine — every page is bound here
    w: pageW + pageW * FAN_OUT_RATIO * v,
    h: pageH - pageH * FAN_SHRINK_RATIO * v,
    rot: flipped ? ROT_FLIPPED : ROT_RIGHT,
    d,
  };
}

/**
 * How far the spine sits from the book's own centre at a settled scene: 0 at
 * the ends, where only one page is drawn (Cover alone at scene 0, page 7
 * alone at LEAF_COUNT), because a lone page reads best on the centre line,
 * not the spine. Zero everywhere a spread is showing, where the spine
 * already IS the centre line.
 */
function shiftAtScene(i) {
  if (i <= 0) return -pageW / 2;
  if (i >= LEAF_COUNT) return pageW / 2;
  return 0;
}

/**
 * bookShift(t) — companion to slotAtDepth, read by applyScene() and applied
 * to .book itself via --book-shift (translateX). Linear between the two
 * scenes bracketing `t`, same interpolation style as the leaf lerps below, so
 * a half-turned cover has the spine half way through its slide.
 *
 * Deliberately linear rather than eased to the 90° crossing (where the
 * opposite page actually appears) — easier to tune by eye later than to
 * argue about now. Swap the lerp below for a smoothstep
 * (f * f * (3 - 2 * f)) if the linear version reads as off-centre mid-turn.
 */
function bookShift(t) {
  const i = clamp(Math.floor(t), 0, LEAF_COUNT);
  const f = clamp(t - i, 0, 1);
  const from = shiftAtScene(i);
  const to = shiftAtScene(Math.min(i + 1, LEAF_COUNT));
  return from + f * (to - from);
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

  // Recentres a lone Cover/page-7 on screen and slides the spine back to the
  // middle as the opposite page arrives. One property, read by every path
  // that reaches here — rest states, the scrub drag, keyboard jumps, a
  // resize's instant re-land — so the book and the flight below it can never
  // disagree about where the spine is.
  bookEl.style.setProperty("--book-shift", `${bookShift(t).toFixed(2)}px`);

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

    // The fan reshapes background pages; their content scales rather than
    // reflowing. See .page-content in styles.css. Non-uniform because the fan
    // grows width and reduces height independently — both are exactly 1 at pile
    // depth 0, so no page anyone reads is ever distorted.
    const sx = slot.w / pageW;
    const sy = pageH ? slot.h / pageH : sx;
    el.querySelectorAll(".page-content").forEach((box) => {
      box.style.transform = `scale(${sx}, ${sy})`;
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
   Mode morph (Arrange <-> Refine)
   ==========================================================================
   Toggling modes flies all 8 pages together rather than cutting: flying in,
   the Arrange tiles converge on the fanned deck; flying out, they leave it and
   land back on the 4x2 grid. Same choreography both ways — only the keyframe
   order (and which surface fades in vs. out) flips.

   The tiles themselves are always what fly, never the book's own leaves.
   `slotAtDepth`/`depthAt` (the book's own geometry, see "Refine — the book"
   above) give each page's book-side box; that box is applied to the matching
   Arrange tile as a flat translate+scale — no rotation, no perspective. The
   two faces sharing a leaf (2j front, 2j+1 back) land on the same box, which
   is correct: one arrives at opacity 1 as the book's real page, the other
   fades to 0 exactly as bury() would hide it. The small rest tilt the real
   book applies (BOOK_TILT/LEAF_WEDGE) is left out of the flight on purpose —
   the book cross-fades in underneath at the same spot, so the couple of
   pixels of difference along the outer edge never becomes visible on its own.

   Both surfaces stay mounted and share .grid-wrap (see .grid/.refine in
   styles.css) for the length of the flight — a deliberate exception to
   render()'s "one dispatcher" rule, needed because both sets of rects have to
   exist at once to compute the flight. */

const MORPH_DURATION = token("--morph-duration", 320);
const MORPH_STAGGER = reducedMotion ? 0 : token("--morph-stagger", 28);
const MORPH_EASE = rootStyle.getPropertyValue("--morph-ease").trim() || "ease";

let morphGen = 0;
let morphAnimations = [];

function cancelMorph() {
  // .cancel() reverts to the underlying style, which for these tiles is
  // always empty (their flight is pure WAAPI, never written to inline
  // transform/opacity directly) — so a cancelled morph always snaps cleanly
  // to plain identity, a safe state regardless of which direction it was mid-
  // flight in.
  morphAnimations.forEach((a) => {
    try {
      a.cancel();
    } catch {
      /* already finished */
    }
  });
  morphAnimations = [];
}

/**
 * True if page `p`'s leaf is showing that page's face (as opposed to its
 * sibling on the other side of the same leaf) once the book settles at spread
 * `i`. Mirrors the visibility half of bury() in applyScene() exactly — kept
 * in sync deliberately, since this is what decides which of a leaf's two
 * pages fades in versus out during the flight.
 */
function pageFacesCamera(p, i) {
  const j = p >> 1;
  const flipped = j < i;
  const isFront = p % 2 === 0;
  return isFront ? !flipped : flipped;
}

/**
 * Flat (no-rotation) viewport box for page `p`'s leaf at spread `i`, derived
 * from the same slotAtDepth() the real book positions itself with. `slot.left`
 * is always the spine (every page is bound there), and a turned leaf hangs off
 * it to the LEFT — so its visual left edge is a page width back. applyScene
 * never needs that subtraction because it positions a leaf that then rotates
 * itself onto the correct side; here there is no rotation, so the visual edge
 * has to be resolved up front.
 */
function bookBoxFor(p, i, bookRect) {
  const j = p >> 1;
  const flipped = j < i;
  const slot = slotAtDepth(flipped, depthAt(j, i));
  const visualLeft = flipped ? slot.left - slot.w : slot.left;
  return {
    left: bookRect.left + visualLeft,
    top: bookRect.top + (bookRect.height - slot.h) / 2,
    width: slot.w,
    height: slot.h,
  };
}

function finishMorph(toRefine, tiles) {
  tiles.forEach((tile) => {
    tile.getAnimations().forEach((a) => a.cancel());
    tile.style.transform = "";
    tile.style.opacity = "";
    tile.style.zIndex = "";
  });
  refineEl.getAnimations().forEach((a) => a.cancel());
  refineEl.style.opacity = "";
  refineEl.style.zIndex = "";
  grid.style.zIndex = "";

  grid.hidden = toRefine;
  refineEl.hidden = !toRefine;
  grid.inert = false;
  refineEl.inert = false;
  document.body.classList.remove("is-morphing");
}

/**
 * Flies all 8 Arrange tiles between the grid and the book. Called from
 * setMode() instead of render() for this one transition — both surfaces have
 * to stay mounted at once so their rects can be measured, which is the
 * deliberate exception noted above.
 */
function morphModes(toRefine) {
  const gen = ++morphGen;
  cancelMorph();

  document.activeElement?.blur?.();
  document.body.classList.add("is-morphing");
  grid.inert = true;
  refineEl.inert = true;

  // Both directions need Arrange's natural (resting) tile rects — flying in,
  // that's the start; flying out, the end. renderArrange() is cheap and
  // guarantees fresh elements with no leftover drag/focus state.
  grid.hidden = false;
  renderArrange();

  refineEl.hidden = false;
  browseEl.hidden = false;
  editorEl.hidden = true;
  const spread = state.spread;
  if (toRefine) {
    // Flying out, the book is already sitting at this spread — only flying in
    // needs it (re)built and landed instantly before its rect is read.
    buildBook();
    instantly(() => applyScene(spread));
    syncScrubber();
  }

  // Grid always renders on top while tiles are in flight, whichever surface
  // is conceptually "arriving" — the flight is the thing to look at. Its own
  // opacity is set by the animate() call below, whose first keyframe matches.
  grid.style.zIndex = "2";
  refineEl.style.zIndex = "1";

  const bookRect = bookEl.getBoundingClientRect();
  const tiles = [];

  for (let p = 0; p < PAGE_COUNT; p++) {
    const tile = grid.children[p];
    if (!tile) continue;
    tiles.push(tile);

    const tileRect = tile.getBoundingClientRect();
    const box = bookBoxFor(p, spread, bookRect);
    const visible = pageFacesCamera(p, spread);

    const dx = box.left + box.width / 2 - (tileRect.left + tileRect.width / 2);
    const dy = box.top + box.height / 2 - (tileRect.top + tileRect.height / 2);
    const sx = box.width / tileRect.width;
    const sy = box.height / tileRect.height;

    const identity = "translate(0px, 0px) scale(1, 1)";
    const inBook = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;

    // Deck order: flying in, the back page departs its cell first and the
    // cover lands last (it ends on top of the pile); flying out, the reverse
    // — the cover leaves the pile first.
    const order = toRefine ? PAGE_COUNT - 1 - p : p;
    const d = depthAt(p >> 1, spread);
    tile.style.zIndex = String(visible ? 300 - d : 50 + d);

    const keyframes = toRefine
      ? [
          { transform: identity, opacity: 1 },
          { transform: inBook, opacity: visible ? 1 : 0 },
        ]
      : [
          { transform: inBook, opacity: visible ? 1 : 0 },
          { transform: identity, opacity: 1 },
        ];

    morphAnimations.push(
      tile.animate(keyframes, {
        duration: MORPH_DURATION,
        delay: order * MORPH_STAGGER,
        easing: MORPH_EASE,
        fill: "both",
      })
    );
  }

  // The book cross-fades as a whole, timed to the tiles' full stagger span —
  // invisible/visible for the first half, then fading over the second, so it
  // only becomes the thing on screen once tiles have started arriving.
  const span = MORPH_DURATION + (PAGE_COUNT - 1) * MORPH_STAGGER;
  morphAnimations.push(
    refineEl.animate(
      toRefine
        ? [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.5 },
            { opacity: 1, offset: 1 },
          ]
        : [
            { opacity: 1, offset: 0 },
            { opacity: 0, offset: 0.5 },
            { opacity: 0, offset: 1 },
          ],
      { duration: span, easing: "linear", fill: "both" }
    )
  );

  Promise.all(morphAnimations.map((a) => a.finished.catch(() => {}))).then(() => {
    if (gen !== morphGen) return; // superseded by a newer morph mid-flight
    finishMorph(toRefine, tiles);
  });
}

/* ==========================================================================
   Refine — scrub bar
   ==========================================================================
   Navigation and position indicator in one control: drag it to flip spreads,
   read it (via aria-valuetext) to see where you are in the booklet. No
   visible text labels — see styles.css for why.

   Stops and ticks are derived from SPREADS, like the page labels, so the fold
   layout stays the single source of truth.

   A fixed-px pill, not sized off --page-w (styles.css). script.js writes only
   a unitless fraction per element (0..1); every actual dimension — thumb
   width, travel range, the border/padding inset — is CSS's, computed once in
   :root from --scrub-w/h/pad. SCRUB_TRAVEL_PX below is the one place that
   maths gets duplicated into JS, and only because sceneFromPointer has to
   convert a raw pointer position into that same fraction; it's derived from
   the same tokens CSS reads, via token(), so the two can't drift.
   ========================================================================== */

const LAST_SPREAD = SPREADS.length - 1;

// Mirrors styles.css's geometry exactly: an inner width (padding-box, border
// subtracted) the thumb travels across. --scrub-thumb-w is a literal in
// :root, not derived, so it's read with token() rather than recomputed here
// — same source both sides, so they can't drift.
const SCRUB_BORDER_PX = token("--scrub-border-w", 0);
const SCRUB_PAD_PX = token("--scrub-pad-x", 8); // horizontal inset — --scrub-pad is vertical only
const SCRUB_INNER_PX = token("--scrub-w", 320) - SCRUB_BORDER_PX * 2;
const SCRUB_THUMB_PX = token("--scrub-thumb-w", 52);
const SCRUB_TRAVEL_PX = SCRUB_INNER_PX - SCRUB_PAD_PX * 2 - SCRUB_THUMB_PX;

// Fraction along the track, 0 → 1. Evenly spaced, one stop per spread. Also
// doubles as the thumb's travel fraction — `pos` may be non-integer.
function spreadFraction(pos) {
  return LAST_SPREAD === 0 ? 0 : pos / LAST_SPREAD;
}

// Spoken form, for aria-valuetext.
function spreadAria(index) {
  const pages = SPREADS[index];
  if (pages.length === 1) {
    return pages[0] === 0 ? "Cover" : `Page ${pages[0]}`;
  }
  return `Pages ${pages.join(" and ")}`;
}

// Ground texture, aligned to the real stops rather than independent of them:
// 29 grid positions (28 gaps) means every 7th (28 / LAST_SPREAD) lands
// exactly on a SPREADS fraction, so that one is skipped in favour of the
// taller .scrub-tick--stop drawn at that same position below — 6 dots
// between each pair of stops, and the two tiers share positions instead of
// drifting past each other. Only exact if (SCRUB_MARK_COUNT - 1) divides
// evenly by LAST_SPREAD; keep them in step if either ever changes.
const SCRUB_MARK_COUNT = 29;
const SCRUB_STOP_STRIDE = (SCRUB_MARK_COUNT - 1) / LAST_SPREAD;
// One detent per grid position — the unit scrubDrag() (below) measures the
// breakaway threshold in.
const SCENE_PER_DETENT = LAST_SPREAD / (SCRUB_MARK_COUNT - 1);

function buildScrubber() {
  scrubTrack.setAttribute("aria-valuemax", String(LAST_SPREAD));
  scrubTrack.querySelectorAll(".scrub-tick").forEach((el) => el.remove());

  for (let i = 0; i < SCRUB_MARK_COUNT; i++) {
    if (i % SCRUB_STOP_STRIDE === 0) continue; // a stop mark lands here instead
    const tick = document.createElement("div");
    tick.className = "scrub-tick";
    tick.style.setProperty("--tick-pos", String(i / (SCRUB_MARK_COUNT - 1)));
    tick.setAttribute("aria-hidden", "true");
    // Appended after the thumb (already in index.html); its z-index:2 is
    // what keeps IT painting on top, covering whichever marks it's parked
    // over — see .scrub-thumb in styles.css.
    scrubTrack.appendChild(tick);
  }

  // Taller marks at each real stop — where a spread actually sits flat, a
  // turn never parks mid-way — reusing spreadFraction(), the same fraction
  // the thumb itself parks on, so these can't drift from the real stops.
  SPREADS.forEach((_, index) => {
    const stop = document.createElement("div");
    stop.className = "scrub-tick scrub-tick--stop";
    stop.style.setProperty("--tick-pos", String(spreadFraction(index)));
    stop.setAttribute("aria-hidden", "true");
    scrubTrack.appendChild(stop);
  });

  // Arrange is the opening mode, so the first render() never reaches the book —
  // set the thumb explicitly rather than leaning on `auto`.
  syncScrubber();
}

/**
 * `pos` may be fractional mid-drag: the thumb follows the pointer
 * continuously via --scrub-pos, while the announced value snaps to the
 * nearest stop so the readout stays legible while a page is half-turned.
 */
function syncScrubber(pos = state.spread) {
  scrubThumb.style.setProperty("--scrub-pos", String(spreadFraction(pos)));

  const nearest = Math.round(pos);
  scrubTrack.setAttribute("aria-valuenow", String(nearest));
  scrubTrack.setAttribute("aria-valuetext", spreadAria(nearest));
}

let scrubbing = null; // { id, committedIndex } while a drag is in flight

/**
 * Pointer x → a continuous scene, 0 .. LAST_SPREAD. Deliberately not snapped
 * here — scrubDrag() below is what quantizes it, so this function alone
 * still reflects the raw pointer, which is what the breakaway threshold
 * needs to measure against.
 *
 * Maps against the thumb's actual travel range, not the full track: the
 * thumb is a wide block now, not a point, so a pointer at the track's right
 * edge has to land the thumb's CENTRE there, not its left edge (which would
 * run the drag a half-thumb-width ahead of the pointer at both ends).
 */
function sceneFromPointer(clientX) {
  const rect = scrubTrack.getBoundingClientRect();
  if (rect.width === 0) return state.spread;
  // rect.left is the track's outer (border) edge; the containing block for
  // the thumb's `left` starts one border-width further in (the padding box).
  const x =
    clientX - rect.left - SCRUB_BORDER_PX - SCRUB_PAD_PX - SCRUB_THUMB_PX / 2;
  return clamp(x / SCRUB_TRAVEL_PX, 0, 1) * LAST_SPREAD;
}

/**
 * Breakaway detent: the committed position (and so the page and the thumb's
 * `left`) doesn't move until the raw pointer has pulled DETENT_BREAKAWAY of
 * a detent's span past it, at which point it releases to the nearest detent
 * to the pointer — not just one step, so a fast flick can commit several at
 * once. Below that threshold, --scrub-strain (styles.css) shows the pull as
 * a few px of "give" on the thumb without moving its committed `left` at
 * all — a positional warp on the committed value (tried, reverted) read as
 * lag; this reads as resistance because the two are now visibly decoupled.
 */
function scrubDrag(clientX) {
  if (!scrubbing) return;
  const u = sceneFromPointer(clientX) / SCENE_PER_DETENT; // raw pointer, in detent units
  let offset = u - scrubbing.committedIndex;

  if (Math.abs(offset) > DETENT_BREAKAWAY) {
    const next = clamp(Math.round(u), 0, SCRUB_MARK_COUNT - 1);
    if (next !== scrubbing.committedIndex) {
      scrubbing.committedIndex = next;
      offset = u - next;
    }
  }

  const t = scrubbing.committedIndex * SCENE_PER_DETENT;
  // The nearest stop is the committed spread, so releasing — or any other
  // navigation path — resumes from somewhere real.
  state.spread = Math.round(t);
  applyScene(t);
  syncScrubber(t);

  // Scaled so strain reaches exactly DETENT_STRAIN_MAX right at the
  // breakaway threshold, then resets once a commit fires above.
  const strainPx = clamp(
    (offset / DETENT_BREAKAWAY) * DETENT_STRAIN_MAX,
    -DETENT_STRAIN_MAX,
    DETENT_STRAIN_MAX
  );
  scrubThumb.style.setProperty("--scrub-strain", `${strainPx}px`);
}

scrubTrack.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault(); // suppress text selection during the drag
  const startIdx = clamp(
    Math.round(sceneFromPointer(e.clientX) / SCENE_PER_DETENT),
    0,
    SCRUB_MARK_COUNT - 1
  );
  scrubbing = { id: e.pointerId, committedIndex: startIdx };
  scrubThumb.style.setProperty("--scrub-strain", "0px");
  scrubTrack.setPointerCapture(e.pointerId);
  scrubTrack.classList.add("is-scrubbing");
  // Short transitions (styles.css), not none — quantized commits need to
  // actually move the page, and a brief transition is what makes a fast
  // drag's frequent commits blend into one turn while a slow drag's rarer
  // ones read as individual clicks.
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
  scrubThumb.style.setProperty("--scrub-strain", "0px");
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
  syncChrome();
}

function closeEditor() {
  state.editing = null;
  renderRefine();
  syncChrome();
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
   A4 landscape. Superseded 2026-08-01: pages used to sit centred in a full-
   bleed sheet-spanning cell with a 5mm content-safe inset, because 4:5 doesn't
   divide evenly into an A4 eighth (§7's original compromise). The Figma spec
   instead trims the sheet down to an exact 4:5 grid first — 4 columns x 2 rows
   of 196x245pt cells, butted edge to edge with no inset — and prints the
   leftover paper as a cut border around it. Fold creases land on the trimmed
   block's own midlines, not the full sheet's, so trimming has to happen
   before creasing (see FOLD_STEPS — a step was inserted for it).
   ========================================================================== */

const MM_PER_INCH = 25.4;
const PT_PER_INCH = 72;
const DPI = 300;

const SHEET_MM = { w: 297, h: 210 };

// The Figma spec, in points (196x245 = exactly 4:5).
const CELL_PT = { w: 196, h: 245 };
const CELL_MM = {
  w: (CELL_PT.w / PT_PER_INCH) * MM_PER_INCH,
  h: (CELL_PT.h / PT_PER_INCH) * MM_PER_INCH,
}; // 69.14 x 86.43

// 4 columns x 2 rows of cells, trimmed free of the sheet.
const BLOCK_MM = { w: CELL_MM.w * 4, h: CELL_MM.h * 2 }; // 276.58 x 172.86

// Centres the trimmed block on the sheet — this is also where the cut lines
// get drawn, since they run along the block's own edge, not the paper's.
const BLOCK_OFFSET_MM = {
  x: (SHEET_MM.w - BLOCK_MM.w) / 2, // ~10.2mm
  y: (SHEET_MM.h - BLOCK_MM.h) / 2, // ~18.6mm
};

// The page now fills its cell exactly — no inset, nothing left over to centre.
const PAGE_MM = { w: CELL_MM.w, h: CELL_MM.h };
const PAGE_OFFSET_MM = { x: 0, y: 0 };

/**
 * Print resolution, rounded so 4:5 survives as whole pixels. A frame whose
 * pixel ratio drifted a fraction from 4:5 would leave a hairline gap along one
 * edge of an exactly-4:5 photo, because cover-fit would bind on the other axis.
 */
const PAGE_PX = (() => {
  const w = Math.round((PAGE_MM.w / MM_PER_INCH) * DPI / 4) * 4;
  return { w, h: (w / 4) * 5 };
})(); // 816 x 1020

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
      cell.col * CELL_MM.w + BLOCK_OFFSET_MM.x + PAGE_OFFSET_MM.x,
      cell.row * CELL_MM.h + BLOCK_OFFSET_MM.y + PAGE_OFFSET_MM.y,
      PAGE_MM.w,
      PAGE_MM.h
    );
  });

  drawCutMarks(doc);

  doc.save("minikomi.pdf");
}

/**
 * Trim marks around the block, plus a CUT label centred in each margin —
 * vector, drawn straight onto the PDF page rather than baked into the page
 * canvases, so they stay crisp and can never land over a photo.
 *
 * Margin-only ticks, not full-length crosshairs: each line is drawn as the two
 * stubs that live *outside* the block, so the photo edges stay clean and you
 * still line a straightedge up across the sheet. The stub runs from the paper
 * edge to the block corner, which is what makes the two on any given side read
 * as one interrupted line.
 *
 * Weight is deliberately unsubtle. These get cut away, and a mark you have to
 * hunt for is a mark that doesn't work — 0.2mm at 33% ink antialiased to
 * roughly nothing at the zoom most PDF viewers open at.
 *
 * Each label is rotated to read right-side-up once that edge is turned to
 * face the reader (spin the sheet toward you from that edge).
 */
function drawCutMarks(doc) {
  const bx0 = BLOCK_OFFSET_MM.x;
  const by0 = BLOCK_OFFSET_MM.y;
  const bx1 = bx0 + BLOCK_MM.w;
  const by1 = by0 + BLOCK_MM.h;

  doc.setDrawColor(90);
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([1.5, 1.5], 0);

  // Horizontals: stub in from the left paper edge, and in from the right.
  [by0, by1].forEach((y) => {
    doc.line(0, y, bx0, y);
    doc.line(bx1, y, SHEET_MM.w, y);
  });
  // Verticals: stub down from the top paper edge, and up from the bottom.
  [bx0, bx1].forEach((x) => {
    doc.line(x, 0, x, by0);
    doc.line(x, by1, x, SHEET_MM.h);
  });

  doc.setLineDashPattern([], 0);

  doc.setFont("courier", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90);

  const textOpts = { align: "center", baseline: "middle" };
  doc.text("CUT", SHEET_MM.w / 2, by0 / 2, { ...textOpts, angle: 180 });
  doc.text("CUT", SHEET_MM.w / 2, SHEET_MM.h - by0 / 2, { ...textOpts, angle: 0 });
  doc.text("CUT", bx0 / 2, SHEET_MM.h / 2, { ...textOpts, angle: 90 });
  doc.text("CUT", SHEET_MM.w - bx0 / 2, SHEET_MM.h / 2, { ...textOpts, angle: -90 });
}

/* ==========================================================================
   Print — fold-and-cut guide
   ==========================================================================
   Six steps over one SVG. The margin, the trimmed block, the folded strip and
   the finished booklet are separate groups that cross-fade, rather than one
   shape being morphed — flat, legible at modal size, and nothing to go wrong
   across browsers. True perspective folding belongs with the phase 7 flourish.

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
    title: "Trim",
    text: "Cut along the dashed border on all four sides, following the CUT marks. What's left is the working sheet the pages are printed on.",
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
  // The trimmed block, centred on the sheet — same offset the export uses, so
  // this diagram can't drift from what actually prints.
  const bx0 = BLOCK_OFFSET_MM.x;
  const by0 = BLOCK_OFFSET_MM.y;
  const bx1 = bx0 + BLOCK_MM.w;
  const by1 = by0 + BLOCK_MM.h;

  // --- the margin, steps 1-2: what gets trimmed away ----------------------
  const cutLabel = (x, y, angle) =>
    `<text class="fs-cut-label" x="${x}" y="${y}" transform="rotate(${angle} ${x} ${y})">CUT</text>`;
  const margin =
    `<path class="fs-margin-fill" fill-rule="evenodd" d="M0 0H${SHEET_MM.w}V${SHEET_MM.h}H0Z M${bx0} ${by0}H${bx1}V${by1}H${bx0}Z"/>` +
    // Margin-only ticks, matching drawCutMarks — the stubs outside the block,
    // so the page edges stay clean.
    `<g class="fs-trimline">
       <line x1="0" y1="${by0}" x2="${bx0}" y2="${by0}"/>
       <line x1="${bx1}" y1="${by0}" x2="${SHEET_MM.w}" y2="${by0}"/>
       <line x1="0" y1="${by1}" x2="${bx0}" y2="${by1}"/>
       <line x1="${bx1}" y1="${by1}" x2="${SHEET_MM.w}" y2="${by1}"/>
       <line x1="${bx0}" y1="0" x2="${bx0}" y2="${by0}"/>
       <line x1="${bx0}" y1="${by1}" x2="${bx0}" y2="${SHEET_MM.h}"/>
       <line x1="${bx1}" y1="0" x2="${bx1}" y2="${by0}"/>
       <line x1="${bx1}" y1="${by1}" x2="${bx1}" y2="${SHEET_MM.h}"/>
     </g>` +
    cutLabel(SHEET_MM.w / 2, by0 / 2, 180) +
    cutLabel(SHEET_MM.w / 2, SHEET_MM.h - by0 / 2, 0) +
    cutLabel(bx0 / 2, SHEET_MM.h / 2, 90) +
    cutLabel(SHEET_MM.w - bx0 / 2, SHEET_MM.h / 2, -90);

  // --- the trimmed block, steps 1-4 ---------------------------------------
  const cells = IMPOSITION.map(
    (cell, i) =>
      `<image href="${thumbs[i]}" x="${cell.col * cw + bx0 + off.x}" y="${
        cell.row * ch + by0 + off.y
      }" width="${pw}" height="${ph}" preserveAspectRatio="none"/>`
  ).join("");

  const creases = [
    `<line x1="${bx0}" y1="${by0 + ch}" x2="${bx1}" y2="${by0 + ch}"/>`,
    ...[1, 2, 3].map(
      (c) =>
        `<line x1="${bx0 + c * cw}" y1="${by0}" x2="${bx0 + c * cw}" y2="${by1}"/>`
    ),
  ].join("");

  // --- the cut, step 4 -----------------------------------------------------
  // Spans the two middle columns, exactly as on the supplied diagram.
  const cutFrom = bx0 + cw;
  const cutTo = bx0 + cw * 3;
  const cutY = by0 + ch;
  const cut =
    `<line class="fs-halo" x1="${cutFrom}" y1="${cutY}" x2="${cutTo}" y2="${cutY}"/>` +
    `<line class="fs-cutline" x1="${cutFrom}" y1="${cutY}" x2="${cutTo}" y2="${cutY}"/>` +
    [cutFrom, (cutFrom + cutTo) / 2, cutTo].map((x) => scissors(x, cutY)).join("");

  // --- the folded strip, step 5 ------------------------------------------
  // Half height, so the block's midline is now its top edge and the cut is an
  // opening along it. Only the bottom row faces this way.
  const stripY = (SHEET_MM.h - ch) / 2;
  const bottomRow = IMPOSITION.map((cell, i) => ({ ...cell, i })).filter(
    (cell) => cell.row === 1
  );
  const strip =
    `<path class="fs-paper-edge" d="M${bx0} ${stripY}L${cutFrom} ${stripY}M${cutTo} ${stripY}L${bx1} ${stripY}
       M${bx0} ${stripY}L${bx0} ${stripY + ch}L${bx1} ${stripY + ch}L${bx1} ${stripY}"/>` +
    `<line class="fs-slit" x1="${cutFrom}" y1="${stripY}" x2="${cutTo}" y2="${stripY}"/>` +
    bottomRow
      .map(
        (cell) =>
          `<image href="${thumbs[cell.i]}" x="${cell.col * cw + bx0 + off.x}" y="${
            stripY + off.y
          }" width="${pw}" height="${ph}" preserveAspectRatio="none"/>`
      )
      .join("") +
    arrow(bx0 + 14, stripY + ch + 16, bx0 + 52, stripY + ch + 16) +
    arrow(bx1 - 14, stripY + ch + 16, bx1 - 52, stripY + ch + 16);

  // --- the finished booklet, step 6 ---------------------------------------
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
      <g class="fs-margin">${margin}</g>
      <g class="fs-sheet">
        <rect class="fs-paper" x="${bx0}" y="${by0}" width="${BLOCK_MM.w}" height="${BLOCK_MM.h}" rx="1"/>
        ${cells}
        <g class="fs-creases">${creases}</g>
      </g>
      <g class="fs-folds">
        ${arrow(SHEET_MM.w / 2 - 42, by0 + 16, SHEET_MM.w / 2 - 42, by1 - 16)}
        ${arrow(bx0 + 24, SHEET_MM.h / 2 - 34, bx1 - 24, SHEET_MM.h / 2 - 34)}
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

/**
 * `message` is one string, or several — the first line carries what happened
 * and the rest are set quieter, for the explanation and the way out. Multi-line
 * notices linger longer, since there's more to read.
 */
function notify(message) {
  const lines = Array.isArray(message) ? message.filter(Boolean) : [message];
  if (lines.length === 0) return;

  noticeEl.replaceChildren(
    ...lines.map((text, i) => {
      const line = document.createElement("span");
      line.className = i === 0 ? "notice-line" : "notice-line notice-line--sub";
      line.textContent = text;
      return line;
    })
  );
  noticeEl.classList.add("is-visible");
  clearTimeout(noticeTimer);
  const dwell = lines.length > 1 ? 5000 : 3200;
  noticeTimer = setTimeout(() => noticeEl.classList.remove("is-visible"), dwell);
}

function syncChrome() {
  const count = photoCount();
  // The hint points at the empty Arrange grid, so it has no business in Refine.
  hintEl.classList.toggle("is-hidden", count > 0 || state.mode !== "arrange");
  // The scrub bar now lives in the always-visible toolbar (phase 13), not
  // inside #refine-browse — it no longer gets tabindex/focus stripped for
  // free by that element's `hidden` when collapsed in Arrange or covered by
  // the crop editor. inert does both jobs explicitly.
  scrubberEl.inert = !(state.mode === "refine" && state.editing === null);
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

  // A resize mid-morph invalidates every rect the flight measured against.
  // Cancel it and land directly in the mode already being switched to, rather
  // than let stale positions finish animating into a size that no longer
  // exists.
  if (morphAnimations.length) {
    const toRefine = state.mode === "refine";
    const tiles = Array.from(grid.children);
    morphGen++;
    cancelMorph();
    finishMorph(toRefine, tiles);
  }

  const pad = getComputedStyle(wrap);
  const availW =
    wrap.clientWidth -
    parseFloat(pad.paddingLeft) -
    parseFloat(pad.paddingRight) -
    SAFETY_MARGIN;
  const availH =
    wrap.clientHeight -
    parseFloat(pad.paddingTop) -
    parseFloat(pad.paddingBottom) -
    SAFETY_MARGIN;

  setTileVars("--tile-w", "--tile-h", fitTiles(availW, availH, 4, 2, GRID_GAP));
  // The book is BOOK_SPAN page-widths across, not 2 — the fan overhangs the
  // resting spread and .grid-wrap clips. fitTiles takes that as a fractional
  // column count, which with no gap reduces to availW / BOOK_SPAN.
  //
  // The height budget also has to leave room for the turning page's own
  // bulge. Mid-turn a leaf is edge-on, and its outer edge — magnified by
  // perspective toward the viewer — overshoots its resting box by roughly
  // pageH / (2 * (PERSPECTIVE_RATIO - 1)) on each side (k * pageH below),
  // symmetric above AND below the leaf's own vertical centre. .refine
  // centres the book alone in .grid-wrap now (phase 13 moved the scrub bar
  // into the bottom toolbar, so there's no sibling below it to budget for
  // any more) — with .grid-wrap's overflow: hidden gone (§10, 2026-08-02),
  // an unbudgeted bulge is free to bleed into the padding around it.
  //
  // Solving slack_above = slack_below = k*pageH for the divisor: blockHeight
  // (= pageH, just the book) has to leave (availH - pageH)/2 of slack on
  // each side equal to the bulge, i.e. pageH = availH / (1 + 2k).
  const k = 0.5 / (PERSPECTIVE_RATIO - 1);
  const bookAvailH = availH / (1 + 2 * k);
  const book = fitTiles(availW, bookAvailH, BOOK_SPAN, 1, 0);
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
  { name: "--fan-out-ratio", label: "fan splay", min: 0, max: 0.06, step: 0.00125, unit: "" },
  { name: "--fan-shrink-ratio", label: "fan shrink", min: 0, max: 0.12, step: 0.00125, unit: "" },
  { name: "--paper-z", label: "paper z-gap", min: 0, max: 3, step: 0.1, unit: "px" },
  { name: "--perspective-ratio", label: "perspective", min: 1.5, max: 12, step: 0.1, unit: "", show: "×" },
  { name: "--edge-thickness", label: "paper edge", min: 0, max: 12, step: 0.5, unit: "px" },
  { name: "--gutter-bleed", label: "gutter bleed", min: 0, max: 24, step: 1, unit: "px" },
  { name: "--detent-breakaway", label: "detent breakaway", min: 0.3, max: 0.9, step: 0.05, unit: "" },
  { name: "--detent-strain-max", label: "detent strain", min: 0, max: 6, step: 0.5, unit: "px" },
  { name: "--detent-drag-duration", label: "page drag speed", min: 40, max: 300, step: 10, unit: "ms" },
  { name: "--detent-snap-duration", label: "thumb snap speed", min: 20, max: 200, step: 10, unit: "ms" },
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
  "--fan-out-ratio",
  "--fan-shrink-ratio",
  "--paper-z",
  "--edge-thickness",
  "--edge-color",
  "--gutter-tint",
  "--gutter-shade",
  "--gutter-curl",
  "--gutter-bleed",
  "--perspective-ratio",
  "--detent-breakaway",
  "--detent-strain-max",
  "--detent-drag-duration",
  "--detent-snap-duration",
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
