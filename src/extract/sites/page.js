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
export function describePage(doc, shape) {
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

export function extractFromPage(doc, shape, sites) {
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
