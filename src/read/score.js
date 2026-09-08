// One staff, read.
//
// Takes a staff found by read/staff.js and the marks left after its lines
// were rubbed out, and works out what is written on it: which string each
// number sits on, which numbers belong together as one fret, and where the
// bar lines fall.
//
// Everything here is measured in staff spacings rather than pixels, so the
// same rules hold for a screenshot of a phone and a print-resolution scan.
//
// Pure ES module: no DOM, no browser APIs.

import { findComponents } from "./glyphs.js";
import { classifyGlyph, isMusicGlyph, isBracketGlyph } from "./digits.js";
import { commonSize, median } from "./staff.js";

/** How far above and below the outer lines a mark may sit and still be part of the staff. */
export const BAND_MARGIN = 0.75;

/** A mark taller than this many spacings is furniture: a clef, a time signature, a bracket. */
export const MAX_GLYPH_HEIGHT = 1.45;

/** ...and one shorter than this is a dot, a speck or the tip of a slur. */
export const MIN_GLYPH_HEIGHT = 0.34;

/**
 * A mark wider than this many times its own height is not a number.
 *
 * Slurs and ties are drawn as long shallow arcs a fraction above the string
 * they join, which is close enough to be read as sitting on it. They are five
 * or ten times as wide as they are tall; no fret number, not even a
 * two-digit one, comes near that.
 */
export const MAX_GLYPH_WIDTH = 2;

/**
 * How much taller than the staff's own fret numbers a mark may be.
 *
 * The one rule that keeps the word written down the front of a tab staff out
 * of the music. Guitar Pro draws those letters about half again as tall as a
 * fret number — close enough that no classifier can be relied on to tell a B
 * from an 8 at that size, and far enough that this can. It takes the bar
 * numbers, the time signature and the little 3 over a triplet with it.
 *
 * An upper bound only. The × of a dead note is drawn smaller than a number on
 * purpose, the way a lower-case letter is smaller than a capital, and it is
 * music.
 */
export const MAX_SIZE_ABOVE_TYPICAL = 1.35;

/** A fret number must sit this close to the middle of its string to count as being on it. */
export const ON_STRING = 0.42;

/** A bar line is no wider than this, and spans at least this much of the staff. */
export const BAR_MAX_WIDTH = 0.3;
export const BAR_MIN_HEIGHT = 0.76;

/** Two numbers this close together, on one string, are one two-digit fret. */
export const DIGIT_JOIN = 0.6;

/** ...and a bracket this close to a number belongs to it. */
export const BRACKET_JOIN = 0.9;

/** The highest fret a two-digit number is allowed to make. Above this it is two notes, not one. */
export const MAX_FRET = 24;

/** Notes whose middles are this close together, in spacings, are played at once. */
export const SAME_COLUMN = 0.45;

/**
 * Read one staff.
 *
 * Returns:
 *   kind        "tab" (numbers on strings) or "notation" (noteheads, which
 *               this reader does not attempt)
 *   strings     how many lines the staff has
 *   events      [{ x, string, fret, glyph, score }], string 0 = top line
 *   bars        x of every bar line
 *   unreadable  marks that sat on a string but could not be made out
 */
export function readSystem(bitmap, system, options = {}) {
  const spacing = system.spacing;
  const lines = system.lines;
  const box = {
    x0: system.x0,
    x1: system.x1,
    y0: lines[0].y - spacing * BAND_MARGIN,
    y1: lines[lines.length - 1].y + spacing * BAND_MARGIN,
  };
  const minArea = Math.max(3, Math.round(spacing * spacing * 0.03));
  const components = findComponents(bitmap, box, { minArea });

  const staffHeight = lines[lines.length - 1].y - lines[0].y;
  const bars = [];
  const candidates = [];
  for (const c of components) {
    if (c.width <= Math.max(3, spacing * BAR_MAX_WIDTH) && c.height >= staffHeight * BAR_MIN_HEIGHT) {
      bars.push(c.cx);
      continue;
    }
    if (c.height > spacing * MAX_GLYPH_HEIGHT) continue;
    if (c.height < spacing * MIN_GLYPH_HEIGHT) continue;
    if (c.width > c.height * MAX_GLYPH_WIDTH) continue;
    const string = nearestString(lines, c.cy, spacing * ON_STRING);
    if (string < 0) continue;
    candidates.push({ component: c, string });
  }

  // How big a fret number is on this staff, taken from the marks that read as
  // numbers rather than from all of them. Reading first and measuring second
  // is what makes this hold: a bar of muted strums is mostly dead notes,
  // which are drawn smaller on purpose, and measuring every mark together
  // would make the two real numbers among them look like the oversized ones
  // and throw them both away.
  const seen = candidates.map((candidate) => ({ ...candidate, read: classifyGlyph(candidate.component, options) }));
  const numbers = seen.filter((item) => item.read.char >= "0" && item.read.char <= "9").map((item) => item.component.height);
  const typical = commonSize(numbers) || median(seen.map((item) => item.component.height)) || spacing;

  const marks = [];
  let unreadable = 0;
  for (const candidate of seen) {
    // Anything drawn appreciably bigger than the numbers is not one.
    if (candidate.component.height > typical * MAX_SIZE_ABOVE_TYPICAL) continue;
    const read = candidate.read;
    // A bracket is neither a note nor a mistake: it says the note beside it
    // is being held over rather than struck again.
    if (isBracketGlyph(read.char)) {
      marks.push({ x0: candidate.component.x0, x1: candidate.component.x1, cx: candidate.component.cx, string: candidate.string, char: read.char, score: read.score });
      continue;
    }
    if (!read.char || !isMusicGlyph(read.char)) {
      // Counted either way. This mark is the size of a fret number and is
      // sitting on a string, so whether the reader made nothing of it or made
      // a letter of it, the honest report is the same: there was something
      // here and it did not become a note. An 8 and a B are the same shape
      // with the corners squared off, and a note quietly dropped as furniture
      // is worse than one the user is told to check.
      unreadable++;
      continue;
    }
    marks.push({
      x0: candidate.component.x0,
      x1: candidate.component.x1,
      cx: candidate.component.cx,
      string: candidate.string,
      char: read.char,
      score: read.score,
    });
  }
  marks.sort((a, b) => a.string - b.string || a.x0 - b.x0);

  const events = joinDigits(marks, typical);
  return {
    kind: staffKind(lines.length, marks.length, candidates.length),
    strings: lines.length,
    spacing,
    top: system.top,
    bottom: system.bottom,
    events,
    columns: columnsOf(events, spacing),
    bars: mergeBars(bars, spacing),
    unreadable,
    marks: marks.length,
  };
}

/**
 * Tablature or notation?
 *
 * Line count answers it almost always: four, six and seven lines are a bass,
 * a guitar and an extended-range guitar. Five is the ambiguous one — a
 * notation staff, or a five-string bass — so there the numbers decide: a tab
 * staff is covered in them and a notation staff has none.
 */
export function staffKind(lineCount, musicMarks, candidateMarks) {
  if (lineCount === 5) {
    const dense = candidateMarks > 0 && musicMarks / candidateMarks >= 0.5 && musicMarks >= 3;
    return dense ? "tab" : "notation";
  }
  if (lineCount >= 4 && lineCount <= 8) return "tab";
  return "notation";
}

function nearestString(lines, y, tolerance) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < lines.length; i++) {
    const distance = Math.abs(lines[i].y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return bestDistance <= tolerance ? best : -1;
}

/** Two bar lines a hair apart are one double bar, and a repeat sign brings its own. */
function mergeBars(xs, spacing) {
  const sorted = xs.slice().sort((a, b) => a - b);
  const out = [];
  for (const x of sorted) {
    if (out.length && x - out[out.length - 1] < spacing * 0.7) continue;
    out.push(x);
  }
  return out;
}

/**
 * "1" then "2" side by side on one string is fret 12, not frets 1 and 2.
 *
 * The join is decided by the gap alone: a two-digit fret is set almost solid,
 * while two separate notes are a beat apart. Anything that would come out
 * above the 24th fret is left as two notes, because no guitar has a 31st.
 */
export function joinDigits(marks, typical) {
  const events = [];
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark.char === ")") continue; // a closing bracket is taken with its opening one
    if (mark.char === "(") {
      const held = bracketed(marks, i, typical);
      if (held) {
        events.push(held.event);
        i = held.last;
        continue;
      }
      continue; // a bracket with nothing in it is not worth reporting
    }
    if (mark.char === "x") {
      events.push({ x: mark.cx, string: mark.string, fret: "x", glyph: "x", score: mark.score });
      continue;
    }
    const joined = number(marks, i, typical);
    events.push(joined.event);
    i = joined.last;
  }
  events.sort((a, b) => a.x - b.x || a.string - b.string);
  return events;
}

/**
 * One fret number starting at `at`: one digit, or two run together.
 *
 * Only 1 and 2 start a two-digit fret: there is no 24th-and-a-bit fret, and
 * nobody writes "04". That rules out most of the ways two ordinary notes
 * played close together could be run into one.
 */
function number(marks, at, typical) {
  const mark = marks[at];
  const next = marks[at + 1];
  const leads = mark.char === "1" || mark.char === "2";
  if (leads && next && next.string === mark.string && /^\d$/.test(next.char) && next.x0 - mark.x1 <= typical * DIGIT_JOIN) {
    const fret = Number(mark.char) * 10 + Number(next.char);
    if (fret <= MAX_FRET) {
      return { last: at + 1, event: { x: (mark.x0 + next.x1) / 2, string: mark.string, fret, glyph: mark.char + next.char, score: Math.min(mark.score, next.score) } };
    }
  }
  return { last: at, event: { x: mark.cx, string: mark.string, fret: Number(mark.char), glyph: mark.char, score: mark.score } };
}

/**
 * "(7)" — a note held over from the bar before rather than struck again.
 *
 * Passed on as a ghost note, which is what the tab parser already makes of a
 * bracketed fret in written tab: the same pitch, played quietly. Returns null
 * unless the brackets really do have a number between them.
 */
function bracketed(marks, at, typical) {
  const open = marks[at];
  const inner = marks[at + 1];
  if (!inner || inner.string !== open.string || !/^[\dx]$/.test(inner.char)) return null;
  if (inner.x0 - open.x1 > typical * BRACKET_JOIN) return null;
  const found = inner.char === "x" ? { last: at + 1, event: { x: inner.cx, string: inner.string, fret: "x", glyph: "x", score: inner.score } } : number(marks, at + 1, typical);
  const close = marks[found.last + 1];
  if (!close || close.char !== ")" || close.string !== open.string) return null;
  if (close.x0 - marks[found.last].x1 > typical * BRACKET_JOIN) return null;
  return { last: found.last + 1, event: { ...found.event, x: (open.x0 + close.x1) / 2, ghost: true } };
}

/**
 * Group notes that are played together.
 *
 * Engraved music is laid out along the page in time order, so two numbers
 * that share an upright line are one chord. The tolerance is generous enough
 * to hold a chord whose two-digit fret sticks out to one side — a 24 is drawn
 * wider than a 4, and its middle does not land in quite the same place.
 *
 * Within a chord the notes come back top string first, which is the order
 * they are written in and the order they are read in. Across chords, the
 * order is the order they are played.
 */
export function columnsOf(events, spacing) {
  const columns = [];
  for (const event of events) {
    const last = columns[columns.length - 1];
    if (last && event.x - last.x <= spacing * SAME_COLUMN) {
      last.events.push(event);
      last.x = (last.x * (last.events.length - 1) + event.x) / last.events.length;
      continue;
    }
    columns.push({ x: event.x, events: [event] });
  }
  for (const column of columns) column.events.sort((a, b) => a.string - b.string);
  return columns;
}
