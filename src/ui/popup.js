// The toolbar popup: the only entry point of the extension.
//
// States: checking -> found | not found -> (click) -> success | failure.
// Every user-facing string comes from src/strings.js. Real errors go to the
// console; the user only ever sees plain language plus what to do next.

import { fillStrings, browser, getOptions, getLastResult, setLastResult, getPictureRead, setPictureRead, openPage, getVersion, STRINGS } from "./common.js";
import { detect } from "../parse/index.js";
import { SELECTABLE_TUNING_IDS } from "../parse/tuning.js";
import { imageDataFromFile, imageFileOf, readBestPicture, coverageOf } from "./picture.js";

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
  if (!showing) return;
  note.textContent = `${P.pictureNotes(reading.notes)} ${reading.unreadable ? P.pictureUnsure : P.pictureCheck}`;
  const percent = coverageOf(reading.scroll);
  partial.hidden = percent === null;
  if (percent !== null) partial.textContent = P.picturePartial(percent);
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
    return tabs && tabs[0] ? { id: tabs[0].id, url: tabs[0].url || null } : null;
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
  if (result && Array.isArray(result.score) && result.score.length) {
    readPagePicture(result);
    return;
  }
  if (result && result.reason) state.pageReason = result.reason === "unsupported" ? "unsupported" : "none";
}

/** Read the picture(s) the page gave us and, if there is music in them, use it. */
function readPagePicture(result) {
  const reading = readBestPicture(result.score);
  state.reading = reading;
  state.pageReason = "picture";
  console.log("[tab2roll] read the picture:", reading ? { ok: reading.ok, reason: reading.reason, staves: reading.staves, strings: reading.strings, notes: reading.notes, bars: reading.bars, unreadable: reading.unreadable, confidence: reading.confidence } : "nothing readable");
  if (!reading || !reading.ok) return;
  state.earlier = state.tab ? getPictureRead(state.tab.url) : null;
  if (state.earlier && state.earlier.text === reading.text) state.earlier = null;
  state.page = {
    ...result,
    ok: true,
    text: reading.text,
    kind: "tab",
    fromPicture: true,
    site: result.site || "picture",
  };
  setPasteText(reading.text);
  if (state.tab) setPictureRead({ url: state.tab.url, text: reading.text });
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
