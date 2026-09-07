// Shape heuristics — the shared, tested functions that decide whether a blob
// of text "looks like guitar tab" or "looks like a chord sheet".
//
// They power both extraction (inside the page, via the generated
// src/extract/injected.js) and the manual paste path (via parse/detect.js).
// parse/chords.js and parse/region.js build on the chord-line rules here so
// that the page and the parser always agree on what a chord line is.
//
// KEEP THIS FILE FREE OF `import`. It is concatenated verbatim into the
// injected page script by tools/build-injected.js, which only strips the
// leading `export ` keywords.

/** Characters that make up the body of a tab line. */
export const TAB_SHAPE_CHARS = "-|0123456789hpb/\\~x";

/** A line must be at least this long to count as a tab line. */
export const TAB_SHAPE_MIN_LINE_LENGTH = 12;

/** ...and contain at least this many tab characters. */
export const TAB_SHAPE_MIN_TAB_CHARS = 8;

/**
 * ...of which at least this many must be dashes. Digits alone are not enough:
 * "146,572 views, added to favorites 5,760 times" clears the tab-character
 * count on digits and commas, and a page's view counter is not a stave.
 */
export const TAB_SHAPE_MIN_DASHES = 3;

/** A text needs at least this many tab lines to "look like tab". */
export const TAB_SHAPE_MIN_LINES = 4;

/**
 * True when a single line is at least 12 characters long and contains at
 * least 8 characters from the tab alphabet (`-|0123456789hpb/\~x`).
 * Lower-case only on purpose: `H`, `P`, `X` are far more common in prose
 * ("Hello", "Paris") than in tab, and real tab is overwhelmingly lower-case.
 */
export function isTabShapedLine(line) {
  if (typeof line !== "string" || line.length < TAB_SHAPE_MIN_LINE_LENGTH) return false;
  let count = 0;
  let dashes = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "-") dashes++;
    if (TAB_SHAPE_CHARS.indexOf(line[i]) !== -1) count++;
  }
  return count >= TAB_SHAPE_MIN_TAB_CHARS && dashes >= TAB_SHAPE_MIN_DASHES;
}

/** Number of tab-shaped lines in a text. Used to rank candidate blocks. */
export function tabLineCount(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const lines = text.split(/\r\n|\r|\n/);
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (isTabShapedLine(lines[i])) count++;
  }
  return count;
}

/** True when the text has at least 4 tab-shaped lines. */
export function looksLikeTab(text) {
  return tabLineCount(text) >= TAB_SHAPE_MIN_LINES;
}

// --------------------------------------------------------------------------
// Chord-sheet shape
// --------------------------------------------------------------------------
//
// Modern chord pages print the chord names above (or, increasingly, on their
// own line before) the words. There are no dashes anywhere, so looksLikeTab
// never fires on them; these rules are what let the toolbar button work on a
// chord page at all.

/** One chord symbol: C, Am, F#m7, Bb, Gsus4, Dmaj7, Cadd9, D/F#, A5, Bdim. */
export const CHORD_TOKEN_RE = /^([A-G])(#|b)?(maj|min|dim|aug|sus|add|m|M|\+|°)?(\d+)?(sus\d?|add\d+)?(?:\/([A-G])(#|b)?)?$/;

/** Tokens allowed on a chord line without being chords: bar lines, repeats. */
export const CHORD_FILLER_RE = /^(\||\|\||-|–|—|\/|x\d+|\(x\d+\)|\d+x|N\.?C\.?|\(N\.?C\.?\)|\.|,)$/i;

/** Section markers: "[Verse 1]", "Chorus:", "Pre-chorus 2", "Intro". */
export const SECTION_RE = /^\s*(?:\[[^\]]+\]|\(?(?:intro|verse|chorus|bridge|outro|pre-?chorus|solo|interlude|refrain|ending|coda|riff|instrumental|break|hook|tag|part)\b[^:\n]{0,24}:?\)?)\s*$/i;

/** A "Word: value" header, a copyright line or a URL. Never song content. */
export const METADATA_LINE_RE = /(^\s*[A-Za-z][\w '-]{0,24}\s*:)|©|\bhttps?:\/\/|\bwww\./;

export function isSectionLine(line) {
  return typeof line === "string" && SECTION_RE.test(line);
}

export function isMetadataLine(line) {
  return typeof line === "string" && METADATA_LINE_RE.test(line);
}

/**
 * True when every token on the line is a chord symbol or filler, and at least
 * one is a chord. Metadata lines are excluded so "Tuning: E A D G B E" is not
 * mistaken for six chords.
 */
export function isChordOnlyLine(line) {
  if (typeof line !== "string") return false;
  const text = line.trim();
  if (!text || isSectionLine(text) || isMetadataLine(text)) return false;
  const tokens = text.split(/\s+/);
  if (!tokens.length || tokens.length > 16) return false;
  let chords = 0;
  for (const token of tokens) {
    if (CHORD_TOKEN_RE.test(token)) chords++;
    else if (!CHORD_FILLER_RE.test(token)) return false;
  }
  return chords > 0;
}

/**
 * True when a line reads as words a person would sing or say: at least two
 * words, some lower-case, and not a chord line, section marker or header.
 */
export function isLyricLine(line) {
  if (typeof line !== "string") return false;
  const text = line.trim();
  if (text.length < 6 || !/[a-z]/.test(text)) return false;
  if (isSectionLine(text) || isMetadataLine(text) || isChordOnlyLine(text)) return false;
  if (isTabShapedLine(text)) return false;
  // More digits than letters means a count or a stat ("146,572 views",
  // "4.8 (44.9K)", "2017 Pop"), which is page furniture, not something sung.
  const digits = (text.match(/\d/g) || []).length;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  if (letters <= digits) return false;
  if (text.split(/\s+/).length >= 2) return true;
  // A lone word is a lyric when it is lower case ("tonight", "away"), which
  // is how a sung line continues. Navigation is Capitalised ("Tabs", "Tools",
  // "Strumming"), so this keeps one-word lyrics without swallowing the menu.
  return /^[a-z][a-z'’-]{3,}$/.test(text);
}

/** A chord sheet needs at least this many chord lines to be worth believing. */
export const CHORD_SHEET_MIN_CHORD_LINES = 3;

/**
 * True when the text looks like a chord sheet: several chord lines, and at
 * least two of them sitting next to words or a section marker.
 *
 * The adjacency test is what keeps a page's chord-diagram legend or its A-Z
 * artist index (both of which are nothing but chord-shaped lines) from
 * reading as a song.
 */
export function looksLikeChordSheet(text) {
  if (typeof text !== "string" || !text) return false;
  const lines = text.split(/\r\n|\r|\n/);
  let chordLines = 0;
  let supported = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!isChordOnlyLine(lines[i])) continue;
    chordLines++;
    for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 3); j++) {
      if (j !== i && (isLyricLine(lines[j]) || isSectionLine(lines[j]))) {
        supported++;
        break;
      }
    }
  }
  return chordLines >= CHORD_SHEET_MIN_CHORD_LINES && supported >= 2;
}

/** Either shape: what the extractor accepts as "a song is on this page". */
export function looksLikeSong(text) {
  return looksLikeTab(text) || looksLikeChordSheet(text);
}
