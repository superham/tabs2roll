// The toolbar popup: the only entry point of the extension.
//
// States: checking -> found | not found -> (click) -> success | failure.
// Every user-facing string comes from src/strings.js. Real errors go to the
// console; the user only ever sees plain language plus what to do next.

import { fillStrings, browser, getOptions, getLastResult, setLastResult, getPictureRead, setPictureRead, openPage, getVersion, STRINGS } from "./common.js";
import { detect } from "../parse/index.js";
import { SELECTABLE_TUNING_IDS } from "../parse/tuning.js";
import { imageDataFromFile, imageDataFromShot, imageFileOf, readBestPicture, bestReading, coverageOf } from "./picture.js";
import { wholeReading, readTo, stitchReads } from "../read/stitch.js";

const P = STRINGS.popup;
const $ = (id) => document.getElementById(id);
const VIEWS = ["view-checking", "view-found", "view-notfound", "view-error", "view-success"];
/**
 * Path to the injected script, ABSOLUTE from the extension root.
 *
 * The leading slash matters. Without it Firefox resolves the path against the
 * document doing the injecting — the popup, which lives in ui/ — and asks for
 * ui/extract/injected.js, which does not exist. It then reports the failure
 * as an entry carrying an error rather than by throwing, so the extractor
 * silently never ran at all.
 */
const INJECTED_SCRIPT = "/extract/injected.js";
const RESULT_GLOBAL = "__tab2rollResult"; // must match tools/build-injected.js
/** Only ordinary web pages can be read. Not about:, moz-extension:, view-source:. */
const READABLE_URL = /^https?:\/\//i;

// Reading a whole song a screenful at a time. The cap is a stop, not a
// target: a long song is a dozen screenfuls and anything near forty means the
// page is not moving the way we think it is.
const MAX_SCREENFULS = 40;
/** Never scroll by less than this, or a page that will not move loops forever. */
const MIN_SCROLL_STEP = 40;
/** How long to let the player redraw after a scroll before looking again. */
const REDRAW_MS = 140;

const state = {
  tab: null, // { id, url } of the page the popup opened on
  page: null, // extraction result with kind, or null
  pageText: null, // text the page gave us that did not read as a song
  pageReason: "none", // why the page gave nothing: "none" | "unsupported" | "error"
  pasteKind: "none", // detect() of the paste box
  busy: false,
  lastConversion: null, // { text, meta, options } for "Wrong tuning? Re-do as:"
  reading: null, // what came back from reading a picture of the music
  earlier: null, // an earlier picture read of this same page, to join onto
  wholeSong: false, // true while scrolling the page and reading it right through
};

// --------------------------------------------------------------------------
// Rendering
// --------------------------------------------------------------------------

function show(viewId) {
  for (const id of VIEWS) $(id).hidden = id !== viewId;
}

function setMainVisible(visible) {
  $("main-action").hidden = !visible;
}

function setPasteOpen(open) {
  $("paste-body").hidden = !open;
  $("paste-toggle").setAttribute("aria-expanded", open ? "true" : "false");
}

function hasPaste() {
  return state.pasteKind !== "none";
}

function updateMainSubtext() {
  const el = $("main-subtext");
  if (state.busy) el.textContent = P.working;
  else el.textContent = hasPaste() ? P.mainSubtextPaste : P.mainSubtext;
}

function setBusy(busy) {
  state.busy = busy;
  $("main-button").disabled = busy;
  $("tuning-select").disabled = busy;
  updateMainSubtext();
}

function displayTitle(page) {
  const title = (page.title || "").trim();
  const artist = (page.artist || "").trim();
  if (title && artist) return `${title} — ${artist}`;
  return title || artist || P.foundUntitled;
}

/**
 * What to say about a picture that could not be read.
 *
 * Each answer names the thing that went wrong and what to do about it. "This
 * page is a picture" is not something the user can act on; "make the page
 * bigger and click again" is, and it usually works, because everything in
 * here gets easier the larger the numbers are drawn.
 */
function pictureProblem(reading) {
  if (!reading) return P.unsupported;
  if (reading.reason === "notation-only") return P.pictureNotation;
  if (reading.reason === "no-staves" || reading.reason === "blank") return P.pictureNoStaves;
  return P.pictureNothing;
}

function renderPicturePanel() {
  const reading = state.reading;
  const note = $("picture-note");
  const partial = $("picture-partial");
  const join = $("picture-join");
  const showing = !!(state.page && state.page.fromPicture && reading);
  note.hidden = !showing;
  partial.hidden = !showing;
  join.hidden = !(showing && state.earlier);
  renderWholeSong();
  if (!showing) return;
  note.textContent = `${P.pictureNotes(reading.notes)} ${reading.unreadable ? P.pictureUnsure : P.pictureCheck}`;
  const percent = coverageOf(reading.scroll);
  partial.hidden = percent === null;
  if (percent !== null) partial.textContent = P.picturePartial(percent);
}

/**
 * The offer to read the rest of the song, and how it is going.
 *
 * Offered only when there is a rest to read: a picture read that covered the
 * whole score has nothing to scroll to, and a button that does nothing is
 * worse than no button.
 */
function renderWholeSong() {
  const button = $("whole-song");
  const status = $("whole-song-status");
  const reading = state.reading;
  const partial = !!(state.page && state.page.fromPicture && reading && reading.ok && coverageOf(reading.scroll) !== null);
  button.hidden = !(partial || state.wholeSong);
  button.disabled = state.wholeSong;
  status.hidden = !state.wholeSong;
  if (state.wholeSong) status.textContent = P.wholeSongWorking(1);
}

function renderPageState() {
  if (state.page) {
    show("view-found");
    $("found-label").textContent = state.page.fromPicture ? P.foundPicture : state.page.kind === "chords" ? P.foundChords : P.foundTab;
    $("song-title").textContent = displayTitle(state.page);
    renderPicturePanel();
    setMainVisible(true);
    if (state.page.fromPicture) setPasteOpen(true);
  } else {
    show("view-notfound");
    $("notfound-message").textContent = state.pageReason === "picture" ? pictureProblem(state.reading) : state.pageReason === "unsupported" ? P.unsupported : P.notFound;
    setMainVisible(hasPaste()); // never a dead button: it appears once there is something to send
    setPasteOpen(true);
  }
  updateMainSubtext();
}

function renderError(code) {
  const messages = {
    "no-tab": P.noNotes,
    "no-notes": P.noNotes,
    unsupported: P.unsupported,
    "download-failed": P.downloadFailed,
  };
  show("view-error");
  $("error-message").textContent = messages[code] || P.unknownError;
  setPasteOpen(true);
  setMainVisible(hasPaste() || (code === "download-failed" && !!state.page));
  updateMainSubtext();
}

function renderSuccess(result, { recent = false } = {}) {
  show("view-success");
  $("recent-heading").hidden = !recent;
  $("saved-filename").textContent = P.savedAs(result.filename);
  $("chords-note").hidden = result.kind !== "chords";
  $("chords-note").textContent = P.chordSheet;
  $("rhythm-note").textContent = result.rhythmSource === "exact" ? P.rhythmExact : P.rhythmGuessed;
  $("tracks-note").textContent = Array.isArray(result.tracks) && result.tracks.length ? P.tracksMade(result.tracks.join(", ")) : "";
  const tuningRow = document.querySelector(".tuning-row");
  tuningRow.hidden = result.kind !== "tab";
  $("tuning-select").value = result.tuningId && SELECTABLE_TUNING_IDS.includes(result.tuningId) ? result.tuningId : "custom";
  $("redo-status").hidden = true;
  setMainVisible(false);
  setPasteOpen(false);
}

function buildTuningSelect() {
  const select = $("tuning-select");
  select.textContent = "";
  for (const id of [...SELECTABLE_TUNING_IDS, "custom"]) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = STRINGS.tunings[id];
    if (id === "custom") option.disabled = true;
    select.appendChild(option);
  }
}

// --------------------------------------------------------------------------
// Reading the page
// --------------------------------------------------------------------------

async function activeTab() {
  try {
    let tabs = await browser.tabs.query({ active: true, currentWindow: true });
    // A popup is not always counted as being in the current window; asking
    // for the last focused one is the reliable follow-up.
    if (!tabs || !tabs.length) tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    // windowId comes along because tabs.captureVisibleTab wants one, and
    // "the current window" is ambiguous from a popup in a way an id is not.
    return tabs && tabs[0] ? { id: tabs[0].id, url: tabs[0].url || null, windowId: tabs[0].windowId } : null;
  } catch (err) {
    console.warn("[tab2roll] could not find the active tab", err);
    return null;
  }
}

/** The first usable value out of an executeScript reply, or null. */
function firstResult(results) {
  if (!Array.isArray(results)) return null;
  for (const entry of results) {
    if (entry && entry.result && typeof entry.result === "object") return entry.result;
  }
  return null;
}

/**
 * What the browser handed back, as a string. A string on purpose: the console
 * collapses arrays inside logged objects, so an object here would be reported
 * back as "entries: (1) [...]", which says nothing.
 */
function describeResults(results) {
  if (!Array.isArray(results)) return `not an array (${typeof results})`;
  const entries = results.map((entry) => {
    const error = entry && entry.error ? String(entry.error.message || entry.error) : null;
    return `{ hasResult: ${!!(entry && entry.result)}, error: ${error === null ? "none" : JSON.stringify(error)} }`;
  });
  return `frames: ${results.length}, ${entries.join(", ")}`;
}

/**
 * Run the extractor in the page and get its answer back.
 *
 * Two routes, because browsers disagree about the first one. Chromium hands
 * back a file-injected script's completion value; Firefox does not do so
 * reliably, and returns nothing at all. So the script also parks its answer
 * on a global in the extension's own sandbox, and a second, tiny injection
 * fetches it — the return value of an injected FUNCTION is well defined
 * everywhere.
 */
async function runExtractor(tabId) {
  const injected = await browser.scripting.executeScript({ target: { tabId }, files: [INJECTED_SCRIPT] });
  console.log("[tab2roll] ran the extractor:", describeResults(injected));
  const direct = firstResult(injected);
  if (direct) return direct;

  const collected = await browser.scripting.executeScript({
    target: { tabId },
    func: (name) => {
      const value = globalThis[name];
      return value && typeof value === "object" ? value : null;
    },
    args: [RESULT_GLOBAL],
  });
  console.log("[tab2roll] collected the answer separately:", describeResults(collected));
  return firstResult(collected);
}

/** Run the injected extractor on the page (activeTab grants access on click). */
async function lookAtPage() {
  state.page = null;
  state.pageReason = "none";
  if (!state.tab || typeof state.tab.id !== "number") return;
  console.log("[tab2roll] reading tab", state.tab.id, state.tab.url || "(url not visible)");
  // Extension pages, about: pages and the like cannot be read, and Firefox
  // blocks the attempt rather than failing outright. Saying so plainly beats
  // reporting that a page has no tab on it.
  if (state.tab.url && !READABLE_URL.test(state.tab.url)) {
    console.warn("[tab2roll] this is not a web page I can read:", state.tab.url);
    return;
  }
  let result = null;
  try {
    result = await runExtractor(state.tab.id);
  } catch (err) {
    // Pages Firefox will not let extensions read (about:, the add-ons site,
    // PDF viewer) land here. That is a "not found", not an error.
    console.warn("[tab2roll] could not read this page:", err && err.message ? err.message : err);
    return;
  }
  // One console line per click saying exactly what the page looked like, so a
  // failure on a real site does not have to be guessed at.
  console.log("[tab2roll] page:", result ? { ok: result.ok, reason: result.reason, site: result.site, strategy: result.strategy, chars: result.text ? result.text.length : 0, ...(result.seen || {}) } : "no result from the page");

  if (result && result.ok && typeof result.text === "string") {
    const found = detect(result.text);
    console.log("[tab2roll] read as:", found.kind, found);
    if (found.kind !== "none") {
      state.page = { ...result, kind: found.kind };
      return;
    }
    // Text came back but nothing in it reads as a song. Say so plainly, and
    // keep the text so the paste box can be primed with it.
    state.pageText = result.text;
    state.pageReason = "none";
    return;
  }
  if (result && result.reason === "error") console.error("[tab2roll] extractor failed inside the page:", result.message);

  // No text anywhere on the page. If it draws the music instead — a tab
  // player, a score on a canvas — read the picture.
  const hasScore = result && Array.isArray(result.score) && result.score.length;
  const hasShots = result && Array.isArray(result.shots) && result.shots.length;
  if (hasScore || hasShots) {
    await readPagePicture(result);
    return;
  }
  if (result && result.reason) state.pageReason = result.reason === "unsupported" ? "unsupported" : "none";
}

/** What a reading came to, short enough for one console line. */
function describeReading(reading) {
  if (!reading) return "nothing readable";
  return { ok: reading.ok, reason: reading.reason, staves: reading.staves, strings: reading.strings, notes: reading.notes, bars: reading.bars, unreadable: reading.unreadable, confidence: reading.confidence };
}

/**
 * Read the music off the page's pixels and, if there is music in them, use it.
 *
 * Two sources, in that order. A canvas hands over exactly what was drawn on
 * it, which is the best picture of the music there is — but only if the page
 * will part with it. A player drawing through WebGL, or from a worker, hands
 * over nothing at all, and Ultimate Guitar's "Official" tabs are one of those:
 * the page has a score on it that its own canvas will not give up. For those
 * the picture is taken the way a person would take it, with a photograph of
 * the window cropped to the player, which holds whatever is on the screen
 * however the page drew it.
 */
async function readPagePicture(result) {
  const reading = await readScreenful(result);
  state.reading = reading;
  state.pageReason = "picture";
  if (!reading || !reading.ok) return;
  state.earlier = state.tab ? getPictureRead(state.tab.url) : null;
  if (state.earlier && state.earlier.text === reading.text) state.earlier = null;
  usePictureRead(result, reading);
}

/** One look at the page: the canvas if it will give up its pixels, a photograph if not. */
async function readScreenful(result) {
  let reading = null;
  if (Array.isArray(result.score) && result.score.length) {
    reading = readBestPicture(result.score);
    console.log("[tab2roll] read the canvas:", describeReading(reading));
  }
  if ((!reading || !reading.ok) && Array.isArray(result.shots) && result.shots.length) {
    const photographed = await readPhotograph(result);
    console.log("[tab2roll] read a photograph of the window:", describeReading(photographed));
    reading = bestReading(reading, photographed);
  }
  return reading;
}

/** Take a reading as this page's answer: into the paste box, and remembered. */
function usePictureRead(result, reading) {
  // The pixels themselves are deliberately left behind: state.page is read
  // for the song's name and little else, and it is no place for a megabyte.
  const { score, shots, view, seen, ...page } = result;
  state.page = {
    ...page,
    ok: true,
    text: reading.text,
    kind: "tab",
    fromPicture: true,
    site: result.site || "picture",
  };
  setPasteText(reading.text);
  if (state.tab) setPictureRead({ url: state.tab.url, text: reading.text });
}

/**
 * Photograph the window and read the parts of it the page would not hand over.
 *
 * activeTab — granted by the click that opened this popup — is what allows
 * this, and it allows it for this one tab, this once. Nothing is saved and
 * nothing is sent: the photograph is cropped to the player, read, and gone by
 * the time the popup closes.
 */
async function readPhotograph(result) {
  if (!browser.tabs || typeof browser.tabs.captureVisibleTab !== "function") return null;
  let photo = null;
  try {
    // PNG on purpose. A JPEG's smudges around a small "7" are exactly the
    // kind of thing that turns it into a "1".
    const windowId = state.tab && typeof state.tab.windowId === "number" ? state.tab.windowId : undefined;
    photo = await browser.tabs.captureVisibleTab(windowId, { format: "png" });
  } catch (err) {
    console.warn("[tab2roll] could not photograph the window:", err && err.message ? err.message : err);
    return null;
  }
  if (typeof photo !== "string" || !photo) return null;
  const images = [];
  for (const shot of result.shots) {
    try {
      images.push(await imageDataFromShot(photo, shot, result.view));
    } catch (err) {
      console.warn("[tab2roll] could not cut the player out of the photograph:", err && err.message ? err.message : err);
    }
  }
  return images.length ? readBestPicture(images) : null;
}

/**
 * Scroll the page's score and wait for the player to redraw it.
 *
 * RUNS INSIDE THE TAB PAGE, and it is the one thing tab2roll ever does that
 * changes anything there. It only ever scrolls, it is only ever reached by
 * the user pressing "read the whole song", and the popup puts the page back
 * where it found it when the reading is done.
 *
 * The scroller is found the way a person would find it: from the biggest
 * canvas on the page, out through its ancestors to the first one that
 * actually scrolls, and failing that the page itself. That last case is not
 * an edge case — Ultimate Guitar's player is sticky inside a tall spacer, so
 * on a full-size window it is the document that moves and not the player.
 *
 * `behavior: "instant"` is not decoration. These players set
 * `scroll-behavior: smooth`, and a canvas caught part-way through an
 * animation is a photograph of nothing in particular.
 */
const SCROLL_SCORE = async (by, to, settleMs) => {
  let canvas = null;
  for (const c of document.querySelectorAll("canvas")) {
    if (!canvas || c.width * c.height > canvas.width * canvas.height) canvas = c;
  }
  const view = document.defaultView;
  let scroller = document.scrollingElement || document.documentElement;
  let node = canvas ? canvas.parentElement : null;
  for (let depth = 0; node && depth < 20; depth++) {
    const overflow = view ? view.getComputedStyle(node).overflowY : "";
    if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight + 8) {
      scroller = node;
      break;
    }
    node = node.parentElement;
  }
  if (!scroller) return null;
  const was = scroller.scrollTop;
  const want = typeof to === "number" ? to : was + by;
  scroller.scrollTo({ top: want, left: scroller.scrollLeft, behavior: "instant" });
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, settleMs))));
  const top = scroller.scrollTop;
  return {
    was,
    top,
    moved: top - was,
    height: scroller.scrollHeight,
    visible: scroller.clientHeight,
    atEnd: top + scroller.clientHeight >= scroller.scrollHeight - 2,
  };
};

/** Run SCROLL_SCORE in the page. `to` overrides `by` when it is a number. */
async function scrollScore(tabId, by, to = null) {
  try {
    const results = await browser.scripting.executeScript({ target: { tabId }, func: SCROLL_SCORE, args: [by || 0, to, REDRAW_MS] });
    return firstResult(results);
  } catch (err) {
    console.warn("[tab2roll] could not scroll the page:", err && err.message ? err.message : err);
    return null;
  }
}

/**
 * How far to scroll before the next look, in the page's own pixels.
 *
 * Past the last staff that was certainly whole, so the next look starts on
 * music nobody has read yet and no staff is read twice. When nothing in the
 * picture was whole there is nothing to measure from, and a plain screenful
 * — a little short of one, so a staff on the fold is not jumped clean over —
 * is the honest fallback.
 */
function scrollStepFor(reading, visible) {
  const screenful = Math.max(MIN_SCROLL_STEP, Math.round((visible || 0) * 0.8));
  if (!reading || !reading.ok || !reading.cssPerPixel) return screenful;
  const to = readTo(reading.systems, reading.height);
  if (!to) return screenful;
  return Math.max(MIN_SCROLL_STEP, Math.round(to * reading.cssPerPixel));
}

/**
 * Read the whole song: look, scroll, look again, all the way down.
 *
 * One click reads the screenful that happens to be showing, which on a
 * four-minute song is a verse if you are lucky. This walks the page instead,
 * keeping only the staves that were certainly whole in each look and starting
 * the next one just past them, so nothing is read twice and nothing on the
 * fold is lost. The page goes back where it was at the end, whatever happened
 * on the way — including if it threw.
 */
async function readWholeSong() {
  if (!state.tab || typeof state.tab.id !== "number" || state.wholeSong) return;
  const tabId = state.tab.id;
  state.wholeSong = true;
  renderWholeSong();

  const reads = [];
  let home = null;
  let visible = state.reading && state.reading.scroll ? state.reading.scroll.visible : 0;
  try {
    for (let pass = 0; pass < MAX_SCREENFULS; pass++) {
      $("whole-song-status").textContent = P.wholeSongWorking(pass + 1);
      const result = await runExtractor(tabId);
      if (!result) break;
      const reading = await readScreenful(result);
      // Only the staves that were certainly whole. A screenful with nothing
      // whole in it contributes nothing rather than a staff that might be
      // four lines of a six-line one; the single read this started from is
      // still there to fall back on if the walk comes to less than it did.
      const whole = wholeReading(reading);
      if (whole) reads.push(whole);

      const where = await scrollScore(tabId, scrollStepFor(reading, visible));
      if (!where) break;
      if (home === null) home = where.was;
      visible = where.visible || visible;
      if (where.atEnd || where.moved < 1) break;
    }
  } finally {
    if (home !== null) await scrollScore(tabId, 0, home);
    state.wholeSong = false;
  }

  const stitched = stitchReads(reads);
  console.log("[tab2roll] read the whole song:", { ...describeReading(stitched), screenfuls: stitched.screenfuls });
  // Nothing more than one click had already read: a page that would not
  // scroll, or one whose next screenfuls held no staff we could trust. What
  // was already in the box stays there, and the reason is said out loud.
  if (!stitched.ok || (state.reading && state.reading.ok && stitched.notes <= state.reading.notes)) {
    renderWholeSong();
    saidAfterTheWalk(P.wholeSongNothing);
    return;
  }
  state.reading = stitched;
  usePictureRead(state.page || { site: "picture" }, stitched);
  state.earlier = null;
  renderPageState();
  saidAfterTheWalk(P.wholeSongRead(stitched.screenfuls));
}

/**
 * How the walk went, left on the screen after it.
 *
 * Both renderers above hide this line, because while nothing is walking there
 * is nothing to say. Saying it means putting it back.
 */
function saidAfterTheWalk(message) {
  const status = $("whole-song-status");
  status.hidden = false;
  status.textContent = message;
}

// --------------------------------------------------------------------------
// Converting
// --------------------------------------------------------------------------

function currentOptions() {
  const options = getOptions();
  return { step: options.step, arrange: options.arrange !== false };
}

async function convert({ text, meta, options }) {
  setBusy(true);
  try {
    const reply = await browser.runtime.sendMessage({ type: "tab2roll:convert", text, meta, options });
    if (reply && reply.ok) {
      state.lastConversion = { text, meta, options };
      const result = {
        filename: reply.filename,
        kind: reply.kind,
        rhythmSource: reply.rhythmSource,
        tuningId: reply.tuningId,
        tracks: reply.tracks,
        title: reply.title,
        pageUrl: meta.source === "paste" ? null : state.tab && state.tab.url,
      };
      setLastResult({ ...result, conversion: state.lastConversion });
      renderSuccess(result);
    } else {
      renderError(reply && reply.code);
    }
  } catch (err) {
    console.error("[tab2roll] could not reach the background page", err);
    renderError("unknown");
  } finally {
    setBusy(false);
  }
}

function pageMeta() {
  if (!state.page) return { source: "paste" };
  return {
    source: state.page.site || "generic",
    title: state.page.title || "",
    artist: state.page.artist || "",
    tuning: typeof state.page.tuning === "string" ? state.page.tuning : "",
    capo: typeof state.page.capo === "number" ? state.page.capo : undefined,
  };
}

async function onMainClick() {
  if (state.busy) return;
  const usePaste = hasPaste();
  if (!usePaste && !state.page) return;
  const text = usePaste ? $("paste-text").value : state.page.text;
  // Tab read off a picture of the page sits in the paste box so it can be
  // checked and corrected, but it is still this page's song: keep its title,
  // artist and tuning rather than treating it as text from nowhere.
  const fromPage = state.page && state.page.fromPicture;
  const meta = usePaste && !fromPage ? { source: "paste" } : pageMeta();
  if (fromPage && state.tab) setPictureRead({ url: state.tab.url, text });
  await convert({ text, meta, options: currentOptions() });
}

async function onTuningChange() {
  const id = $("tuning-select").value;
  if (state.busy || !state.lastConversion || id === "custom") return;
  const { text, meta, options } = state.lastConversion;
  const label = (STRINGS.tunings[id] || id).replace(/\s*\(.*\)$/, "");
  $("redo-status").hidden = false;
  await convert({ text, meta, options: { ...options, tuningId: id, filenameSuffix: label } });
}

/** Put text in the paste box and tell the rest of the popup about it. */
function setPasteText(text) {
  $("paste-text").value = text;
  onPasteInput();
}

/**
 * A picture dropped or pasted into the popup.
 *
 * The same reader as the page's own canvas, so a screenshot of any tab
 * player, a photo of a songbook or a page out of a chord chart all work the
 * same way and all land in the same box for checking.
 */
async function readDroppedPicture(file) {
  const status = $("paste-status");
  status.textContent = P.dropReading;
  setPasteOpen(true);
  // Let the message paint before the reading starts: it is all one long
  // stretch of arithmetic, and the popup cannot redraw in the middle of it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  let reading = null;
  try {
    reading = readBestPicture([await imageDataFromFile(file)]);
  } catch (err) {
    console.error("[tab2roll] could not read that picture", err);
  }
  if (!reading || !reading.ok) {
    status.textContent = reading ? pictureProblem(reading) : P.dropFailed;
    return;
  }
  state.reading = reading;
  const existing = $("paste-text").value.trim();
  setPasteText(existing ? `${existing}\n\n${reading.text}` : reading.text);
  status.textContent = `${P.pictureNotes(reading.notes)} ${reading.unreadable ? P.pictureUnsure : P.pictureCheck}`;
}

function onDrop(event) {
  const file = imageFileOf(event.dataTransfer);
  if (!file) return;
  event.preventDefault();
  readDroppedPicture(file);
}

function onPasteEvent(event) {
  const file = imageFileOf(event.clipboardData);
  if (!file) return;
  event.preventDefault();
  readDroppedPicture(file);
}

/** Join this screenful onto the one read before it. */
function onPictureJoin() {
  if (!state.earlier) return;
  const now = $("paste-text").value.trim();
  setPasteText(`${state.earlier.text.trim()}\n\n${now}`);
  state.earlier = null;
  $("picture-join").hidden = true;
  $("paste-status").textContent = P.pictureAdded;
  if (state.tab) setPictureRead({ url: state.tab.url, text: $("paste-text").value });
}

function onPasteInput() {
  const text = $("paste-text").value;
  const kind = text.trim() ? detect(text).kind : "none";
  state.pasteKind = kind;
  const status = $("paste-status");
  if (!text.trim()) status.textContent = "";
  else if (kind === "tab") status.textContent = P.pasteLooksLikeTab;
  else if (kind === "chords") status.textContent = P.pasteLooksLikeChords;
  else status.textContent = P.pasteNotYet;
  if (!$("view-success").hidden) {
    // Typing into the box after a save means "do another one".
    renderPageState();
  }
  if (!state.page) setMainVisible(kind !== "none");
  updateMainSubtext();
}

function onConvertAnother() {
  setLastResult(null);
  renderPageState();
}

// --------------------------------------------------------------------------
// Wiring
// --------------------------------------------------------------------------

function showVersion() {
  const version = getVersion();
  $("version").textContent = version ? P.version(version) : "";
}

function wireEvents() {
  $("main-button").addEventListener("click", onMainClick);
  $("tuning-select").addEventListener("change", onTuningChange);
  $("convert-another").addEventListener("click", onConvertAnother);
  $("paste-toggle").addEventListener("click", () => setPasteOpen($("paste-body").hidden));
  $("paste-text").addEventListener("input", onPasteInput);
  $("picture-join").addEventListener("click", onPictureJoin);
  $("whole-song").addEventListener("click", () => {
    readWholeSong().catch((err) => {
      console.error("[tab2roll] reading the whole song went wrong", err);
      state.wholeSong = false;
      renderWholeSong();
      $("whole-song-status").hidden = false;
      $("whole-song-status").textContent = P.wholeSongNothing;
    });
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", onDrop);
  document.addEventListener("paste", onPasteEvent);
  $("show-me-how").addEventListener("click", (e) => {
    e.preventDefault();
    openPage("ui/help.html#fl-studio");
  });
  // A dropped file FL Studio refuses is silent: no message, no icon, nothing
  // moves. The user has no way to tell that from a broken file, so the way
  // out has to be offered right where the file was just saved.
  $("drag-trouble").addEventListener("click", (e) => {
    e.preventDefault();
    openPage("ui/help.html#drag-does-nothing");
  });
  $("link-help").addEventListener("click", (e) => {
    e.preventDefault();
    openPage("ui/help.html");
  });
  $("link-settings").addEventListener("click", (e) => {
    e.preventDefault();
    Promise.resolve(browser.runtime.openOptionsPage ? browser.runtime.openOptionsPage() : openPage("ui/options.html")).catch(() => openPage("ui/options.html"));
  });
}

async function init() {
  fillStrings();
  showVersion();
  buildTuningSelect();
  wireEvents();
  show("view-checking");
  setMainVisible(false);

  state.tab = await activeTab();

  // A popup closes the moment it loses focus, so a confirmation can vanish
  // before it is read. Show the last one again if it was a few minutes ago
  // and we are still on the same page (or it came from pasted text).
  const recent = getLastResult();
  if (recent && recent.filename && (!recent.pageUrl || (state.tab && recent.pageUrl === state.tab.url))) {
    state.lastConversion = recent.conversion || null;
    renderSuccess(recent, { recent: true });
    lookAtPage().catch((err) => console.warn("[tab2roll]", err));
    return;
  }

  await lookAtPage();
  renderPageState();
}

init().catch((err) => {
  console.error("[tab2roll] popup failed to start", err);
  renderError("unknown");
});
