// Tab-shape heuristic — the one shared, tested function that decides whether a
// blob of text "looks like guitar tab".
//
// It powers both extraction (inside the page, via the generated
// src/extract/injected.js) and the manual paste path (via parse/detect.js).
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
  for (let i = 0; i < line.length; i++) {
    if (TAB_SHAPE_CHARS.indexOf(line[i]) !== -1) {
      count++;
      if (count >= TAB_SHAPE_MIN_TAB_CHARS) return true;
    }
  }
  return false;
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
