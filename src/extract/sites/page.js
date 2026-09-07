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

export function extractFromPage(doc, shape, sites) {
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
