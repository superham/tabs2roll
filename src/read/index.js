// read/: a picture of sheet music -> ASCII tab text.
//
//   picture -> ink            image.js
//           -> staves         staff.js
//           -> marks          glyphs.js
//           -> digits         digits.js
//           -> notes and bars score.js
//           -> tab text       ascii.js
//
// What it reads: guitar and bass TABLATURE — the staff with fret numbers
// written on the strings — which is what tab players and Guitar Pro files are
// drawn as. Ordinary five-line notation is recognised as such and reported,
// but not turned into notes; working out pitches from noteheads, clefs, key
// signatures and accidentals is a different problem, and guessing at it
// would be worse than saying so.
//
// What it does not read: rhythm, other than from the spacing along the page.
// Stems, flags and beams are drawn below the staff and are not measured. That
// is the same guess the ASCII tab parser already makes, and it is written up
// in docs/musical-decisions.md.
//
// Pure ES module: no DOM, no browser APIs. The popup runs it on a picture
// taken off a page's canvas or dropped into the paste box; the CLI runs it on
// a PNG. Nothing in here knows which.

import { toInk, inkFraction } from "./image.js";
import { findStaves } from "./staff.js";
import { eraseStaffLines } from "./glyphs.js";
import { readSystem } from "./score.js";
import { toAsciiTab } from "./ascii.js";

export { toInk, toGray, inkFraction } from "./image.js";
export { findStaffLines, groupSystems, findStaves } from "./staff.js";
export { classifyGlyph } from "./digits.js";
export { readSystem, columnsOf } from "./score.js";
export { toAsciiTab, systemToAscii } from "./ascii.js";

/** A picture with less ink than this is blank: an empty canvas, a loading page. */
export const MIN_INK = 0.0005;

/** Reasons a picture gave nothing, in the order they are checked. */
export const REASONS = {
  blank: "blank",
  noStaves: "no-staves",
  notationOnly: "notation-only",
  noNotes: "no-notes",
};

/**
 * Read sheet music out of a picture.
 *
 * `image` is { width, height, data } (RGBA, i.e. an ImageData) or
 * { width, height, gray } (one byte a pixel).
 *
 * options:
 *   labels    string names top to bottom, when the caller knows the tuning
 *   inverted  force light-on-dark; by default the picture is asked
 *   minConfidence  how sure the reader must be of a mark to use it
 *
 * Returns { ok, text, reason, staves, notes, bars, unreadable, confidence,
 * systems }. `ok` false always comes with a `reason`, never an empty success.
 */
export function readSheetMusic(image, options = {}) {
  const bitmap = toInk(image, options);
  const ink = inkFraction(bitmap);
  if (ink < MIN_INK) return empty(REASONS.blank, { ink });

  const { lines, systems: found } = findStaves(bitmap, options);
  if (!found.length) return empty(REASONS.noStaves, { ink, lines: lines.length });

  const erased = eraseStaffLines(bitmap, lines);
  const systems = found.map((system) => readSystem(erased, system, options));
  const tabs = systems.filter((s) => s.kind === "tab");
  if (!tabs.length) return empty(REASONS.notationOnly, { ink, systems, staves: systems.length });

  const text = toAsciiTab(systems, options);
  const notes = tabs.reduce((n, s) => n + s.events.length, 0);
  if (!notes) return empty(REASONS.noNotes, { ink, systems, staves: tabs.length });

  const unreadable = tabs.reduce((n, s) => n + s.unreadable, 0);
  return {
    ok: true,
    text,
    reason: null,
    staves: tabs.length,
    notation: systems.length - tabs.length,
    strings: tabs[0].strings,
    notes,
    bars: tabs.reduce((n, s) => n + s.bars.length, 0),
    unreadable,
    confidence: confidenceOf(tabs, unreadable, notes),
    ink,
    systems,
  };
}

/**
 * How much the reader believes itself, 0 to 1.
 *
 * Two things pull it down: marks it could not make out at all, and marks it
 * matched only loosely. Shown to the user rather than kept quiet, because the
 * honest answer to "is this right?" on a blurry screenshot is "probably not,
 * have a look".
 */
export function confidenceOf(systems, unreadable, notes) {
  let total = 0;
  let count = 0;
  for (const system of systems) {
    for (const event of system.events) {
      total += Math.min(1, event.score);
      count++;
    }
  }
  if (!count) return 0;
  const mean = total / count;
  const missed = unreadable / (notes + unreadable);
  return Math.max(0, Math.min(1, mean * (1 - missed)));
}

function empty(reason, extra) {
  return { ok: false, text: "", reason, staves: 0, notation: 0, strings: 0, notes: 0, bars: 0, unreadable: 0, confidence: 0, systems: [], ...extra };
}
