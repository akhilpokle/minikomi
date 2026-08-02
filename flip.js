/* ==========================================================================
   MINIKOMI — FLIP LAB                                            /flip.html
   ==========================================================================
   Standalone rig for experimenting with the booklet flip. Not shipped, not
   linked from the app, reachable only by URL. Nothing here is imported by
   script.js — the dependency runs one way only.

   THE POINT OF THIS FILE
   It does not reimplement the flip. It fetches script.js as text and links the
   real functions out of it, so the geometry the lab shows is the geometry that
   ships. A copied-and-pasted lab would drift within a day and every number
   measured in it would be a lie.

   WHAT IS BORROWED (see NEEDS) — clamp, token, bury, readFlipTokens, depthAt,
   slotAtDepth, shiftAtScene, bookShift, applyScene. Between them that is the
   entire token pipeline and the entire positioning model.

   WHAT THE LAB OWNS — placeholder page content (the app's buildPage draws photos
   and live cover inputs, neither of which belongs here), the transport, the
   measurement probe, and the controls.

   IF SCRIPT.JS IS REFACTORED and one of those names disappears, linking throws
   and the page shows a loud error instead of silently testing nothing. That is
   deliberate: a broken lab must look broken.
   ========================================================================== */

const LEAF_COUNT = 4; // 4 leaves, 5 scenes — mirrors SPREADS.length - 1
const MAX_DEPTH = LEAF_COUNT - 1;

const NEEDS = [
  "clamp",
  "token",
  "bury",
  "readFlipTokens",
  "depthAt",
  "slotAtDepth",
  "shiftAtScene",
  "bookShift",
  "applyScene",
];

/* Written in the same order as the :root block in styles.css, so COPY output
   pastes straight over it. */
const EXPORT_ORDER = [
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
];

const KNOBS = [
  { name: "--flip-duration", label: "flip duration", min: 80, max: 1200, step: 10, unit: "ms" },
  { name: "--book-tilt", label: "book tilt", min: 0, max: 24, step: 0.5, unit: "", show: "°" },
  { name: "--leaf-wedge", label: "leaf wedge", min: 0, max: 30, step: 0.5, unit: "", show: "°" },
  { name: "--fan-out-ratio", label: "fan splay", min: 0, max: 0.06, step: 0.00125, unit: "" },
  { name: "--fan-shrink-ratio", label: "fan shrink", min: 0, max: 0.12, step: 0.00125, unit: "" },
  { name: "--paper-z", label: "paper z-gap", min: 0, max: 3, step: 0.1, unit: "px" },
  { name: "--perspective-ratio", label: "perspective", min: 1.5, max: 12, step: 0.1, unit: "", show: "×" },
  { name: "--edge-thickness", label: "paper edge", min: 0, max: 12, step: 0.5, unit: "px" },
  { name: "--gutter-bleed", label: "gutter bleed", min: 0, max: 24, step: 1, unit: "px" },
];

const EASES = [
  ["in-out cubic (default)", "cubic-bezier(0.645, 0.045, 0.355, 1)"],
  ["linear", "linear"],
  ["out quad", "cubic-bezier(0.25, 0.46, 0.45, 0.94)"],
  ["in-out quart", "cubic-bezier(0.77, 0, 0.175, 1)"],
  ["snap out", "cubic-bezier(0.16, 1, 0.3, 1)"],
  ["overshoot", "cubic-bezier(0.34, 1.36, 0.64, 1)"],
];

const COLORS = [
  ["--edge-color", "edge colour"],
  ["--gutter-tint", "gutter tint"],
];

/* ==========================================================================
   Linking the real geometry out of script.js
   ========================================================================== */

/**
 * Slices one top-level `function name(...) { ... }` out of a source string by
 * brace matching. No parser and no build step — but it does have to skip braces
 * that are not code, or it miscounts: `indexOf("{", k)` and `c === "}"` both
 * appear inside string literals in this very function, and script.js's
 * applyScene is full of template literals.
 *
 * Comments and quoted strings are skipped. Template literals are deliberately
 * NOT skipped: their `${ }` pairs are balanced, so counting straight through
 * them is harmless, whereas skipping them correctly would need a real lexer for
 * nesting. Regex literals containing unbalanced braces would still break it;
 * none of the borrowed functions has one.
 */
function sliceFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) {
    throw new Error(
      `script.js has no "function ${name}(".\n` +
      `It was renamed, inlined, or turned into an arrow function. Update NEEDS ` +
      `in flip.js to match — until then the lab cannot link the real geometry.`
    );
  }

  let depth = 0;
  let k = src.indexOf("{", start);
  while (k >= 0 && k < src.length) {
    const c = src[k];
    if (c === "/" && src[k + 1] === "/") {
      k = src.indexOf("\n", k);
      if (k < 0) break;
    } else if (c === "/" && src[k + 1] === "*") {
      const end = src.indexOf("*/", k);
      if (end < 0) break;
      k = end + 2;
      continue;
    } else if (c === '"' || c === "'") {
      k++;
      while (k < src.length && src[k] !== c) k += src[k] === "\\" ? 2 : 1;
    } else if (c === "{") {
      depth++;
    } else if (c === "}" && --depth === 0) {
      return src.slice(start, k + 1);
    }
    k++;
  }
  throw new Error(`Unbalanced braces while reading ${name} from script.js.`);
}

/**
 * Rebuilds the borrowed functions inside a scope that supplies exactly the
 * bindings they close over in script.js. The `let` block below is that file's
 * flip state; readFlipTokens() fills it from the real CSS custom properties, so
 * the lab inherits the token pipeline rather than restating the formulas — the
 * rest-angle derivation in particular, which is easy to get subtly wrong.
 */
function linkGeometry(src, env) {
  const bodies = NEEDS.map((name) => sliceFunction(src, name)).join("\n\n");
  const factory = new Function(
    "env",
    `"use strict";
     const { leafEls, LEAF_COUNT, MAX_DEPTH, rootStyle, reducedMotion, bookEl } = env;
     const Z_TOP = 30;
     let pageW = 0, pageH = 0;
     let FAN_OUT_RATIO, FAN_SHRINK_RATIO, BOOK_TILT, LEAF_WEDGE, PERSPECTIVE_RATIO,
         PAPER_Z, BOOK_SPAN, ROT_RIGHT, ROT_FLIPPED, FLIP_MS;

     ${bodies}

     return {
       clamp, token, bury, readFlipTokens, depthAt, slotAtDepth, shiftAtScene,
       bookShift, applyScene,
       setPageBox(w, h) { pageW = w; pageH = h; },
       values: () => ({
         FAN_OUT_RATIO, FAN_SHRINK_RATIO, BOOK_TILT, LEAF_WEDGE, PERSPECTIVE_RATIO,
         PAPER_Z, BOOK_SPAN, ROT_RIGHT, ROT_FLIPPED, FLIP_MS, pageW, pageH,
       }),
     };`
  );
  return factory(env);
}

/* ==========================================================================
   Lab state
   ========================================================================== */

const leafEls = [];
const rootStyle = getComputedStyle(document.documentElement);
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const bookEl = document.getElementById("book");
const stageEl = document.getElementById("lab-stage");
const spineEl = document.getElementById("lab-spine");
const sceneInput = document.getElementById("lab-scene");
const sceneOut = document.getElementById("lab-scene-out");
const probeEl = document.getElementById("lab-probe");
const rowsEl = document.getElementById("lab-rows");
const errorEl = document.getElementById("lab-error");
const copyOut = document.getElementById("lab-copy-out");

let geo = null; // the linked geometry
let scene = 0; // fractional, 0 .. LEAF_COUNT
const defaults = new Map();

const pageLabel = (n) => (n === 0 ? "cover" : String(n));

/* ==========================================================================
   The book — same DOM shape the app's buildBook() produces
   ========================================================================== */

function buildPage(index, side) {
  const box = document.createElement("div");
  box.className = `page-content page-content--${side}`;

  const page = document.createElement("div");
  page.className = "slot page lab-page";
  page.style.setProperty("--lab-hue", String((index * 42) % 360));

  const gutter = document.createElement("div");
  gutter.className = "lab-page-gutter";

  const num = document.createElement("span");
  num.className = "lab-page-num";
  num.textContent = String(index);

  const tag = document.createElement("span");
  tag.className = "lab-page-tag";
  tag.textContent = pageLabel(index);

  page.append(gutter, num, tag);
  box.appendChild(page);
  return box;
}

function buildBook() {
  bookEl.querySelectorAll(".leaf").forEach((el) => el.remove());
  leafEls.length = 0;

  for (let j = 0; j < LEAF_COUNT; j++) {
    const leaf = document.createElement("div");
    leaf.className = "leaf";
    leaf.dataset.leaf = String(j);

    const front = document.createElement("div");
    front.className = "leaf-face leaf-face--front";
    front.appendChild(buildPage(2 * j, "right"));

    const back = document.createElement("div");
    back.className = "leaf-face leaf-face--back";
    back.appendChild(buildPage(2 * j + 1, "left"));

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

/* ==========================================================================
   Layout
   ==========================================================================
   Simpler than the app's fitTiles: one surface, no gap, no reserves. Same rule
   though — the book is BOOK_SPAN page-widths across, not 2, because the fan
   overhangs the resting spread.
   ========================================================================== */

function layout() {
  geo.readFlipTokens();
  const { BOOK_SPAN, PERSPECTIVE_RATIO } = geo.values();

  const availW = stageEl.clientWidth;
  const availH = stageEl.clientHeight;
  let w = availW / BOOK_SPAN;
  let h = w * 1.25; // pages are 4:5
  if (h > availH) {
    h = availH;
    w = h / 1.25;
  }
  const pageW = Math.floor(w);
  const pageH = Math.floor(h);

  const root = document.documentElement.style;
  root.setProperty("--page-w", `${pageW}px`);
  root.setProperty("--page-h", `${pageH}px`);
  root.setProperty("--perspective", `${Math.round(pageW * PERSPECTIVE_RATIO)}px`);
  geo.setPageBox(pageW, pageH);
}

/* ==========================================================================
   Applying a scene
   ==========================================================================
   `instant` suppresses the CSS transitions, which is what the app does while the
   scrub bar is being dragged. The lab drags the scene slider the same way, so a
   parked fractional scene is exactly a parked scrub.
   ========================================================================== */

function apply(t, instant) {
  scene = geo.clamp(t, 0, LEAF_COUNT);
  bookEl.classList.toggle("is-scrubbing", Boolean(instant));
  geo.applyScene(scene);
  if (instant) {
    void bookEl.offsetWidth; // land it before transitions come back
    bookEl.classList.remove("is-scrubbing");
  }
  // .lab-spine is a sibling of #book, not a descendant, so it doesn't inherit
  // the --book-shift applyScene() just wrote inline on #book — it has to be
  // told directly, or the hairline stops marking the real spine the moment a
  // lone Cover/page-7 recentres the book.
  spineEl.style.left = `calc(50% + ${geo.bookShift(scene).toFixed(2)}px)`;
  sceneInput.value = String(scene);
  sceneOut.textContent = scene.toFixed(3);
  renderTable();
}

function relayout(instant = true) {
  layout();
  apply(scene, instant);
}

/* ==========================================================================
   The probe — measured, not modelled
   ==========================================================================
   Reads each leaf's rendered `left` and works out how far its inner edge sits
   from the spine. `left` IS the inner edge: the leaf pivots on `transform-origin:
   left center`, so no rotation ever moves it. That makes this an honest
   measurement of the shipped DOM rather than a restatement of slotAtDepth, and it
   keeps working mid-transition, when nothing in JS knows the current fraction.

   The turning leaf is excluded by its z-index: applyScene rides it at 100 so it
   sweeps over the stack rather than through it. It cannot be relied on to cover
   anything, because it passes edge-on.
   ========================================================================== */

function probe() {
  const { pageW } = geo.values();
  if (!pageW) return;

  // Side comes from the scene's integer part. Safe mid-transition: only the
  // turning leaf changes side across a turn, and it is excluded below.
  const i = Math.floor(geo.clamp(scene, 0, LEAF_COUNT));
  const sides = { left: [], right: [] };

  leafEls.forEach((el, j) => {
    const cs = getComputedStyle(el);
    if (Number(cs.zIndex) >= 100) return; // the turning leaf
    // `left` IS the inner edge — the leaf pivots on transform-origin: left
    // center, so no rotation moves it. Read from the computed style, not from
    // getBoundingClientRect, which returns the post-transform bounding box.
    const offset = Math.abs(parseFloat(cs.left) - pageW);
    if (!Number.isFinite(offset)) return;
    (j < i ? sides.left : sides.right).push(offset);
  });

  const read = (arr) => (arr.length ? Math.min(...arr) : null);
  const l = read(sides.left);
  const r = read(sides.right);

  const cell = (v, name) => {
    if (v === null) return `<span class="idle">${name} no page</span>`;
    const cls = v < 0.5 ? "ok" : "bad";
    return `<span class="${cls}">${name} <b>${v.toFixed(1)}px</b></span>`;
  };
  probeEl.innerHTML =
    `gutter &nbsp; ${cell(l, "left")} &nbsp;·&nbsp; ${cell(r, "right")}` +
    ` &nbsp;<span class="idle">— distance from the spine to the nearest page edge,` +
    ` turning leaf excluded</span>`;
}

/* ==========================================================================
   Per-leaf readout
   ========================================================================== */

function renderTable() {
  const { ROT_RIGHT, ROT_FLIPPED } = geo.values();
  const i = geo.clamp(Math.floor(scene), 0, LEAF_COUNT);
  const f = geo.clamp(scene - i, 0, 1);
  const moving = f > 0 && i < LEAF_COUNT ? i : -1;

  rowsEl.textContent = "";
  for (let j = 0; j < LEAF_COUNT; j++) {
    let d;
    let slot;
    if (j === moving) {
      d = 0;
      slot = geo.slotAtDepth(false, 0);
      slot.rot = ROT_RIGHT + f * (ROT_FLIPPED - ROT_RIGHT);
    } else {
      const from = geo.depthAt(j, i);
      const to = i < LEAF_COUNT ? geo.depthAt(j, i + 1) : from;
      d = from + f * (to - from);
      slot = geo.slotAtDepth(j < i, d);
    }
    const cells = [
      `${j} · p${pageLabel(2 * j)}/${pageLabel(2 * j + 1)}`,
      j === moving ? "turning" : j < i ? "left" : "right",
      d.toFixed(2),
      Math.max(0, d - 1).toFixed(2),
      slot.left.toFixed(1),
      slot.w.toFixed(1),
      `${slot.rot.toFixed(1)}°`,
      j === moving ? "100" : String(Math.round(30 - geo.depthAt(j, i))),
    ];
    const tr = document.createElement("tr");
    if (j === moving) tr.dataset.moving = "true";
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    rowsEl.appendChild(tr);
  }
}

/* ==========================================================================
   Controls
   ========================================================================== */

function tokenText(name) {
  return rootStyle.getPropertyValue(name).trim();
}

function syncCopyOut() {
  copyOut.value = EXPORT_ORDER.map((n) => `  ${n}: ${tokenText(n)};`).join("\n");
}

function decimals(step) {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function addRow(parent, label, control) {
  const row = document.createElement("label");
  row.className = "lab-row";
  const head = document.createElement("span");
  head.className = "lab-row-head";
  const name = document.createElement("span");
  name.textContent = label;
  const value = document.createElement("span");
  value.className = "lab-row-value";
  head.append(name, value);
  row.append(head, control);
  parent.appendChild(row);
  return value;
}

function buildKnobs() {
  const host = document.getElementById("lab-knobs");
  const syncers = [];

  KNOBS.forEach((knob) => {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "lab-range";
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.step = String(knob.step);

    const dp = decimals(knob.step);
    const out = addRow(host, knob.label, input);
    const paint = () => {
      out.textContent = `${Number(input.value).toFixed(dp)}${knob.show || knob.unit}`;
    };
    const load = () => {
      input.value = String(geo.token(knob.name, knob.min));
      paint();
    };
    load();
    syncers.push(load);

    input.addEventListener("input", () => {
      document.documentElement.style.setProperty(knob.name, `${input.value}${knob.unit}`);
      paint();
      relayout();
      syncCopyOut();
    });
  });

  const ease = document.createElement("select");
  ease.className = "lab-select";
  EASES.forEach(([label, curve]) => {
    const opt = document.createElement("option");
    opt.value = curve;
    opt.textContent = label;
    ease.appendChild(opt);
  });
  ease.value = tokenText("--flip-ease");
  ease.addEventListener("change", () => {
    document.documentElement.style.setProperty("--flip-ease", ease.value);
    syncCopyOut();
  });
  addRow(host, "flip ease", ease);
  syncers.push(() => {
    ease.value = defaults.get("--flip-ease");
  });

  COLORS.forEach(([name, label]) => {
    const color = document.createElement("input");
    color.type = "color";
    color.className = "lab-select";
    color.value = tokenText(name);
    color.addEventListener("input", () => {
      document.documentElement.style.setProperty(name, color.value);
      syncCopyOut();
    });
    addRow(host, label, color);
    syncers.push(() => {
      color.value = defaults.get(name);
    });
  });

  return syncers;
}

function buildViewToggles() {
  const host = document.getElementById("lab-view");
  const modes = [
    ["lab-outline", "outline leaves & faces", false],
    ["lab-xray", "x-ray (show back faces)", false],
    ["spine", "spine ruler", false],
  ];
  modes.forEach(([key, label, on]) => {
    const wrap = document.createElement("label");
    wrap.className = "lab-check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = on;
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(box, text);
    host.appendChild(wrap);

    const applyMode = () => {
      if (key === "spine") spineEl.hidden = !box.checked;
      else document.body.classList.toggle(key, box.checked);
    };
    box.addEventListener("change", applyMode);
    applyMode();
  });
}

function wireTransport() {
  let dragging = false;

  sceneInput.addEventListener("pointerdown", () => {
    dragging = true;
  });
  window.addEventListener("pointerup", () => {
    dragging = false;
  });
  sceneInput.addEventListener("input", () => {
    // Dragging is a scrub: transitions off so the page tracks the pointer.
    apply(Number(sceneInput.value), true);
  });

  const animateTo = (t) => {
    apply(geo.clamp(t, 0, LEAF_COUNT), false);
  };

  document.getElementById("lab-next").addEventListener("click", () => {
    animateTo(Math.floor(scene + 1e-6) + 1);
  });
  document.getElementById("lab-prev").addEventListener("click", () => {
    animateTo(Math.ceil(scene - 1e-6) - 1);
  });
  document.getElementById("lab-play").addEventListener("click", () => {
    const { FLIP_MS } = geo.values();
    apply(0, true);
    let step = 0;
    const tick = () => {
      if (++step > LEAF_COUNT) return;
      animateTo(step);
      window.setTimeout(tick, Math.max(FLIP_MS, 60) + 90);
    };
    window.setTimeout(tick, 60);
  });
  document.getElementById("lab-mid").addEventListener("click", () => {
    const base = Math.min(Math.floor(scene + 1e-6), LEAF_COUNT - 1);
    apply(base + 0.5, true);
  });

  // Left/Right nudge the parked scene, for hunting the exact fraction where
  // something goes wrong. Skipped while a form control has focus — the scene
  // range steps itself on arrow keys, and handling it here too would double the
  // movement.
  window.addEventListener("keydown", (event) => {
    const el = event.target;
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) return;
    const fine = event.shiftKey ? 0.001 : 0.01;
    if (event.key === "ArrowRight") apply(scene + fine, true);
    else if (event.key === "ArrowLeft") apply(scene - fine, true);
    else return;
    event.preventDefault();
  });
}

function wireCopyReset(syncers) {
  document.getElementById("lab-copy").addEventListener("click", () => {
    const fallback = () => copyOut.select();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(copyOut.value).then(() => {}, fallback);
    } else {
      fallback();
    }
  });
  document.getElementById("lab-reset").addEventListener("click", () => {
    defaults.forEach((value, name) => {
      document.documentElement.style.setProperty(name, value);
    });
    syncers.forEach((sync) => sync());
    relayout();
    syncCopyOut();
  });
}

/* ==========================================================================
   Boot
   ========================================================================== */

function fail(error) {
  errorEl.hidden = false;
  errorEl.textContent =
    `FLIP LAB COULD NOT LINK script.js\n\n${error.message}\n\n` +
    `Nothing below is trustworthy until this is fixed. If you opened this file ` +
    `directly, serve it instead — fetch is blocked on file:// URLs.`;
  // eslint-disable-next-line no-console
  console.error(error);
}

async function boot() {
  let src;
  try {
    const response = await fetch("script.js", { cache: "no-store" });
    if (!response.ok) throw new Error(`fetch script.js -> HTTP ${response.status}`);
    src = await response.text();
    geo = linkGeometry(src, {
      leafEls,
      LEAF_COUNT,
      MAX_DEPTH,
      rootStyle,
      reducedMotion,
      bookEl,
    });
  } catch (error) {
    fail(error);
    return;
  }

  // Captured before any knob moves, so RESET restores the stylesheet's values.
  EXPORT_ORDER.forEach((name) => defaults.set(name, tokenText(name)));

  buildBook();
  const syncers = buildKnobs();
  buildViewToggles();
  wireTransport();
  wireCopyReset(syncers);
  syncCopyOut();
  relayout();

  window.addEventListener("resize", () => relayout());
  // Polled rather than event-driven: the probe has to stay live through CSS
  // transitions, which report nothing per frame.
  const loop = () => {
    probe();
    window.requestAnimationFrame(loop);
  };
  loop();
}

boot();
