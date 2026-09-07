// Detector: is this text ASCII tab, a chord sheet, or neither?
// Pure ES module: no DOM, no browser APIs.

import { splitLines } from "./text.js";
import { looksLikeTab, looksLikeChordSheet, isChordOnlyLine } from "./tabshape.js";
import { trimToSong } from "./region.js";
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
  // Classify what the song is, not what the surrounding page is: a chord
  // legend and an A-Z artist index are both nothing but chord lines.
  const song = trimToSong(text);
  const lines = splitLines(song);
  const staves = findStaves(lines);
  const staveNotes = staves.reduce((n, s) => n + s.lines.reduce((m, l) => m + scanLine(l.body).events.length, 0), 0);
  const { chordLines, chords } = chordStats(lines);
  const result = { staves: staves.length, staveNotes, chordLines, chords, tabShaped: looksLikeTab(text) };

  if (staves.length >= 2) return { kind: "tab", ...result };
  if (staves.length === 1) {
    if (chords >= 8 && chordLines >= 3 && staveNotes < 24) return { kind: "chords", ...result };
    return { kind: "tab", ...result };
  }
  if (looksLikeChordSheet(song) || isBareProgression(lines)) return { kind: "chords", ...result };
  return { kind: "none", ...result };
}

/**
 * A chord progression pasted on its own, with no words: "C G Am F". Worth
 * accepting, but only when there is essentially nothing else in the text —
 * otherwise a page's chord legend ("E / C#m / G#m / B / A") and its A-Z
 * artist index ("A / B / C / D / E / F / G") would qualify too.
 */
function isBareProgression(lines) {
  let chordLines = 0;
  let otherLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isChordOnlyLine(line)) chordLines++;
    else otherLines++;
  }
  return chordLines >= 2 && otherLines <= 1;
}
