// parse/: text -> IR.
//
// The IR (intermediate representation) is the one schema shared by every
// module:
//
//   {
//     version: 1,
//     source: "ultimate-guitar" | "paste" | "generic",
//     kind: "tab" | "chords",
//     title, artist,
//     tempo,                     // beats per minute
//     timeSignature: [num, den],
//     tuning: number[],          // open-string MIDI numbers, low to high
//     rhythmSource: "exact" | "guessed",
//     tracks: [{ role, notes: [{ midi, start, length, velocity, technique }] }]
//   }
//
// `start` and `length` are in BEATS (quarter notes) as floats, not ticks.
// `velocity` is 0..1. Consumers convert at their own boundary.
//
// Pure ES module: no DOM, no browser APIs.

import { splitLines } from "./text.js";
import { detect } from "./detect.js";
import { findMeta } from "./meta.js";
import { parseTab, STEP_BEATS, DEFAULT_STEP } from "./tab.js";
import { parseChordSheet } from "./chords.js";
import { STANDARD_GUITAR, tuningById } from "./tuning.js";

export { detect } from "./detect.js";
export { looksLikeTab, tabLineCount, isTabShapedLine } from "./tabshape.js";
export { cleanText } from "./text.js";
export { findMeta } from "./meta.js";
export { STEP_BEATS, DEFAULT_STEP } from "./tab.js";
export * as tuning from "./tuning.js";

export const DEFAULT_TEMPO = 120;
export const IR_VERSION = 1;

/**
 * Error thrown when the text cannot be turned into notes. `code` is one of:
 *   "no-tab"    - nothing tab- or chord-shaped in the text
 *   "no-notes"  - tab found, but it produced zero notes
 */
export class ParseError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "ParseError";
    this.code = code;
  }
}

/**
 * Parse tab or chord-sheet text into the IR.
 *
 * options:
 *   source     "ultimate-guitar" | "paste" | "generic"   (default "paste")
 *   title, artist   known from the page; header lines in the text are the fallback
 *   tempo      known from the page (overrides the text)
 *   tuningId   force a named tuning (the "Wrong tuning? Re-do as:" dropdown)
 *   tuning     force explicit open-string notes low-to-high
 *   step       "1/4" | "1/8" | "1/16" timing step (default "1/8")
 *   capo       capo fret known from the page
 *   kind       force "tab" or "chords" instead of detecting
 */
export function parseText(text, options = {}) {
  const lines = splitLines(text);
  const meta = findMeta(lines);
  const detected = detect(text);
  const kind = options.kind || detected.kind;
  if (kind === "none") throw new ParseError("no-tab", "No tab or chords found in text");

  const timeSignature = meta.timeSignature || [4, 4];
  const tempo = options.tempo || meta.tempo || DEFAULT_TEMPO;
  const title = options.title || meta.title || "";
  const artist = options.artist || meta.artist || "";
  const capo = typeof options.capo === "number" ? options.capo : meta.capo;

  let override = null;
  if (Array.isArray(options.tuning)) override = options.tuning;
  else if (options.tuningId) {
    const t = tuningById(options.tuningId);
    if (t) override = t.notes;
  }

  const ir = {
    version: IR_VERSION,
    source: options.source || "paste",
    kind,
    title,
    artist,
    tempo,
    timeSignature,
    tuning: STANDARD_GUITAR.slice(),
    rhythmSource: "guessed",
    tracks: [],
    info: { staves: 0, chords: 0, capo, tuningId: null, tuningFrom: null, step: STEP_BEATS[options.step] ? options.step : DEFAULT_STEP },
  };

  if (kind === "chords") {
    const parsed = parseChordSheet(text, { timeSignature });
    if (!parsed.notes.length) throw new ParseError("no-notes", "Chord sheet produced no notes");
    ir.tracks.push({ role: "guitar", notes: parsed.notes });
    ir.info.chords = parsed.chordCount;
    ir.info.totalBeats = parsed.totalBeats;
    return ir;
  }

  const parsed = parseTab(text, {
    step: options.step,
    tuning: override,
    headerTuning: meta.tuning,
    capo,
    timeSignature,
  });
  if (!parsed.notes.length) throw new ParseError("no-notes", "Tab produced no notes");
  ir.tracks.push({ role: "guitar", notes: parsed.notes });
  ir.tuning = parsed.tuning;
  ir.info.staves = parsed.staveCount;
  ir.info.strings = parsed.stringCount;
  ir.info.tuningId = parsed.tuningId;
  ir.info.unit = parsed.unit;
  ir.info.totalBeats = parsed.totalBeats;
  return ir;
}
