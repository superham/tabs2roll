/* GENERATED FILE — do not edit by hand. Rebuild with: npm run build
 * Built from: src/parse/tabshape.js, src/extract/sites/ultimate-guitar.js, src/extract/sites/generic.js, src/extract/sites/page.js
 *
 * This is the only code tab2roll ever runs inside a web page. It is injected
 * on toolbar click (activeTab), reads the page's DOM, returns plain data, and
 * touches nothing else: no UI, no styles, no storage, no network. */
(() => {
"use strict";

// ---- src/parse/tabshape.js ----
// Tab-shape heuristic — the one shared, tested function that decides whether a
// blob of text "looks like guitar tab".
//
// It powers both extraction (inside the page, via the generated
// src/extract/injected.js) and the manual paste path (via parse/detect.js).
//
// KEEP THIS FILE FREE OF `import`. It is concatenated verbatim into the
// injected page script by tools/build-injected.js, which only strips the
// leading `export ` keywords.

/** Characters that make up the body of a tab line. */
const TAB_SHAPE_CHARS = "-|0123456789hpb/\\~x";

/** A line must be at least this long to count as a tab line. */
const TAB_SHAPE_MIN_LINE_LENGTH = 12;

/** ...and contain at least this many tab characters. */
const TAB_SHAPE_MIN_TAB_CHARS = 8;

/** A text needs at least this many tab lines to "look like tab". */
const TAB_SHAPE_MIN_LINES = 4;

/**
 * True when a single line is at least 12 characters long and contains at
 * least 8 characters from the tab alphabet (`-|0123456789hpb/\~x`).
 * Lower-case only on purpose: `H`, `P`, `X` are far more common in prose
 * ("Hello", "Paris") than in tab, and real tab is overwhelmingly lower-case.
 */
function isTabShapedLine(line) {
  if (typeof line !== "string" || line.length < TAB_SHAPE_MIN_LINE_LENGTH) return false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    if (TAB_SHAPE_CHARS.indexOf(line[i]) !== -1) {
      count++;
      if (count >= TAB_SHAPE_MIN_TAB_CHARS) return true;
    }
  }
  return false;
}

/** Number of tab-shaped lines in a text. Used to rank candidate blocks. */
function tabLineCount(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isTabShapedLine(lines[i])) count++;
  }
  return count;
}

/** True when the text has at least 4 tab-shaped lines. */
function looksLikeTab(text) {
  return tabLineCount(text) >= TAB_SHAPE_MIN_LINES;
}

// ---- src/extract/sites/ultimate-guitar.js ----
// Ultimate Guitar extractor.
//
// RUNS INSIDE THE TAB PAGE. This file is concatenated into the generated
// src/extract/injected.js by tools/build-injected.js, so it must have NO
// imports and depend on nothing but its arguments: `doc` (the page's
// document) and `shape` ({ looksLikeTab, tabLineCount, isTabShapedLine }).
// It reads the DOM and returns plain data. It never modifies the page and
// never talks to the network.
//
// Strategies, first plausible result wins:
//   1. The page's embedded JSON store (historically a `data-content`
//      attribute on a div.js-store). Gives us the raw tab text plus song,
//      artist, tuning and capo. Checked, never depended on.
//   2. Fall through to the generic extractor (see generic.js) — the popup
//      runs it when this returns null.

/** Tab types Ultimate Guitar renders as players or images, not text. */
const UG_UNSUPPORTED_TYPES = ["pro", "official", "power", "video", "guitar pro", "drums"];

function isUltimateGuitarHost(hostname) {
  return /(^|\.)ultimate-guitar\.com$/i.test(String(hostname || ""));
}

/**
 * Walk a parsed JSON object looking for the first object that has a string
 * property `key`. Depth-limited so a pathological page cannot hang the tab.
 */
function findInJson(root, key, maxDepth) {
  const limit = typeof maxDepth === "number" ? maxDepth : 12;
  const stack = [{ node: root, depth: 0 }];
  let steps = 0;
  while (stack.length && steps < 20000) {
    steps++;
    const { node, depth } = stack.pop();
    if (!node || typeof node !== "object" || depth > limit) continue;
    if (Object.prototype.hasOwnProperty.call(node, key) && node[key] !== null && node[key] !== undefined) return node;
    const values = Array.isArray(node) ? node : Object.values(node);
    for (let i = values.length - 1; i >= 0; i--) stack.push({ node: values[i], depth: depth + 1 });
  }
  return null;
}

/** "GREENSLEEVES TAB by Traditional @ Ultimate-Guitar.Com" -> { title, artist, type } */
function parseUltimateGuitarTitle(pageTitle) {
  const m = /^(.*?)\s+(BASS TAB|BASS|UKULELE CHORDS|UKULELE|GUITAR PRO|POWER TAB|OFFICIAL|CHORDS|TAB|DRUM TAB|DRUMS|VIDEO)\s+by\s+(.*?)\s*(?:@|\||$)/i.exec(String(pageTitle || ""));
  if (!m) return null;
  return { title: titleCase(m[1]), artist: titleCase(m[3]), type: m[2].toLowerCase() };
}

function titleCase(s) {
  const t = String(s || "").trim();
  if (t !== t.toUpperCase()) return t; // already mixed case; leave alone
  return t.toLowerCase().replace(/(^|[\s(\-"'])(\S)/g, (all, pre, ch) => pre + ch.toUpperCase());
}

function extractUltimateGuitar(doc, shape) {
  const host = doc.location ? doc.location.hostname : "";
  if (!isUltimateGuitarHost(host)) return null;

  const fromTitle = parseUltimateGuitarTitle(doc.title) || {};
  const base = { ok: true, site: "ultimate-guitar", title: fromTitle.title || "", artist: fromTitle.artist || "" };

  // Strategy 1: the embedded JSON store.
  const stores = doc.querySelectorAll("[data-content]");
  for (let i = 0; i < stores.length; i++) {
    const raw = stores[i].getAttribute("data-content");
    if (!raw || raw.length < 50) continue;
    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      continue;
    }
    const tabInfo = findInJson(json, "song_name");
    const meta = findInJson(json, "wiki_tab");
    const type = tabInfo && typeof tabInfo.type === "string" ? tabInfo.type.toLowerCase() : fromTitle.type || "";
    if (type && UG_UNSUPPORTED_TYPES.some((t) => type.indexOf(t) !== -1)) {
      return { ok: false, reason: "unsupported", site: "ultimate-guitar", type };
    }
    const content = meta && meta.wiki_tab && typeof meta.wiki_tab.content === "string" ? meta.wiki_tab.content : null;
    if (content && (shape.looksLikeTab(content) || type.indexOf("chord") !== -1 || /\[ch\]/.test(content))) {
      const result = { ...base, text: content, type: type || null, strategy: "store" };
      if (tabInfo) {
        if (tabInfo.song_name) result.title = String(tabInfo.song_name);
        if (tabInfo.artist_name) result.artist = String(tabInfo.artist_name);
        if (typeof tabInfo.tuning === "string") result.tuning = tabInfo.tuning;
        if (typeof tabInfo.capo === "number") result.capo = tabInfo.capo;
      }
      const viewMeta = findInJson(json, "tuning");
      if (viewMeta && viewMeta.tuning && typeof viewMeta.tuning === "object") {
        if (typeof viewMeta.tuning.value === "string") result.tuning = viewMeta.tuning.value;
        else if (typeof viewMeta.tuning.name === "string") result.tuning = viewMeta.tuning.name;
      }
      if (viewMeta && typeof viewMeta.capo === "number") result.capo = viewMeta.capo;
      return result;
    }
  }

  // The page told us (in its title) that this is a player-only tab.
  if (fromTitle.type && UG_UNSUPPORTED_TYPES.some((t) => fromTitle.type.indexOf(t) !== -1)) {
    return { ok: false, reason: "unsupported", site: "ultimate-guitar", type: fromTitle.type };
  }
  // Nothing from the store: let the generic extractor read the rendered DOM,
  // but keep the song title and artist we got from the page title.
  return { ...base, ok: false, reason: "fallthrough" };
}

// ---- src/extract/sites/generic.js ----
// Generic extractor: works on any page that shows tab as text.
//
// RUNS INSIDE THE TAB PAGE. Concatenated into src/extract/injected.js by
// tools/build-injected.js — NO imports; depends only on `doc` and `shape`.
// Reads the DOM, returns plain data, changes nothing, sends nothing.
//
// Strategies, first plausible result wins:
//   2. <pre> elements whose text passes the tab-shape heuristic.
//   3. Any element whose text passes, deepest match wins (several deepest
//      matches — one per stave — are joined in page order).
//   4. document.body.innerText, if the page as a whole passes.
// Strategy numbering continues from ultimate-guitar.js.

/** Elements whose text is never tab. */
const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, TEXTAREA: 1, IFRAME: 1, HEAD: 1 };

/** Sites known to show tab only as an interactive player or an image. */
const PLAYER_ONLY_HOSTS = ["songsterr.com", "soundslice.com", "guitarpro.app"];

function isPlayerOnlyHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return PLAYER_ONLY_HOSTS.some((site) => h === site || h.endsWith("." + site));
}

/** Text of an element as a person sees it, with line breaks preserved. */
function textOf(el) {
  if (!el) return "";
  const t = typeof el.innerText === "string" ? el.innerText : el.textContent;
  return t || "";
}

/** "Song Name - Some Site" / "Song Name | Site" -> "Song Name" */
function cleanPageTitle(title) {
  let t = String(title || "").trim();
  t = t.replace(/\s*[|–—-]\s*[^|–—-]{0,40}$/, (m, offset) => (offset > 3 ? "" : m));
  t = t.replace(/\s*(\(|\[)?\b(guitar|bass)?\s*(tab|tabs|tablature|chords)\b(\)|\])?\s*$/i, "");
  return t.trim();
}

function pageTitle(doc) {
  const og = doc.querySelector('meta[property="og:title"]');
  const ogTitle = og && og.getAttribute ? og.getAttribute("content") : null;
  if (ogTitle && ogTitle.trim()) return cleanPageTitle(ogTitle);
  const h1 = doc.querySelector("h1");
  const h1Text = h1 ? textOf(h1).trim() : "";
  if (h1Text && h1Text.length <= 100) return cleanPageTitle(h1Text);
  return cleanPageTitle(doc.title);
}

/** Strategy 2. */
function fromPreElements(doc, shape) {
  const pres = doc.querySelectorAll("pre");
  const hits = [];
  for (let i = 0; i < pres.length; i++) {
    const text = textOf(pres[i]);
    if (shape.looksLikeTab(text)) hits.push(text);
  }
  if (!hits.length) return null;
  return { text: hits.join("\n\n"), strategy: "pre" };
}

/**
 * Strategy 3: depth-first from the body's children; an element counts when
 * its text passes and no child of it does. Starting below <body> keeps
 * strategy 4 meaningful for pages that spray tab lines straight into the
 * body with no container element.
 */
function fromDeepestElements(doc, shape) {
  if (!doc.body) return null;
  const hits = [];
  const visit = (el, depth) => {
    if (!el || SKIP_TAGS[el.tagName] || depth > 60) return false;
    const text = textOf(el);
    if (!shape.looksLikeTab(text)) return false;
    let childMatched = false;
    const children = el.children || [];
    for (let i = 0; i < children.length; i++) {
      if (visit(children[i], depth + 1)) childMatched = true;
    }
    if (!childMatched) hits.push(text);
    return true;
  };
  const top = doc.body.children || [];
  for (let i = 0; i < top.length; i++) visit(top[i], 0);
  if (!hits.length) return null;
  return { text: hits.join("\n\n"), strategy: "deepest" };
}

/** Strategy 4. */
function fromBodyText(doc, shape) {
  const text = doc.body ? textOf(doc.body) : "";
  if (!shape.looksLikeTab(text)) return null;
  return { text, strategy: "body" };
}

function extractGeneric(doc, shape) {
  const host = doc.location ? doc.location.hostname : "";
  if (isPlayerOnlyHost(host)) return { ok: false, reason: "unsupported", site: "generic" };
  const found = fromPreElements(doc, shape) || fromDeepestElements(doc, shape) || fromBodyText(doc, shape);
  if (!found) return null;
  return { ok: true, site: "generic", title: pageTitle(doc), artist: "", text: found.text, strategy: found.strategy };
}

// ---- src/extract/sites/page.js ----
// The entry point of the injected page script: run the site extractors in
// order and return one plain result object.
//
// RUNS INSIDE THE TAB PAGE. Concatenated into src/extract/injected.js —
// NO imports. `extractUltimateGuitar` and `extractGeneric` are in scope
// because the build puts them in the same file; under Node the tests pass
// them in explicitly.
//
// Result shapes (all structured-cloneable):
//   { ok: true,  site, text, title, artist, tuning?, capo?, type?, strategy }
//   { ok: false, reason: "unsupported" | "none" | "error", site?, type?, message? }

function extractFromPage(doc, shape, sites) {
  const ug = sites && sites.ultimateGuitar ? sites.ultimateGuitar : typeof extractUltimateGuitar === "function" ? extractUltimateGuitar : null; // eslint-disable-line no-undef
  const generic = sites && sites.generic ? sites.generic : typeof extractGeneric === "function" ? extractGeneric : null; // eslint-disable-line no-undef
  try {
    let hint = null;
    if (ug) {
      const r = ug(doc, shape);
      if (r && r.ok) return r;
      if (r && r.reason === "unsupported") return r;
      if (r && r.reason === "fallthrough") hint = r;
    }
    if (generic) {
      const r = generic(doc, shape);
      if (r && r.ok) {
        if (hint) {
          if (hint.title) r.title = hint.title;
          if (hint.artist) r.artist = hint.artist;
          r.site = hint.site || r.site;
        }
        return r;
      }
      if (r && r.reason === "unsupported") return r;
    }
    return { ok: false, reason: "none" };
  } catch (err) {
    return { ok: false, reason: "error", message: String((err && err.message) || err) };
  }
}

// ---- run ----
return extractFromPage(document, { isTabShapedLine, tabLineCount, looksLikeTab });
})();
