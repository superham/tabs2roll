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

export function isPlayerOnlyHost(hostname) {
  const h = String(hostname || "").toLowerCase();
  return PLAYER_ONLY_HOSTS.some((site) => h === site || h.endsWith("." + site));
}

/** Text of an element as a person sees it, with line breaks preserved. */
export function textOf(el) {
  if (!el) return "";
  const t = typeof el.innerText === "string" ? el.innerText : el.textContent;
  return t || "";
}

/** "Song Name - Some Site" / "Song Name | Site" -> "Song Name" */
export function cleanPageTitle(title) {
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

export function extractGeneric(doc, shape) {
  const host = doc.location ? doc.location.hostname : "";
  if (isPlayerOnlyHost(host)) return { ok: false, reason: "unsupported", site: "generic" };
  const found = fromPreElements(doc, shape) || fromDeepestElements(doc, shape) || fromBodyText(doc, shape);
  if (!found) return null;
  return { ok: true, site: "generic", title: pageTitle(doc), artist: "", text: found.text, strategy: found.strategy };
}
