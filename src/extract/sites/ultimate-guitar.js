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

export function isUltimateGuitarHost(hostname) {
  return /(^|\.)ultimate-guitar\.com$/i.test(String(hostname || ""));
}

/**
 * Walk a parsed JSON object looking for the first object that has a string
 * property `key`. Depth-limited so a pathological page cannot hang the tab.
 */
export function findInJson(root, key, maxDepth) {
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
export function parseUltimateGuitarTitle(pageTitle) {
  const m = /^(.*?)\s+(BASS TAB|BASS|UKULELE CHORDS|UKULELE|GUITAR PRO|POWER TAB|OFFICIAL|CHORDS|TAB|DRUM TAB|DRUMS|VIDEO)\s+by\s+(.*?)\s*(?:@|\||$)/i.exec(String(pageTitle || ""));
  if (!m) return null;
  return { title: titleCase(m[1]), artist: titleCase(m[3]), type: m[2].toLowerCase() };
}

function titleCase(s) {
  const t = String(s || "").trim();
  if (t !== t.toUpperCase()) return t; // already mixed case; leave alone
  return t.toLowerCase().replace(/(^|[\s(\-"'])(\S)/g, (all, pre, ch) => pre + ch.toUpperCase());
}

export function extractUltimateGuitar(doc, shape) {
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
