// ASCII tab parser: text -> notes with beat positions.
//
// This is the hard part of the whole project. Plain-text tab has no rhythm,
// so everything about timing in here is a documented guess. Read the
// "MUSICAL DECISION" comments to see (and tune) each guess.
//
// Pure ES module: no DOM, no browser APIs, no imports outside parse/.

import { splitLines } from "./text.js";
import { resolveTuning } from "./tuning.js";

// --------------------------------------------------------------------------
// Tunable musical constants
// --------------------------------------------------------------------------

/**
 * The "timing step": how long one gap between neighbouring notes lasts.
 * Tabbers usually space notes evenly, so the most common gap in a tab is
 * taken to mean one step. "1/8" (an eighth note) suits most strummed and
 * riff-style tabs; "1/16" suits fast solos; "1/4" suits slow, sparse tabs.
 */
export const STEP_BEATS = { "1/4": 1, "1/8": 0.5, "1/16": 0.25 };
export const DEFAULT_STEP = "1/8";

/**
 * MUSICAL DECISION: a plucked string rings until the same string is played
 * again, so note length is "time until the next note on that string", capped
 * at one bar so a string that is played once does not drone for a minute.
 */
export const MAX_SUSTAIN_BARS = 1;

/** MUSICAL DECISION: default loudness of a picked note (0..1). */
export const VELOCITY_NORMAL = 0.8;
/** Hammer-ons / pull-offs land softer than a picked note. */
export const VELOCITY_LEGATO = 0.65;
/** Ghost notes "(5)" are played quietly on purpose. */
export const VELOCITY_GHOST = 0.5;
/** Muted "x" notes are a percussive click rather than a pitch. */
export const VELOCITY_MUTE = 0.3;

/** Frets above this are treated as two separate single-digit notes ("25" -> 2, 5). */
export const MAX_FRET = 24;

/**
 * MUSICAL DECISION: the gap between two neighbouring notes, measured in
 * units (the tab's usual spacing), is rounded to a whole number of steps.
 * A squeezed gap shorter than this fraction of a unit ("5h7" in a tab that
 * normally leaves three columns) becomes half a step instead — a quick
 * hammer-on rather than a full eighth note.
 */
export const HALF_STEP_BELOW_UNITS = 0.6;

/** With no note gaps to measure, assume this many columns per step. */
export const DEFAULT_UNIT = 3;

// --------------------------------------------------------------------------
// Line classification
// --------------------------------------------------------------------------

/** Characters allowed in the body of a tab string line. */
const BODY_CHARS = new Set("-0123456789hHpPbBrRsStTvVxX/\\~^()[]<>*.,'`|:=_ ");

/**
 * Split one line of text into label / separator / body.
 * Returns null unless the line is a plausible tab string line.
 *
 * Accepts shapes like:
 *   e|--0--2--|      E |---3---     D#|-5-      1|--7--      |--5--7--
 *   ----0----2----   (no label at all, lines aligned by indentation)
 * and tolerates a trailing annotation ("let ring", "x2") after the tab body.
 */
export function classifyLine(line) {
  if (typeof line !== "string") return null;
  const m = /^(\s*)(?:([A-Ga-g][#b]?|[1-8])(?=\s*[|:\-]))?(\s*)([|:]{1,2})?/.exec(line);
  const label = m[2] || null;
  const sep = m[4] || null;
  const bodyStart = m[0].length;
  const rest = line.slice(bodyStart);

  // Body = longest prefix made of tab characters. Anything after is an annotation.
  let end = 0;
  while (end < rest.length && BODY_CHARS.has(rest[end])) end++;
  let body = rest.slice(0, end);
  const annotation = rest.slice(end).trim();
  body = body.replace(/\s+$/, "");

  const dashes = (body.match(/-/g) || []).length;
  const digits = (body.match(/\d/g) || []).length;
  const pipes = (body.match(/\|/g) || []).length;
  if (body.length < 4 || dashes < 3) return null;
  // A short bare dash run ("----") is punctuation, not a string.
  if (!label && !sep && body.length < 6) return null;
  if ((dashes + digits + pipes) / body.length < 0.5) return null;
  // A short dash run followed by prose ("B--- baby") is not tab.
  if (annotation && body.length < 8 && digits === 0 && pipes === 0) return null;
  // Real tab keeps a comfortable share of dashes; "5h5h5h5h5" is not a string line.
  if (!label && !sep && dashes / body.length < 0.3) return null;

  return { label, sep, body, bodyStart, annotation, raw: line };
}

/** A line of nothing but dashes is a visual separator when it sits at the edge of a stave. */
function isBareDashes(item) {
  return !item.label && /^[-\s]+$/.test(item.body);
}

// --------------------------------------------------------------------------
// Stave grouping
// --------------------------------------------------------------------------

/** Preferred stave sizes when a block of lines has to be split. */
const STAVE_SIZES = [6, 4, 7, 8, 5, 3];

/**
 * Group the string lines of a text into staves.
 * Consecutive string lines form a block; a blank line, a lyric, a chord name
 * or a repeated header ends it. Blocks bigger than 8 lines are split into
 * staves using the string labels (they repeat once per stave) or, without
 * labels, into equal chunks.
 *
 * Returns [{ lines: [classified], firstLine, lastLine }].
 */
export function findStaves(lines) {
  const classified = lines.map((l) => classifyLine(l));
  const blocks = [];
  let current = null;
  classified.forEach((item, idx) => {
    if (item) {
      if (!current) current = { start: idx, items: [] };
      current.items.push(item);
    } else if (current) {
      blocks.push(current);
      current = null;
    }
  });
  if (current) blocks.push(current);

  const staves = [];
  for (const block of blocks) {
    let items = block.items;
    let start = block.start;

    // Trim separator lines ("--------") glued to the top or bottom of a stave.
    const hasStructure = items.filter((i) => i.label || i.sep).length * 2 >= items.length;
    if (hasStructure) {
      while (items.length > 3 && isBareDashes(items[0])) {
        items = items.slice(1);
        start++;
      }
      while (items.length > 3 && isBareDashes(items[items.length - 1])) items = items.slice(0, -1);
    }
    if (items.length < 3) continue;

    for (const chunk of splitBlock(items)) {
      if (chunk.length < 3) continue;
      staves.push({ lines: chunk, firstLine: start, lastLine: start + chunk.length - 1 });
      start += chunk.length;
    }
  }
  return staves;
}

function splitBlock(items) {
  if (items.length <= 8) return [items];
  const labels = items.map((i) => i.label);
  const labelled = labels.filter(Boolean).length * 2 >= items.length;
  for (const size of STAVE_SIZES) {
    if (items.length % size !== 0) continue;
    if (labelled) {
      const periodic = labels.every((l, i) => l === labels[i % size]);
      if (!periodic) continue;
    }
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }
  // No clean division: peel off 6-line staves and keep whatever is left.
  const out = [];
  for (let i = 0; i < items.length; i += 6) out.push(items.slice(i, i + 6));
  return out;
}

// --------------------------------------------------------------------------
// Reading one string line
// --------------------------------------------------------------------------

/**
 * Split a run of digits into fret numbers. "12" is one note; "120" is 12
 * then 0; "333" is three 3s. Two-digit frets start with 1 or 2 and stay
 * within MAX_FRET. The first digit's column is the note position.
 */
export function splitDigitRun(run) {
  const out = [];
  let i = 0;
  while (i < run.length) {
    if (i + 1 < run.length && (run[i] === "1" || run[i] === "2")) {
      const two = parseInt(run.slice(i, i + 2), 10);
      if (two <= MAX_FRET) {
        out.push({ offset: i, fret: two });
        i += 2;
        continue;
      }
    }
    out.push({ offset: i, fret: parseInt(run[i], 10) });
    i += 1;
  }
  return out;
}

/**
 * Scan the body of a string line. Returns
 *   { events: [{ col, fret, technique, velocity }], barCols: [col, ...] }
 * where `col` is the column of the fret's first digit.
 *
 * Techniques (h p / \ b r ~ x () <> []) become plain notes with the technique
 * recorded on the note; nothing here changes pitch or attempts pitch bend.
 */
export function scanLine(body) {
  const events = [];
  const barCols = [];
  let pending = null; // technique waiting for the next number
  let ghostDepth = 0;
  let harmonicDepth = 0;
  let i = 0;
  const last = () => events[events.length - 1] || null;

  while (i < body.length) {
    const ch = body[i];
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < body.length && body[j] >= "0" && body[j] <= "9") j++;
      const run = body.slice(i, j);
      for (const { offset, fret } of splitDigitRun(run)) {
        let technique = pending;
        let velocity = VELOCITY_NORMAL;
        if (technique === "hammer" || technique === "pull") velocity = VELOCITY_LEGATO;
        if (technique === "bend-target" || technique === "release") velocity = VELOCITY_LEGATO;
        if (ghostDepth > 0) {
          technique = technique ? "ghost+" + technique : "ghost";
          velocity = VELOCITY_GHOST;
        }
        if (harmonicDepth > 0) {
          technique = technique ? "harmonic+" + technique : "harmonic";
        }
        events.push({ col: i + offset, fret, technique, velocity });
        pending = null;
      }
      i = j;
      continue;
    }
    switch (ch) {
      case "h":
      case "H":
        pending = "hammer";
        break;
      case "p":
      case "P":
        pending = "pull";
        break;
      case "/":
      case "\\":
      case "s":
      case "S":
        pending = "slide";
        break;
      case "t":
      case "T":
        pending = "tap";
        break;
      case "b":
      case "B": {
        // "5b7": the 5 is bent, the 7 is where the bend arrives.
        const l = last();
        if (l && !l.technique) l.technique = "bend";
        pending = "bend-target";
        break;
      }
      case "r":
      case "R":
        pending = "release";
        break;
      case "~":
      case "v":
      case "V": {
        const l = last();
        if (l && !l.technique) l.technique = "vibrato";
        break;
      }
      case "x":
      case "X": {
        // Only count as a muted note when it sits inside the tab body
        // (next to a dash or digit), not in an "x2" repeat annotation.
        const prev = body[i - 1] || "";
        const next = body[i + 1] || "";
        const inside = /[-\d]/.test(prev) || /[-]/.test(next);
        if (inside) events.push({ col: i, fret: 0, technique: "mute", velocity: VELOCITY_MUTE });
        // "x2", "x3": a repeat marker, so skip the digits that follow.
        if (!/[-\d]/.test(prev) && /\d/.test(next)) {
          let j = i + 1;
          while (j < body.length && body[j] >= "0" && body[j] <= "9") j++;
          i = j;
          continue;
        }
        break;
      }
      case "(":
        ghostDepth++;
        break;
      case ")":
        ghostDepth = Math.max(0, ghostDepth - 1);
        break;
      case "<":
      case "[":
        harmonicDepth++;
        break;
      case ">":
      case "]":
        harmonicDepth = Math.max(0, harmonicDepth - 1);
        break;
      case "|":
        barCols.push(i);
        break;
      default:
        break;
    }
    i++;
  }
  return { events, barCols };
}

// --------------------------------------------------------------------------
// Timing
// --------------------------------------------------------------------------

/**
 * The most common gap (in columns) between neighbouring notes across the
 * whole tab. That gap is treated as one timing step. Ties go to the smaller
 * gap; with nothing to go on we assume two columns per step, the most common
 * spacing on the web.
 */
export function estimateUnit(gapCounts) {
  let best = null;
  for (const [gap, count] of gapCounts) {
    if (best === null || count > best.count || (count === best.count && gap < best.gap)) best = { gap, count };
  }
  return best ? Math.max(1, best.gap) : DEFAULT_UNIT;
}

/**
 * How many steps a gap of `gap` columns lasts when `unit` columns make one
 * step. Whole steps, except that a clearly squeezed gap is half a step.
 */
export function stepsForGap(gap, unit) {
  const units = gap / unit;
  if (units < HALF_STEP_BELOW_UNITS) return 0.5;
  return Math.max(1, Math.round(units));
}

function quantize(t, grid) {
  return Math.round(t / grid) * grid;
}

/**
 * Lay out one stave in time. Returns { notes, length } where notes carry a
 * `beat` relative to the stave start and `length` is the stave's duration in
 * beats.
 *
 * MUSICAL DECISION — how columns become beats:
 *  1. Bar lines ("|") that line up across the stave split it into segments.
 *     Each segment is snapped to a whole number of bars so the DAW grid and
 *     the tab's bars agree.
 *  2. Inside a segment, the gap between one note column and the next is
 *     rounded to whole timing steps (see stepsForGap), so evenly spaced
 *     notes come out as a clean run of eighths even when the tabber's
 *     spacing wobbles by a column. Padding shorter than one unit before the
 *     first note is ignored; longer padding becomes a rest.
 *  3. Squeezed pairs like "5h7" get half a step for the first note, so a
 *     hammer-on reads as a quick note into a longer one.
 */
export function layoutStave(stave, { unit, stepBeats, beatsPerBar }) {
  const grid = stepBeats / 2;
  const lineCount = stave.lines.length;
  const scanned = stave.lines.map((l) => scanLine(l.body));
  const width = Math.max(...stave.lines.map((l) => l.body.length));

  // Bar columns shared by at least half of the lines.
  const barCount = new Map();
  for (const s of scanned) for (const c of s.barCols) barCount.set(c, (barCount.get(c) || 0) + 1);
  const barCols = [...barCount.entries()]
    .filter(([, n]) => n * 2 >= lineCount)
    .map(([c]) => c)
    .sort((a, b) => a - b);

  // Per-line events, dropping annotations that trail the final bar line ("|x2").
  const barColSet = new Set(barCols);
  const events = [];
  scanned.forEach((s, lineIdx) => {
    const lastBar = barCols.length ? barCols[barCols.length - 1] : -1;
    const tail = lastBar >= 0 ? stave.lines[lineIdx].body.slice(lastBar + 1) : "";
    const tailIsAnnotation = lastBar >= 0 && !/-/.test(tail);
    for (const e of s.events) {
      if (tailIsAnnotation && e.col > lastBar) continue;
      if (barColSet.has(e.col)) continue; // a digit sitting on a bar column is noise
      events.push({ ...e, line: lineIdx });
    }
  });

  // Segments between bar lines.
  const bounds = [0, ...barCols, width];
  const segments = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    const segStart = i === 0 ? 0 : bounds[i] + 1;
    const segEnd = bounds[i + 1];
    if (segEnd <= segStart) continue;
    const inSeg = events.filter((e) => e.col >= segStart && e.col < segEnd);
    const leadingOrTrailing = i === 0 || i + 2 === bounds.length;
    if (!inSeg.length && leadingOrTrailing && barCols.length) continue;
    segments.push({ segStart, segEnd, events: inSeg });
  }

  const notes = [];
  let cursor = 0;
  for (const seg of segments) {
    let widthBeats = ((seg.segEnd - seg.segStart) / unit) * stepBeats;
    let maxT = 0;
    if (seg.events.length) {
      // Column -> beat, one distinct column at a time.
      const cols = [...new Set(seg.events.map((e) => e.col))].sort((a, b) => a - b);
      const beatAt = new Map();
      let t = Math.floor((cols[0] - seg.segStart) / unit) * stepBeats;
      beatAt.set(cols[0], t);
      for (let i = 1; i < cols.length; i++) {
        t += stepsForGap(cols[i] - cols[i - 1], unit) * stepBeats;
        beatAt.set(cols[i], t);
      }
      const lastCol = cols[cols.length - 1];
      maxT = t;
      widthBeats = t + stepsForGap(Math.max(1, seg.segEnd - lastCol), unit) * stepBeats;
      for (const e of seg.events) notes.push({ ...e, beat: cursor + quantize(beatAt.get(e.col), grid) });
    }
    let bars = Math.max(1, Math.round(widthBeats / beatsPerBar));
    // A note that would land past the end of the bar pushes the segment out
    // to the next whole bar rather than being squeezed.
    if (seg.events.length && maxT >= bars * beatsPerBar) bars = Math.ceil((maxT + grid) / beatsPerBar);
    cursor += bars * beatsPerBar;
  }
  return { notes, length: cursor, barCols, unit };
}

/** Gaps between neighbouring note columns inside each bar of a stave. */
function collectGaps(stave, gapCounts) {
  const scanned = stave.lines.map((l) => scanLine(l.body));
  const lineCount = stave.lines.length;
  const barCount = new Map();
  for (const s of scanned) for (const c of s.barCols) barCount.set(c, (barCount.get(c) || 0) + 1);
  const barCols = new Set([...barCount.entries()].filter(([, n]) => n * 2 >= lineCount).map(([c]) => c));
  const cols = [...new Set(scanned.flatMap((s) => s.events.map((e) => e.col)))].sort((a, b) => a - b);
  for (let i = 1; i < cols.length; i++) {
    let crossesBar = false;
    for (let c = cols[i - 1] + 1; c < cols[i]; c++) if (barCols.has(c)) crossesBar = true;
    if (crossesBar) continue;
    const gap = cols[i] - cols[i - 1];
    gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
  }
}

// --------------------------------------------------------------------------
// Putting it together
// --------------------------------------------------------------------------

/**
 * Parse ASCII tab text into notes.
 *
 * options:
 *   step          "1/4" | "1/8" | "1/16"  (default "1/8")
 *   tuning        override notes low-to-high, or null
 *   headerTuning  result of meta.findTuningHeader, or null
 *   capo          capo fret, default 0
 *   timeSignature [num, den], default [4, 4]
 *
 * Returns { notes, tuning, tuningId, staveCount, stringCount, unit }.
 * Notes: { midi, start, length, velocity, technique, string, fret }, sorted
 * by start. `string` is 1 for the highest string.
 */
export function parseTab(text, options = {}) {
  const lines = splitLines(text);
  const step = STEP_BEATS[options.step] ? options.step : DEFAULT_STEP;
  const stepBeats = STEP_BEATS[step];
  const timeSignature = options.timeSignature || [4, 4];
  const beatsPerBar = timeSignature[0] * (4 / timeSignature[1]);
  const capo = options.capo || 0;

  const staves = findStaves(lines);
  if (!staves.length) {
    return { notes: [], tuning: null, tuningId: null, staveCount: 0, stringCount: 0, unit: null, timeSignature };
  }

  const gapCounts = new Map();
  for (const stave of staves) collectGaps(stave, gapCounts);
  const unit = estimateUnit(gapCounts);

  const rawNotes = [];
  let cursor = 0;
  let firstTuning = null;
  let firstTuningId = null;
  let stringCount = 0;
  for (const stave of staves) {
    const count = stave.lines.length;
    const labels = stave.lines.map((l) => l.label);
    const labelled = labels.filter(Boolean).length * 2 >= count ? labels.map((l) => l || "") : null;
    const tuning = resolveTuning({
      header: options.headerTuning || null,
      labels: labelled && labelled.every(Boolean) ? labelled : null,
      count,
      capo,
      override: options.tuning || null,
    });
    if (!firstTuning) {
      firstTuning = tuning.notes;
      firstTuningId = tuning.id;
      stringCount = count;
    }
    const layout = layoutStave(stave, { unit, stepBeats, beatsPerBar });
    for (const n of layout.notes) {
      // Line 0 is the top line. Normally that is the highest string; when the
      // labels say the stave is written low-string-on-top, flip it.
      const lowToHigh = tuning.reversed ? n.line : count - 1 - n.line;
      const open = tuning.notes[lowToHigh];
      if (open === undefined) continue;
      rawNotes.push({
        midi: open + n.fret,
        start: cursor + n.beat,
        velocity: n.velocity,
        technique: n.technique,
        string: count - lowToHigh,
        fret: n.fret,
      });
    }
    cursor += layout.length;
  }

  const notes = assignLengths(rawNotes, { grid: stepBeats / 2, maxSustain: MAX_SUSTAIN_BARS * beatsPerBar });
  return { notes, tuning: firstTuning, tuningId: firstTuningId, staveCount: staves.length, stringCount, unit, timeSignature, totalBeats: cursor };
}

/**
 * Give every note a length: until the next note on the same string, capped.
 * Two notes that quantised onto the same string and beat are nudged apart by
 * one grid step when possible, otherwise the second is dropped.
 */
function assignLengths(rawNotes, { grid, maxSustain }) {
  const byString = new Map();
  for (const n of rawNotes) {
    if (!byString.has(n.string)) byString.set(n.string, []);
    byString.get(n.string).push(n);
  }
  const out = [];
  for (const list of byString.values()) {
    list.sort((a, b) => a.start - b.start);
    const kept = [];
    for (const n of list) {
      const prev = kept[kept.length - 1];
      if (prev && Math.abs(prev.start - n.start) < 1e-9) {
        n.start = prev.start + grid;
      }
      if (prev && n.start < prev.start) continue;
      kept.push(n);
    }
    for (let i = 0; i < kept.length; i++) {
      const n = kept[i];
      const next = kept[i + 1];
      let length = next ? next.start - n.start : maxSustain;
      length = Math.min(length, maxSustain);
      if (n.technique === "mute") length = grid;
      if (length < grid) length = grid;
      out.push({ midi: n.midi, start: round3(n.start), length: round3(length), velocity: n.velocity, technique: n.technique, string: n.string, fret: n.fret });
    }
  }
  out.sort((a, b) => a.start - b.start || b.midi - a.midi);
  return out;
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
