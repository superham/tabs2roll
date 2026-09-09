/* GENERATED FILE — do not edit by hand. Rebuild with: npm run build
 * Built from: src/parse/tabshape.js, src/extract/sites/ultimate-guitar.js, src/extract/sites/generic.js, src/extract/sites/score-canvas.js, src/extract/sites/page.js
 * Build: 61740ca5
 *
 * This is the only code tab2roll ever runs inside a web page. It is injected
 * on toolbar click (activeTab), reads the page's DOM, returns plain data, and
 * touches nothing else: no UI, no styles, no storage, no network. */
(() => {
"use strict";
const EXTRACTOR_BUILD = "61740ca5";

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

/**
 * "GREENSLEEVES TAB by Traditional @ Ultimate-Guitar.Com" -> { title, artist, type }
 *
 * Three things in a real page title that are not in that example, all of
 * which used to make this give up and hand back nothing at all:
 *   "(1) ..."          an unread-messages count, prepended by the site
 *   "CHORDS & TABS"    what the Official (player) pages call themselves
 *   "OFFICIAL ..."     the word that says it IS one, sitting in the song name
 */
function parseUltimateGuitarTitle(pageTitle) {
  const cleaned = String(pageTitle || "").replace(/^\s*\(\d+\)\s*/, "");
  const m = /^(.*?)\s+(BASS TABS?|BASS|UKULELE CHORDS|UKULELE|GUITAR PRO|POWER TABS?|OFFICIAL|CHORDS\s*(?:&|AND)\s*TABS?|CHORDS|TABS?|DRUM TABS?|DRUMS|VIDEO)\s+by\s+(.*?)\s*(?:@|\||$)/i.exec(cleaned);
  if (!m) return null;
  let title = titleCase(m[1]);
  let type = m[2].toLowerCase().replace(/\s+/g, " ");
  // "Official The Trooper" is the song "The Trooper" on a player-only page.
  const official = /^official\s+(.+)$/i.exec(title);
  if (official) {
    title = official[1];
    type = "official";
  }
  return { title, artist: titleCase(m[3]), type };
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
      return { ...base, ok: false, reason: "unsupported", type };
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

  // The page told us (in its title) that this is a player-only tab. The song
  // and artist go back with that: its notes may be out of reach as text, but
  // it is still a named song, and a picture read off the player needs a name
  // to be saved under.
  if (fromTitle.type && UG_UNSUPPORTED_TYPES.some((t) => fromTitle.type.indexOf(t) !== -1)) {
    return { ...base, ok: false, reason: "unsupported", type: fromTitle.type };
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

// ---- src/extract/sites/score-canvas.js ----
// Picking up a score that is drawn rather than written.
//
// RUNS INSIDE THE TAB PAGE. Concatenated into src/extract/injected.js by
// tools/build-injected.js — NO imports; depends only on `doc`.
//
// The interactive tab players (Ultimate Guitar's "Official" tabs, Songsterr,
// anything built on Guitar Pro files) paint the music onto a <canvas>. There
// is no tab text on those pages at all: not in the DOM, not in a script tag,
// not in an attribute. The notes exist only as pixels.
//
// So this reads the pixels. It takes a copy of what is on the canvas and
// hands it back as one byte of grey per pixel; making sense of it happens in
// the popup, in src/read/, which is ordinary testable code. Nothing is drawn,
// changed, scrolled or sent anywhere — the page is only looked at.
//
// A canvas does not always hand its pixels over. One drawn through WebGL has
// no 2d context to read; one whose control has been passed to a worker has no
// pixels here at all; one holding another site's images may not be read. All
// three are ordinary things for a tab player to be, and all three used to
// look exactly like "this page has no music on it". So every canvas that is
// passed over is now recorded with the reason, and the ones that are still on
// the screen come back as `shots`: a rectangle the popup can photograph with
// tabs.captureVisibleTab and read instead. A photograph holds what the person
// is looking at, whatever the page drew it with.
//
// A canvas shows the part of the score that is on screen, and no more. That
// is a real limit and it is reported rather than hidden: `scroll` says how
// much of the score the picture covers, so the popup can say "this is the
// first eighth of it, scroll down for the rest".

/** Smaller than this and it is an avatar, a sparkline or a tuner dial, not a score. */
const MIN_SCORE_WIDTH = 200;
const MIN_SCORE_HEIGHT = 60;

/** Bigger than this and copying it would cost more than it is worth. */
const MAX_SCORE_PIXELS = 8000000;

/** A canvas with less going on than this is blank: an overlay, a cursor layer. */
const MIN_CONTENT = 0.002;

/** At most this many pictures come back, so a page of charts cannot flood the popup. */
const MAX_CANDIDATES = 2;

/**
 * Why a canvas gave nothing.
 *
 *   tiny           too small to hold a stave
 *   huge           more pixels than it is worth copying
 *   no-2d-context  drawn through WebGL, so there is no 2d context to read
 *   transferred    control passed to a worker; the pixels are not here
 *   blocked        holds another site's images and may not be read
 *   unreadable     asked for its pixels and refused, for some other reason
 *   empty          answered, but with nothing in it
 *   blank          read fine and had no music on it: an overlay, a cursor
 *   extra          real music, but further down the page than we look
 */
const CAN_PHOTOGRAPH = ["no-2d-context", "transferred", "blocked", "unreadable"];

/** Luminance the way the eye sees it, from the same weights read/image.js uses. */
function grayscaleOf(data, length) {
  const gray = new Uint8Array(length);
  let dark = 0;
  for (let i = 0, p = 0; i < length; i++, p += 4) {
    const alpha = data[p + 3];
    if (alpha === 0) {
      gray[i] = 255;
      continue;
    }
    const lum = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    // Floor the blended value, not the amount blended in: read/image.js
    // rounds the same way, so the same pixels give the same grey whichever
    // path read them.
    gray[i] = alpha === 255 ? lum : (255 - ((255 - lum) * alpha) / 255) | 0;
    if (gray[i] < 128) dark++;
  }
  // How much of the picture is the minority colour: ink on paper, or paper on
  // ink if the player is in its dark theme. Either way a blank canvas scores
  // nothing and a canvas with music on it scores a few per cent.
  const darkShare = dark / length;
  return { gray, content: Math.min(darkShare, 1 - darkShare) };
}

/**
 * What the browser calls the refusal, in our own words.
 *
 * The two that matter are told apart because they need opposite answers: a
 * canvas drawn in a worker is a photograph away from being readable, while
 * one holding another site's pixels is a wall. Both are photographable, which
 * is why the distinction lives in the log rather than in the behaviour.
 */
function refusalOf(err) {
  const name = err && err.name ? String(err.name) : "";
  if (name === "SecurityError") return "blocked";
  if (name === "InvalidStateError") return "transferred";
  return "unreadable";
}

/** Where the canvas is on the screen, in CSS pixels, or null if it is nowhere. */
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  try {
    const box = el.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  } catch (err) {
    return null;
  }
}

/** The size of the window the rectangles above were measured in. */
function viewOf(doc) {
  const win = doc ? doc.defaultView : null;
  const root = doc ? doc.documentElement : null;
  const width = (root && root.clientWidth) || (win && win.innerWidth) || 0;
  const height = (root && root.clientHeight) || (win && win.innerHeight) || 0;
  if (!width || !height) return null;
  return { width, height, dpr: (win && win.devicePixelRatio) || 1 };
}

/** True when any part of the rectangle is inside the window, so a photograph would hold it. */
function onScreen(rect, view) {
  if (!rect || !view) return false;
  return rect.x < view.width && rect.y < view.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

/** The nearest ancestor that scrolls, so the popup can say how much of the score this is. */
function scrollStateOf(el, doc) {
  let node = el;
  for (let depth = 0; node && depth < 20; depth++) {
    if (node.scrollHeight && node.clientHeight && node.scrollHeight > node.clientHeight + 8) {
      return { top: node.scrollTop || 0, height: node.scrollHeight, visible: node.clientHeight };
    }
    node = node.parentElement;
  }
  const root = doc.scrollingElement || doc.documentElement;
  if (root && root.scrollHeight > root.clientHeight + 8) {
    return { top: root.scrollTop || 0, height: root.scrollHeight, visible: root.clientHeight };
  }
  return null;
}

/**
 * Every canvas on the page that might be a score, and an account of the ones
 * that gave nothing.
 *
 * Returns:
 *   images   [{ width, height, gray, content, scroll, rect }], best first
 *   skipped  [{ reason, width, height }] for every canvas passed over
 *   shots    [{ reason, width, height, rect, scroll }] — canvases whose
 *            pixels are out of reach but which are on the screen, so a
 *            photograph of the window would hold them
 *   view     { width, height, dpr } the window those rectangles are in
 *
 * `images` empty is the usual answer on an ordinary page. `images` empty with
 * `shots` filled is a tab player this cannot read directly, which is the one
 * case worth taking a photograph for.
 */
function findScoreImages(doc) {
  const canvases = doc.querySelectorAll ? doc.querySelectorAll("canvas") : [];
  const view = viewOf(doc);
  const images = [];
  const skipped = [];
  const shots = [];

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const width = canvas.width | 0;
    const height = canvas.height | 0;
    const rect = rectOf(canvas);
    const scroll = scrollStateOf(canvas, doc);
    // Passing over a canvas is written down rather than done in silence.
    // "There is a score here I am not allowed to read" and "there is no score
    // here" look identical from the popup otherwise, and they want opposite
    // answers: one is a photograph away, the other is a different page.
    const pass = (reason) => {
      skipped.push({ reason, width, height });
      if (CAN_PHOTOGRAPH.indexOf(reason) !== -1 && onScreen(rect, view)) shots.push({ reason, width, height, rect, scroll });
    };

    if (width < MIN_SCORE_WIDTH || height < MIN_SCORE_HEIGHT) {
      pass("tiny");
      continue;
    }
    if (width * height > MAX_SCORE_PIXELS) {
      pass("huge");
      continue;
    }
    let image = null;
    try {
      // Returns the context the page is already drawing with; null if the
      // canvas belongs to WebGL. Throws for a canvas holding pixels from
      // another site, and for one whose control has gone to a worker.
      const context = canvas.getContext("2d");
      if (!context) {
        pass("no-2d-context");
        continue;
      }
      image = context.getImageData(0, 0, width, height);
    } catch (err) {
      pass(refusalOf(err));
      continue;
    }
    if (!image || !image.data) {
      pass("empty");
      continue;
    }
    const { gray, content } = grayscaleOf(image.data, width * height);
    if (content < MIN_CONTENT) {
      pass("blank");
      continue;
    }
    images.push({ width, height, gray, content, scroll, rect });
  }

  images.sort((a, b) => b.content - a.content);
  for (const over of images.splice(MAX_CANDIDATES)) skipped.push({ reason: "extra", width: over.width, height: over.height });
  // Biggest first: on a player with a cursor layer over the score, both are
  // out of reach together and the score is the one worth the photograph.
  shots.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  return { images, skipped, shots: shots.slice(0, MAX_CANDIDATES), view };
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
//
// A failure may still carry `score`: pictures of the music taken off the
// page's <canvas> elements, for pages that draw the tab instead of writing
// it. Only failures carry them — there is no reason to copy a megabyte of
// pixels off a page that has already given us the text.
//
// It may also carry `shots` and `view`: the canvases whose pixels the page
// would not hand over (WebGL, a worker, another site's images) as rectangles
// on the screen, so the popup can photograph them with tabs.captureVisibleTab
// and read that instead. `seen.canvasSkipped` says why each one was passed
// over, so a page that gives nothing says which kind of nothing it gave.

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
  const canvases = sites && sites.scoreCanvas ? sites.scoreCanvas : typeof findScoreImages === "function" ? findScoreImages : null; // eslint-disable-line no-undef

  /** No text on this page. Before giving up, look for a picture of the music. */
  const givingUp = (result) => {
    const seen = describePage(doc, shape);
    let looked = null;
    try {
      looked = canvases ? canvases(doc) : null;
    } catch (err) {
      seen.canvasError = String((err && err.message) || err);
    }
    const score = (looked && looked.images) || [];
    const skipped = (looked && looked.skipped) || [];
    const shots = (looked && looked.shots) || [];
    seen.canvases = score.length;
    // One string, not an array: the console collapses an array logged inside
    // an object to "(3) [...]", which is exactly the detail this is for.
    if (skipped.length) seen.canvasSkipped = skipped.map((s) => `${s.width}x${s.height} ${s.reason}`).join(", ");
    const extra = {};
    if (score.length) extra.score = score;
    if (shots.length) {
      extra.shots = shots;
      extra.view = looked.view || null;
    }
    return { ...result, ...extra, seen };
  };

  try {
    let hint = null;
    if (ug) {
      const r = ug(doc, shape);
      if (r && r.ok) return { ...r, seen: describePage(doc, shape) };
      if (r && r.reason === "unsupported") return givingUp(r);
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
      if (r && r.reason === "unsupported") return givingUp(r);
    }
    return givingUp({ ok: false, reason: "none", title: hint ? hint.title : "", artist: hint ? hint.artist : "", site: hint ? hint.site : undefined });
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
