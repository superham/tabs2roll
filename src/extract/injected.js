/* GENERATED FILE — do not edit by hand. Rebuild with: npm run build
 * Built from: src/parse/tabshape.js, src/extract/sites/ultimate-guitar.js, src/extract/sites/generic.js, src/extract/sites/page.js
 * Build: 45a1e21d
 *
 * This is the only code tab2roll ever runs inside a web page. It is injected
 * on toolbar click (activeTab), reads the page's DOM, returns plain data, and
 * touches nothing else: no UI, no styles, no storage, no network. */
(() => {
"use strict";
const EXTRACTOR_BUILD = "45a1e21d";

// ---- src/parse/tabshape.js ----
// Shape heuristics — the shared, tested functions that decide whether a blob
// of text "looks like guitar tab" or "looks like a chord sheet".
//
// They power both extraction (inside the page, via the generated
// src/extract/injected.js) and the manual paste path (via parse/detect.js).
// parse/chords.js and parse/region.js build on the chord-line rules here so
// that the page and the parser always agree on what a chord line is.
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

/**
 * ...of which at least this many must be dashes. Digits alone are not enough:
 * "146,572 views, added to favorites 5,760 times" clears the tab-character
 * count on digits and commas, and a page's view counter is not a stave.
 */
const TAB_SHAPE_MIN_DASHES = 3;

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
  let dashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "-") dashes++;
    if (TAB_SHAPE_CHARS.indexOf(line[i]) !== -1) count++;
  }
  return count >= TAB_SHAPE_MIN_TAB_CHARS && dashes >= TAB_SHAPE_MIN_DASHES;
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

// --------------------------------------------------------------------------
// Chord-sheet shape
// --------------------------------------------------------------------------
//
// Modern chord pages print the chord names above (or, increasingly, on their
// own line before) the words. There are no dashes anywhere, so looksLikeTab
// never fires on them; these rules are what let the toolbar button work on a
// chord page at all.

/** One chord symbol: C, Am, F#m7, Bb, Gsus4, Dmaj7, Cadd9, D/F#, A5, Bdim. */
const CHORD_TOKEN_RE = /^([A-G])(#|b)?(maj|min|dim|aug|sus|add|m|M|\+|°)?(\d+)?(sus\d?|add\d+)?(?:\/([A-G])(#|b)?)?$/;

/** Tokens allowed on a chord line without being chords: bar lines, repeats. */
const CHORD_FILLER_RE = /^(\||\|\||-|–|—|\/|x\d+|\(x\d+\)|\d+x|N\.?C\.?|\(N\.?C\.?\)|\.|,)$/i;

/** Section markers: "[Verse 1]", "Chorus:", "Pre-chorus 2", "Intro". */
const SECTION_RE = /^\s*(?:\[[^\]]+\]|\(?(?:intro|verse|chorus|bridge|outro|pre-?chorus|solo|interlude|refrain|ending|coda|riff|instrumental|break|hook|tag|part)\b[^:\n]{0,24}:?\)?)\s*$/i;

/** A "Word: value" header, a copyright line or a URL. Never song content. */
const METADATA_LINE_RE = /(^\s*[A-Za-z][\w '-]{0,24}\s*:)|©|\bhttps?:\/\/|\bwww\./;

function isSectionLine(line) {
  return typeof line === "string" && SECTION_RE.test(line);
}

function isMetadataLine(line) {
  return typeof line === "string" && METADATA_LINE_RE.test(line);
}

/**
 * True when every token on the line is a chord symbol or filler, and at least
 * one is a chord. Metadata lines are excluded so "Tuning: E A D G B E" is not
 * mistaken for six chords.
 */
function isChordOnlyLine(line) {
  if (typeof line !== "string") return false;
  const text = line.trim();
  if (!text || isSectionLine(text) || isMetadataLine(text)) return false;
  const tokens = text.split(/\s+/);
  if (!tokens.length || tokens.length > 16) return false;
  let chords = 0;
  for (const token of tokens) {
    if (CHORD_TOKEN_RE.test(token)) chords++;
    else if (!CHORD_FILLER_RE.test(token)) return false;
  }
  return chords > 0;
}

/**
 * True when a line reads as words a person would sing or say: at least two
 * words, some lower-case, and not a chord line, section marker or header.
 */
function isLyricLine(line) {
  if (typeof line !== "string") return false;
  const text = line.trim();
  if (text.length < 6 || !/[a-z]/.test(text)) return false;
  if (isSectionLine(text) || isMetadataLine(text) || isChordOnlyLine(text)) return false;
  if (isTabShapedLine(text)) return false;
  // More digits than letters means a count or a stat ("146,572 views",
  // "4.8 (44.9K)", "2017 Pop"), which is page furniture, not something sung.
  const digits = (text.match(/\d/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters <= digits) return false;
  if (text.split(/\s+/).length >= 2) return true;
  // A lone word is a lyric when it is lower case ("tonight", "away"), which
  // is how a sung line continues. Navigation is Capitalised ("Tabs", "Tools",
  // "Strumming"), so this keeps one-word lyrics without swallowing the menu.
  return /^[a-z][a-z'’-]{3,}$/.test(text);
}

/** A chord sheet needs at least this many chord lines to be worth believing. */
const CHORD_SHEET_MIN_CHORD_LINES = 3;

/**
 * True when the text looks like a chord sheet: several chord lines, and at
 * least two of them sitting next to words or a section marker.
 *
 * The adjacency test is what keeps a page's chord-diagram legend or its A-Z
 * artist index (both of which are nothing but chord-shaped lines) from
 * reading as a song.
 */
function looksLikeChordSheet(text) {
  if (typeof text !== "string" || !text) return false;
  const lines = text.split(/\r\n|\r|\n/);
  let chordLines = 0;
  let supported = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isChordOnlyLine(lines[i])) continue;
    chordLines++;
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 3); j++) {
      if (j !== i && (isLyricLine(lines[j]) || isSectionLine(lines[j]))) {
        supported++;
        break;
      }
    }
  }
  return chordLines >= CHORD_SHEET_MIN_CHORD_LINES && supported >= 2;
}

/** Either shape: what the extractor accepts as "a song is on this page". */
function looksLikeSong(text) {
  return looksLikeTab(text) || looksLikeChordSheet(text);
}

// ---- src/extract/sites/ultimate-guitar.js ----
// Ultimate Guitar extractor.
//
// RUNS INSIDE THE TAB PAGE. This file is concatenated into the generated
// src/extract/injected.js by tools/build-injected.js, so it must have NO
// imports and depend on nothing but its arguments: `doc` (the page's
// document) and `shape` (the helpers from parse/tabshape.js).
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
    if (content && (shape.looksLikeSong(content) || type.indexOf("chord") !== -1 || /\[ch\]/.test(content))) {
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
// tools/build-injected.js — NO imports; depends only on `doc` and `shape`
// (the helpers from parse/tabshape.js).
// Reads the DOM, returns plain data, changes nothing, sends nothing.
//
// Strategies, first plausible result wins:
//   2. <pre> elements whose text passes the shape heuristic.
//   3. Any element whose text passes, deepest match wins (several deepest
//      matches — one per stave — are joined in page order).
//   4. document.body.innerText, if the page as a whole passes.
// Strategy numbering continues from ultimate-guitar.js.
//
// "Passes" means looksLikeSong: ASCII tab OR a chord sheet. Chord pages have
// no dashes anywhere, so demanding tab shape here used to make every one of
// them read as "no tab on this page". Whatever comes back is cut down to the
// song itself later, by parse/region.js.

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
    if (shape.looksLikeSong(text)) hits.push(text);
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
    if (!shape.looksLikeSong(text)) return false;
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
  if (!shape.looksLikeSong(text)) return null;
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

/**
 * A short account of what the page looked like to the extractor. Printed to
 * the console on every click, so a failure on a real site can be diagnosed
 * without guessing: it says which build is running, how much text was on the
 * page, and how many lines of it read as tab, chords or words.
 */
function describePage(doc, shape) {
  const seen = { build: typeof EXTRACTOR_BUILD === "string" ? EXTRACTOR_BUILD : "dev" }; // eslint-disable-line no-undef
  try {
    const body = doc.body ? (typeof doc.body.innerText === "string" ? doc.body.innerText : doc.body.textContent) || "" : "";
    const lines = body.split(/\r\n|\r|\n/);
    seen.chars = body.length;
    seen.lines = lines.length;
    seen.tabLines = 0;
    seen.chordLines = 0;
    seen.lyricLines = 0;
    for (let i = 0; i < lines.length; i++) {
      if (shape.isTabShapedLine && shape.isTabShapedLine(lines[i])) seen.tabLines++;
      if (shape.isChordOnlyLine && shape.isChordOnlyLine(lines[i])) seen.chordLines++;
      if (shape.isLyricLine && shape.isLyricLine(lines[i])) seen.lyricLines++;
    }
    seen.looksLikeTab = !!(shape.looksLikeTab && shape.looksLikeTab(body));
    seen.looksLikeChords = !!(shape.looksLikeChordSheet && shape.looksLikeChordSheet(body));
    seen.pres = doc.querySelectorAll ? doc.querySelectorAll("pre").length : 0;
    seen.stores = doc.querySelectorAll ? doc.querySelectorAll("[data-content]").length : 0;
  } catch (err) {
    seen.error = String((err && err.message) || err);
  }
  return seen;
}

function extractFromPage(doc, shape, sites) {
  const ug = sites && sites.ultimateGuitar ? sites.ultimateGuitar : typeof extractUltimateGuitar === "function" ? extractUltimateGuitar : null; // eslint-disable-line no-undef
  const generic = sites && sites.generic ? sites.generic : typeof extractGeneric === "function" ? extractGeneric : null; // eslint-disable-line no-undef
  try {
    let hint = null;
    if (ug) {
      const r = ug(doc, shape);
      if (r && r.ok) return { ...r, seen: describePage(doc, shape) };
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
        return { ...r, seen: describePage(doc, shape) };
      }
      if (r && r.reason === "unsupported") return { ...r, seen: describePage(doc, shape) };
    }
    return { ok: false, reason: "none", seen: describePage(doc, shape) };
  } catch (err) {
    return { ok: false, reason: "error", message: String((err && err.message) || err), seen: describePage(doc, shape) };
  }
}

// ---- run ----
var RESULT = extractFromPage(document, { isTabShapedLine, tabLineCount, looksLikeTab, looksLikeChordSheet, looksLikeSong, isChordOnlyLine, isLyricLine, isSectionLine });
// Firefox does not reliably hand back a file-injected script's completion
// value, so leave the result where a second, tiny injection can read it.
// This is the extension's own isolated sandbox, not the page's window.
try { globalThis["__tab2rollResult"] = RESULT; } catch (err) { /* nothing to do */ }
return RESULT;
})();
