// Detector: is this text ASCII tab, a chord sheet, or neither?
// Pure ES module: no DOM, no browser APIs.

import { splitLines } from "./text.js";
import { looksLikeTab } from "./tabshape.js";
import { findStaves, scanLine } from "./tab.js";
import { chordStats } from "./chords.js";

/**
 * Returns { kind: "tab" | "chords" | "none", staves, chordLines, chords }.
 *
 * A text with real staves is tab, unless the staves are a single short
 * intro riff on what is otherwise a chord sheet — then the chords win,
 * because that is what the page is about.
 */
export function detect(text) {
  const lines = splitLines(text);
  const staves = findStaves(lines);
  const staveNotes = staves.reduce((n, s) => n + s.lines.reduce((m, l) => m + scanLine(l.body).events.length, 0), 0);
  const { chordLines, chords } = chordStats(lines);
  const result = { staves: staves.length, staveNotes, chordLines, chords, tabShaped: looksLikeTab(text) };

  if (staves.length >= 2) return { kind: "tab", ...result };
  if (staves.length === 1) {
    if (chords >= 8 && chordLines >= 3 && staveNotes < 24) return { kind: "chords", ...result };
    return { kind: "tab", ...result };
  }
  if (chords >= 3 && chordLines >= 1) return { kind: "chords", ...result };
  return { kind: "none", ...result };
}
