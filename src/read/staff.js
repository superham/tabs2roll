// Finding the staves.
//
// Every engraved score, tablature or notation, is built on long horizontal
// lines of even spacing. Finding them first is what makes the rest of the
// reader possible: the lines say where the music is, how big it is drawn,
// and — for tablature — which string every number sits on.
//
// Pure ES module: no DOM, no browser APIs.

/**
 * A row is a candidate staff line when its longest run is this share of the
 * longest in the picture.
 *
 * Deliberately low. A screenshot is full of long horizontal strokes that have
 * nothing to do with music — a page header, a table rule, the underline of a
 * heading — and any of them can be longer than the staff. Judging the staff
 * against the longest thing on the page throws it away whenever the page
 * happens to contain something wider. The share is here only to drop the
 * obviously short; what decides is whether four or more candidates turn out
 * to be evenly spaced, which nothing but a staff ever is.
 */
export const MIN_RUN_SHARE = 0.25;

/** A line must be at least this long, or this share of the picture, to count at all. */
export const MIN_RUN_PIXELS = 24;
export const MIN_RUN_WIDTH_SHARE = 0.08;

/**
 * A staff line is a hairline. Anything much thicker is a filled block — a
 * navigation bar, a highlighted row, the played-bar marker a tab player draws
 * — and reading one as a line puts a phantom string through the staff.
 * Judged against the picture, because the score's own scale is not known yet.
 */
export const MAX_LINE_THICKNESS = 6;
export const MAX_LINE_THICKNESS_SHARE = 0.02;

/** Lines belong to the same staff when their spacings agree to within this fraction. */
export const SPACING_TOLERANCE = 0.3;

/** ...and the gap to the next line is no more than this many times the staff's own spacing. */
export const MAX_GAP_RATIO = 1.7;

/**
 * How much longer or shorter than its neighbours a line of one staff may be.
 *
 * The lines of a staff are drawn to the same length as each other, always.
 * Nothing else on the page is: the flat top of a slur, an underline, a page
 * rule. Without this, two slurs arching over the same bar at the same height
 * read as one more line above the staff — and a six-string staff that comes
 * back as a seven-string one puts every note on the wrong string, quietly.
 */
export const RUN_RATIO = [0.55, 1.6];

/**
 * How wide a hole in a line may be before it counts as two lines.
 *
 * A first guess only. The hole an engraver leaves behind a fret number is
 * about one and a half string spacings wide, so the right allowance depends
 * on how big the staff is drawn — which is not known until the staff has been
 * found. `findStaves` measures roughly with this, then measures again.
 */
export const DEFAULT_GAP_ALLOWANCE = 9;

/** Multiples of the first guess to try. The one that finds the most staff wins. */
export const GAP_LADDER = [1, 2, 4, 8, 16];

/**
 * At least this much of a candidate line has to be actual ink.
 *
 * The one test that stops the bridging above from believing anything. A
 * string line with the numbers rubbed out of it is still mostly line. A row
 * running through the middles of eight fret numbers, bridged end to end, is
 * mostly nothing — and without this it looks exactly like a staff line, at
 * exactly the spacing of one, because the numbers sit on the strings.
 */
export const MIN_COVERAGE = 0.45;

/** Staff sizes we know what to do with: bass tab, notation, guitar tab, extended-range tab. */
export const KNOWN_STAFF_SIZES = [4, 5, 6, 7, 8];

/**
 * The longest unbroken run of ink on each row.
 *
 * A run, not a count: a row of a busy score can have plenty of ink in it
 * without being a line at all (a row through the middle of a bar of chords
 * is mostly ink), while a staff line is one continuous stroke from the left
 * of the staff to the right.
 *
 * Small gaps are tolerated, and generously. Engravers rub the staff line out
 * behind every fret number, so a tab staff line is really a dotted line with
 * a ten-pixel hole under each note; measured strictly it would never look
 * like one long stroke at all. `gapAllowance` bridges those holes.
 */
export function rowRuns(bitmap, gapAllowance = DEFAULT_GAP_ALLOWANCE) {
  const { width, height, ink } = bitmap;
  const longest = new Int32Array(height);
  const starts = new Int32Array(height);
  const ends = new Int32Array(height);
  const inked = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let best = 0;
    let bestStart = 0;
    let bestEnd = 0;
    let bestInk = 0;
    let run = 0;
    let runInk = 0;
    let runStart = 0;
    let gap = 0;
    for (let x = 0; x < width; x++) {
      if (ink[row + x]) {
        if (run === 0) runStart = x;
        run += gap + 1;
        runInk++;
        gap = 0;
        if (run > best) {
          best = run;
          bestStart = runStart;
          bestEnd = x;
          bestInk = runInk;
        }
      } else if (run > 0) {
        gap++;
        if (gap > gapAllowance) {
          run = 0;
          runInk = 0;
          gap = 0;
        }
      }
    }
    longest[y] = best;
    starts[y] = bestStart;
    ends[y] = bestEnd;
    inked[y] = bestInk;
  }
  return { longest, starts, ends, inked };
}

/**
 * Every horizontal line in the picture, thick ones merged into one.
 *
 * Returns [{ y, top, bottom, thickness, x0, x1, run }], top to bottom.
 */
export function findStaffLines(bitmap, options = {}) {
  const { width, height } = bitmap;
  const runs = rowRuns(bitmap, options.gapAllowance);
  const coverage = options.coverage === undefined ? MIN_COVERAGE : options.coverage;
  const isLine = (y) => runs.longest[y] >= minRun && runs.inked[y] >= runs.longest[y] * coverage;
  let widest = 0;
  for (let y = 0; y < height; y++) {
    if (runs.longest[y] > widest && runs.inked[y] >= runs.longest[y] * coverage) widest = runs.longest[y];
  }
  const floor = options.minRun || Math.max(MIN_RUN_PIXELS, Math.round(width * MIN_RUN_WIDTH_SHARE));
  const minRun = Math.max(floor, widest * (options.runShare || MIN_RUN_SHARE));
  const maxThickness = options.maxThickness || Math.max(MAX_LINE_THICKNESS, Math.round(height * MAX_LINE_THICKNESS_SHARE));
  if (widest < floor) return [];

  const lines = [];
  let y = 0;
  while (y < height) {
    if (!isLine(y)) {
      y++;
      continue;
    }
    // A drawn line is one to three rows thick. Take the whole band and call
    // its middle the line, weighted so a line that fades on one side does not
    // pull the centre with it.
    let end = y;
    while (end + 1 < height && isLine(end + 1)) end++;
    let weight = 0;
    let moment = 0;
    let x0 = Infinity;
    let x1 = -Infinity;
    let run = 0;
    for (let r = y; r <= end; r++) {
      weight += runs.longest[r];
      moment += runs.longest[r] * r;
      if (runs.starts[r] < x0) x0 = runs.starts[r];
      if (runs.ends[r] > x1) x1 = runs.ends[r];
      if (runs.longest[r] > run) run = runs.longest[r];
    }
    if (end - y + 1 <= maxThickness) lines.push({ y: moment / weight, top: y, bottom: end, thickness: end - y + 1, x0, x1, run });
    y = end + 1;
  }
  return lines;
}

/** The middle value of a list. Used for spacings, where one odd line must not move the answer. */
export function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The size most of a list agrees on.
 *
 * Not the median, which one odd group can drag across, and not the mean.
 * Every fret number in a score is set at one size, so the size that the most
 * marks cluster around IS the size of a fret number — however many clef
 * letters, time signatures and bar numbers are mixed in with them, and
 * whether they are bigger or smaller. `tolerance` is the fraction either way
 * that still counts as the same size.
 */
export function commonSize(values, tolerance = 0.2) {
  if (!values.length) return 0;
  let best = values[0];
  let bestSupport = -1;
  for (const value of values) {
    if (!(value > 0)) continue;
    let support = 0;
    let total = 0;
    for (const other of values) {
      if (Math.abs(other - value) <= value * tolerance) {
        support++;
        total += other;
      }
    }
    if (support > bestSupport) {
      bestSupport = support;
      best = total / support;
    }
  }
  return best;
}

/**
 * Gather lines into staves.
 *
 * A staff is a run of lines at one even spacing. Two things end it: a gap
 * bigger than the staff's own spacing (the space between two staves is always
 * wider than the space inside one) and a change of spacing (a five-line
 * notation staff drawn above a six-line tab staff is drawn tighter).
 */
export function groupSystems(lines, options = {}) {
  const tolerance = options.tolerance || SPACING_TOLERANCE;
  const maxGap = options.maxGapRatio || MAX_GAP_RATIO;
  const systems = [];
  let group = [];
  let spacing = 0;

  const flush = () => {
    if (group.length >= 4) systems.push(makeSystem(group));
    group = [];
    spacing = 0;
  };

  /** True when this line is drawn to much the same length as the group's. */
  const sameLength = (line) => {
    const runs = median(group.map((l) => l.run)) || line.run;
    return line.run >= runs * RUN_RATIO[0] && line.run <= runs * RUN_RATIO[1];
  };

  for (let i = 0; i < lines.length; i++) {
    if (!group.length) {
      group = [lines[i]];
      continue;
    }
    const gap = lines[i].y - group[group.length - 1].y;
    if (group.length === 1) {
      // Two lines do not yet make a spacing. Accept the second one unless it
      // is implausibly far away, and let the third decide.
      if (gap > 0 && gap < (options.maxSpacing || 200) && sameLength(lines[i])) {
        group.push(lines[i]);
        spacing = gap;
      } else {
        group = [lines[i]];
      }
      continue;
    }
    const agrees = Math.abs(gap - spacing) <= spacing * tolerance && sameLength(lines[i]);
    if (agrees && gap <= spacing * maxGap) {
      group.push(lines[i]);
      spacing = median(gapsOf(group));
      continue;
    }
    // The group ends here. If it was never big enough to be a staff, it was
    // most likely a stray line — a page rule above the score, say — that the
    // first real staff line then joined at a nonsense spacing. Start the next
    // group from that line rather than losing it: without this, one horizontal
    // rule above a tab staff costs the top string and every note on it.
    const wasStaff = group.length >= 4;
    const previous = group[group.length - 1];
    flush();
    if (wasStaff) {
      group = [lines[i]];
    } else {
      group = [previous, lines[i]];
      spacing = gap;
    }
  }
  flush();

  // A staff of more than eight lines is two staves the spacing test could not
  // separate — a tab staff under a notation staff of the same size. Split it
  // at its widest gap, which is the space between the two.
  const out = [];
  for (const system of systems) {
    if (system.lines.length <= 8) {
      out.push(system);
      continue;
    }
    for (const part of splitAtWidestGap(system.lines)) {
      if (part.length >= 4) out.push(makeSystem(part));
    }
  }
  return out;
}

function gapsOf(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) gaps.push(lines[i].y - lines[i - 1].y);
  return gaps;
}

function makeSystem(lines) {
  const spacing = median(gapsOf(lines));
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const line of lines) {
    if (line.x0 < x0) x0 = line.x0;
    if (line.x1 > x1) x1 = line.x1;
  }
  return {
    lines,
    count: lines.length,
    spacing,
    x0,
    x1,
    top: lines[0].y,
    bottom: lines[lines.length - 1].y,
  };
}

function splitAtWidestGap(lines) {
  const gaps = gapsOf(lines);
  let at = 0;
  for (let i = 1; i < gaps.length; i++) if (gaps[i] > gaps[at]) at = i;
  return [lines.slice(0, at + 1), lines.slice(at + 1)];
}

/**
 * Find the staves, without being told how big they are drawn.
 *
 * Reading a staff line means bridging the holes rubbed out behind the fret
 * numbers, and how wide those are depends on the size of the score: on a
 * phone screenshot they are six pixels across, on a print-resolution page
 * sixty. A bar packed with two-digit frets has more hole in its top line than
 * line, so getting this wrong does not blur the answer — it loses the string
 * altogether, and every note on it.
 *
 * Since there is no way to know the size before finding the staff, every
 * allowance on the ladder is tried and the one that finds the most staff
 * wins. Each pass is one sweep of the picture, and a tie goes to the smallest
 * allowance, which is the least willing to believe in a line.
 */
export function findStaves(bitmap, options = {}) {
  const base = options.gapAllowance || DEFAULT_GAP_ALLOWANCE;
  const ceiling = Math.max(base, Math.round(bitmap.width / 6));
  let best = { lines: [], systems: [], gapAllowance: base };
  let bestCount = 0;
  let tried = -1;
  for (const factor of GAP_LADDER) {
    const gapAllowance = Math.min(base * factor, ceiling);
    if (gapAllowance === tried) break;
    tried = gapAllowance;
    const lines = findStaffLines(bitmap, { ...options, gapAllowance });
    const systems = groupSystems(lines, options);
    const count = systems.reduce((n, system) => n + system.count, 0);
    if (count > bestCount) {
      best = { lines, systems, gapAllowance };
      bestCount = count;
    }
  }
  return best;
}
