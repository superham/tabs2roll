// Song-region finder: cut a whole web page down to just the song.
//
// Modern chord pages surround the song with navigation, a chord-diagram
// legend, a strumming grid, comments, "related songs" and an A-Z artist
// index. Read as text, several of those are indistinguishable from chord
// lines: the legend is literally "E / C#m / G#m / B / A" one per line, and
// the artist index is "A / B / C / D / E / F / G". Left alone they become
// bars of music at the start and end of the file.
//
// This runs on TEXT, not on the DOM, on purpose: the same clean-up then
// protects the toolbar button and the paste box, where a user will very
// reasonably select the whole page and paste it.
//
// Pure ES module: no DOM, no browser APIs.

import { splitLines } from "./text.js";
import { isChordOnlyLine, isLyricLine, isSectionLine, isMetadataLine, isTabShapedLine } from "./tabshape.js";

// --------------------------------------------------------------------------
// Tunable weights
// --------------------------------------------------------------------------

/**
 * How much each kind of line argues for "the song is here". A run of lines is
 * kept when its total is the highest anywhere in the text, so these are
 * relative weights, not thresholds.
 */
export const SCORES = {
  tab: 4, // a stave line: unmistakable song content
  section: 4, // "[Verse]", "Chorus 1"
  chordSupported: 3, // a chord line sitting next to words
  chordAlone: -3, // a chord line with no words anywhere near it: a legend
  lyricNearChords: 2, // words next to chords: the other half of a chord sheet
  lyricAlone: -1, // prose with no chords: comments, blurb, footer
  metadata: -1, // "Tuning: ...", "© 2026", a URL
  blank: 0,
  other: -2, // nav items, counts, stray single words
};

/**
 * A run of chord lines longer than this with no words inside it is a list of
 * chords (a legend, an index), not someone playing a song.
 */
export const MAX_CHORD_RUN = 8;

/** How far from a chord line words still count as belonging to it. */
export const NEAR = 2;

/** Never trim away so much that this little of the song's chords is left. */
export const MIN_KEPT_CHORD_LINES = 3;

// --------------------------------------------------------------------------
// Classification
// --------------------------------------------------------------------------

/** One of: "blank" | "tab" | "chord" | "section" | "lyric" | "metadata" | "other". */
export function classifyLine(line) {
  const text = String(line || "").trim();
  if (!text) return "blank";
  if (isTabShapedLine(text)) return "tab";
  if (isSectionLine(text)) return "section";
  if (isChordOnlyLine(text)) return "chord";
  if (isMetadataLine(text)) return "metadata";
  if (isLyricLine(text)) return "lyric";
  return "other";
}

/**
 * Decide, for every chord line, whether it belongs to a song.
 *
 * Chord lines come in runs: one per line in the stacked layout that pages
 * like GuitarTuna use, or one line per lyric in the aligned layout. A run is
 * part of a song when the words it belongs to sit immediately before or after
 * it. A run with words on neither side is a legend or an index.
 */
export function markSupportedChords(kinds) {
  const supported = new Array(kinds.length).fill(false);
  let i = 0;
  while (i < kinds.length) {
    if (kinds[i] !== "chord") {
      i++;
      continue;
    }
    // Extend over the run of chord lines (blank lines do not break it).
    let end = i;
    let count = 0;
    for (let j = i; j < kinds.length; j++) {
      if (kinds[j] === "chord") {
        end = j;
        count++;
      } else if (kinds[j] !== "blank") break;
    }
    const before = previousSolid(kinds, i);
    const after = nextSolid(kinds, end);
    const hasWords = isWordy(kinds[before]) || isWordy(kinds[after]);
    if (hasWords && count <= MAX_CHORD_RUN) {
      for (let j = i; j <= end; j++) if (kinds[j] === "chord") supported[j] = true;
    }
    i = end + 1;
  }
  return supported;
}

/**
 * What counts as "the chords beside this belong to a song": words being sung,
 * a section marker, or a stave (chord names written above tab).
 */
function isWordy(kind) {
  return kind === "lyric" || kind === "section" || kind === "tab";
}

function previousSolid(kinds, from) {
  for (let j = from - 1; j >= 0; j--) if (kinds[j] !== "blank" && kinds[j] !== "chord") return j;
  return -1;
}

function nextSolid(kinds, from) {
  for (let j = from + 1; j < kinds.length; j++) if (kinds[j] !== "blank" && kinds[j] !== "chord") return j;
  return -1;
}

/** Score every line. Higher means "more likely to be the song". */
export function scoreLines(lines) {
  const kinds = lines.map(classifyLine);
  const supported = markSupportedChords(kinds);
  const anchored = kinds.map((kind, i) => (kind === "section" ? true : supported[i]));
  return kinds.map((kind, i) => {
    switch (kind) {
      case "tab":
        return SCORES.tab;
      case "section":
        return SCORES.section;
      case "chord":
        return supported[i] ? SCORES.chordSupported : SCORES.chordAlone;
      case "lyric":
        return nearAnchor(anchored, i) ? SCORES.lyricNearChords : SCORES.lyricAlone;
      case "metadata":
        return SCORES.metadata;
      case "blank":
        return SCORES.blank;
      default:
        return SCORES.other;
    }
  });
}

function nearAnchor(anchored, i) {
  for (let j = Math.max(0, i - NEAR); j <= Math.min(anchored.length - 1, i + NEAR); j++) {
    if (anchored[j]) return true;
  }
  return false;
}

// --------------------------------------------------------------------------
// The region
// --------------------------------------------------------------------------

/** Highest-scoring run of consecutive lines (Kadane's algorithm). */
export function bestRun(scores) {
  let best = { start: 0, end: -1, total: -Infinity };
  let start = 0;
  let running = 0;
  for (let i = 0; i < scores.length; i++) {
    if (running <= 0) {
      start = i;
      running = scores[i];
    } else {
      running += scores[i];
    }
    if (running > best.total) best = { start, end: i, total: running };
  }
  return best;
}

/**
 * Find the lines that hold the song.
 * Returns { start, end, trimmed } where start/end are inclusive line indices.
 * `trimmed` is false when the whole text was kept.
 */
export function findSongRegion(text) {
  const lines = splitLines(text);
  const kinds = lines.map(classifyLine);
  const scores = scoreLines(lines);
  const whole = { start: 0, end: lines.length - 1, trimmed: false };
  if (!lines.length) return whole;

  const run = bestRun(scores);
  if (run.end < run.start || run.total <= 0) return whole;

  // Pull the edges in past anything that is not itself song content.
  let start = run.start;
  let end = run.end;
  while (start <= end && scores[start] <= 0) start++;
  while (end >= start && scores[end] <= 0) end--;
  if (end < start) return whole;

  // Refuse to trim when it would throw away most of the song.
  const countChords = (from, to) => {
    let n = 0;
    for (let i = from; i <= to; i++) if (kinds[i] === "chord" || kinds[i] === "tab") n++;
    return n;
  };
  const kept = countChords(start, end);
  const total = countChords(0, lines.length - 1);
  if (kept < MIN_KEPT_CHORD_LINES && total >= MIN_KEPT_CHORD_LINES) return whole;
  if (kept * 2 < total) return whole;

  return { start, end, trimmed: start > 0 || end < lines.length - 1 };
}

/**
 * The song, with the surrounding page removed. Returns the text unchanged
 * when there is nothing convincing to cut.
 */
export function trimToSong(text) {
  const lines = splitLines(text);
  const region = findSongRegion(text);
  if (!region.trimmed) return lines.join("\n");
  return lines.slice(region.start, region.end + 1).join("\n");
}
