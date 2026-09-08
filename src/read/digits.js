// Reading one mark: is it a 3, a 12, a dead note, or the "TAB" written at the
// front of the staff?
//
// Deliberately not machine learning. The whole extension is meant to be
// reviewable by reading it, and a printed digit is one of the most
// constrained shapes there is: ten possibilities, drawn upright, at a known
// size, in a plain face. Three cheap measurements settle it — the shape
// itself, how many holes it has, and how wide it is for its height.
//
// Pure ES module: no DOM, no browser APIs.

import { holesOf } from "./glyphs.js";

/** Marks are compared on a square this many pixels on a side. */
export const GLYPH_SIZE = 16;

/**
 * The alphabet, drawn out.
 *
 * Digits and the × of a dead note are music. T and A are here for one reason
 * only: the word written down the front of a tab staff is recognised as
 * writing and thrown away, instead of being read as frets.
 *
 * There is no B, and its absence is the rule the rest of this list follows. A
 * B and an 8 are the same shape with the corners squared off, and no measure
 * that separates them at a fret number's size does it reliably. Keeping B
 * turned three sizes of 8 into furniture; dropping it risks a stray B being
 * read as an 8. The 8th fret is played rather more often than a letter B
 * turns up sitting on a string, so B goes. A letterform earns its place here
 * only when it cannot be mistaken for a digit.
 *
 * A character may be drawn more than once. Faces disagree about a few
 * letterforms in ways no amount of blurring will paper over — a 1 with a foot
 * under it and a 1 without are simply different shapes — so both are here,
 * and whichever fits better wins.
 */
const TEMPLATE_ART = [
  { char: "0", art: [
    ".....######.....",
    "....########....",
    "...###....###...",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "...###....###...",
    "....########....",
    ".....######.....",
  ] },
  { char: "1", art: [
    "........####....",
    ".......#####....",
    "......######....",
    ".....###.###....",
    "....##...###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
    ".........###....",
  ] },
  // A 1 with a foot under it, as many faces draw it.
  { char: "1", art: [
    ".......####.....",
    "......#####.....",
    ".....######.....",
    "....###.###.....",
    "...##...###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "........###.....",
    "...##########...",
    "...##########...",
  ] },
  { char: "2", art: [
    "...########.....",
    "..##########....",
    ".###......###...",
    ".##........###..",
    "...........###..",
    "...........###..",
    "..........###...",
    ".........###....",
    "........###.....",
    ".......###......",
    "......###.......",
    ".....###........",
    "....###.........",
    "...###..........",
    "..#############.",
    "..#############.",
  ] },
  { char: "3", art: [
    "...########.....",
    "..##########....",
    ".###......###...",
    ".##........###..",
    "...........###..",
    ".........####...",
    "......#####.....",
    "......#####.....",
    ".........####...",
    "...........###..",
    "...........###..",
    ".##........###..",
    ".###......###...",
    "..##########....",
    "...########.....",
    "....######......",
  ] },
  { char: "4", art: [
    "..........###...",
    ".........####...",
    "........#####...",
    ".......##.###...",
    "......##..###...",
    ".....##...###...",
    "....##....###...",
    "...##.....###...",
    "..##......###...",
    ".##.......###...",
    ".#############..",
    ".#############..",
    "..........###...",
    "..........###...",
    "..........###...",
    "..........###...",
  ] },
  // A 4 left open at the corner, which is the other way it is drawn.
  { char: "4", art: [
    "..........###...",
    ".........####...",
    "........##.##...",
    ".......##..##...",
    "......##...##...",
    ".....##....##...",
    "....##.....##...",
    "...##......##...",
    "..##.......##...",
    ".##........##...",
    ".#############..",
    ".#############..",
    "..........###...",
    "..........###...",
    "..........###...",
    "..........###...",
  ] },
  { char: "5", art: [
    ".############...",
    ".############...",
    ".###............",
    ".###............",
    ".###............",
    ".##########.....",
    ".############...",
    ".........####...",
    "...........###..",
    "...........###..",
    "...........###..",
    "...........###..",
    ".##.......####..",
    ".###.....####...",
    "..##########....",
    "...########.....",
  ] },
  { char: "6", art: [
    "......######....",
    "....########....",
    "...####...###...",
    "..###......##...",
    "..###...........",
    "..###...........",
    "..###.######....",
    "..############..",
    "..###......###..",
    "..###.......###.",
    "..###.......###.",
    "..###.......###.",
    "..###......###..",
    "...###....###...",
    "....########....",
    ".....######.....",
  ] },
  { char: "7", art: [
    ".#############..",
    ".#############..",
    "...........###..",
    "..........###...",
    ".........###....",
    ".........###....",
    "........###.....",
    "........###.....",
    ".......###......",
    ".......###......",
    "......###.......",
    "......###.......",
    ".....###........",
    ".....###........",
    "....###.........",
    "....###.........",
  ] },
  { char: "8", art: [
    ".....######.....",
    "...##########...",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "...###....###...",
    "....########....",
    "....########....",
    "...###....###...",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "..###......###..",
    "...###....###...",
    "...##########...",
    ".....######.....",
  ] },
  { char: "9", art: [
    ".....######.....",
    "....########....",
    "...###....###...",
    "..###......###..",
    "..###.......###.",
    "..###.......###.",
    "..###......###..",
    "...############.",
    "....######.###..",
    "...........###..",
    "...........###..",
    "..........###...",
    "..##......###...",
    "..###....###....",
    "...########.....",
    "....######......",
  ] },
  { char: "x", art: [
    ".##.........##..",
    ".###.......###..",
    "..###.....###...",
    "...###...###....",
    "....###.###.....",
    ".....######.....",
    "......####......",
    "......####......",
    "......####......",
    ".....######.....",
    "....###.###.....",
    "...###...###....",
    "..###.....###...",
    ".###.......###..",
    ".##.........##..",
    ".#...........#..",
  ] },
  // Brackets. A note held over from the bar before is written in them, and
  // they stand right beside the number, on the string, at very nearly its
  // size. Left out, each one reads as a narrow mark of some sort — most often
  // a 1 — and a held 7 comes back as three notes, or as the 17th fret.
  { char: "(", art: [
    "......##........",
    ".....##.........",
    "....##..........",
    "....##..........",
    "...##...........",
    "...##...........",
    "...##...........",
    "...##...........",
    "...##...........",
    "...##...........",
    "...##...........",
    "....##..........",
    "....##..........",
    ".....##.........",
    "......##........",
    "......##........",
  ] },
  { char: ")", art: [
    "........##......",
    ".........##.....",
    "..........##....",
    "..........##....",
    "...........##...",
    "...........##...",
    "...........##...",
    "...........##...",
    "...........##...",
    "...........##...",
    "...........##...",
    "..........##....",
    "..........##....",
    ".........##.....",
    "........##......",
    "........##......",
  ] },
  { char: "T", art: [
    ".#############..",
    ".#############..",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
    "......###.......",
  ] },
  { char: "A", art: [
    ".......##.......",
    "......####......",
    "......####......",
    ".....##..##.....",
    ".....##..##.....",
    "....##....##....",
    "....##....##....",
    "...##......##...",
    "...##########...",
    "...##########...",
    "..##........##..",
    "..##........##..",
    ".##..........##.",
    ".##..........##.",
    ".##..........##.",
    "###..........###",
  ] },
];

/**
 * How wide each character is allowed to be for its height.
 *
 * A range, not a number: a 1 can be a bare stroke or a stroke with a flag and
 * a foot, and the difference is bigger than the difference between a 3 and an
 * 8. Aspect is here to rule shapes out — nothing three pixels wide and ten
 * tall is a 7 — and not to pick the winner.
 */
const ASPECT_RANGE = {
  0: [0.42, 0.85],
  1: [0.16, 0.46],
  2: [0.42, 0.85],
  3: [0.42, 0.85],
  4: [0.42, 0.9],
  5: [0.42, 0.85],
  6: [0.42, 0.85],
  7: [0.4, 0.85],
  8: [0.42, 0.85],
  9: [0.42, 0.85],
  x: [0.6, 1.1],
  "(": [0.12, 0.55],
  ")": [0.12, 0.55],
  T: [0.62, 1.05],
  A: [0.62, 1.1],
};

/** Characters that are music rather than furniture. */
export const MUSIC_GLYPHS = "0123456789x";

/** Brackets: not music, not furniture either — they say something about the note beside them. */
export const BRACKET_GLYPHS = "()";

/** Below this the mark is reported as unreadable instead of guessed at. */
export const MIN_CONFIDENCE = 0.6;

/** ...and the shape alone has to reach this, whatever the rest of the score says. */
export const MIN_SHAPE = 0.5;

/** How much of the score each measurement is worth. They add up to one. */
const SHAPE_WEIGHT = 0.4;
const STROKE_WEIGHT = 0.3;
const HOLE_WEIGHT = 0.12;
const ASPECT_WEIGHT = 0.18;

/** Bands the mark is cut into across its height to see where its strokes are. */
const BANDS = 8;

/** Ink at or above this share of a cell counts as a stroke passing through it. */
const STROKE_LEVEL = 0.35;

/** Where the ink is, once and for all: 1 for a stroke, 0 for the paper. */
function inkOf(grid) {
  const ink = new Uint8Array(grid.length);
  for (let i = 0; i < grid.length; i++) ink[i] = grid[i] >= STROKE_LEVEL ? 1 : 0;
  return ink;
}

/**
 * How far every point is from the nearest stroke.
 *
 * Two passes over the square, taking a step sideways as 1 and a step
 * diagonally as roughly the square root of 2. The usual approximation, and
 * exact enough on a picture sixteen pixels across.
 */
function distanceField(ink) {
  const FAR = 1000;
  const d = new Float32Array(ink.length);
  for (let i = 0; i < ink.length; i++) d[i] = ink[i] ? 0 : FAR;
  const at = (x, y) => (x < 0 || y < 0 || x >= GLYPH_SIZE || y >= GLYPH_SIZE ? FAR : d[y * GLYPH_SIZE + x]);
  for (let y = 0; y < GLYPH_SIZE; y++) {
    for (let x = 0; x < GLYPH_SIZE; x++) {
      const i = y * GLYPH_SIZE + x;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = GLYPH_SIZE - 1; y >= 0; y--) {
    for (let x = GLYPH_SIZE - 1; x >= 0; x--) {
      const i = y * GLYPH_SIZE + x;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  return d;
}

/** How far apart two drawings are before they stop resembling each other at all. */
const SHAPE_TOLERANCE = 3.6;

/**
 * How much of the answer comes from the worst part of the fit rather than the
 * average. A digit is mostly the same as its neighbours; it is the one place
 * they differ that names it, and an average buries that place.
 */
const WORST_SHARE = 0.3;

/** ...where "worst" means this far up the sorted distances, not the single furthest pixel. */
const WORST_AT = 0.9;

/**
 * How alike two drawings are, 0 to 1.
 *
 * Measured both ways: how far each stroke of the mark is from the nearest
 * stroke of the letterform, and how far each stroke of the letterform is from
 * the nearest stroke of the mark. Both directions are needed, and this is why
 * the reader does not simply overlay the two pictures and count matching
 * pixels. A 5 laid over a 3 agrees almost everywhere: same bar across the
 * top, same bowl underneath, same width. The one thing a 5 has that a 3 has
 * not is the stem down its left-hand side.
 *
 * And that stem is a dozen pixels out of a hundred, so an average of the
 * distances buries it just as thoroughly as counting matching pixels would.
 * Most of the score therefore comes from the far end of the distances — from
 * how badly the worst-fitting tenth of the ink fits — which is precisely
 * where a stem with nothing opposite it shows up. Not the single furthest
 * pixel, though: one speck of dirt would then decide everything.
 */
function shapeScore(mark, template) {
  const distances = [];
  let sum = 0;
  for (let i = 0; i < mark.ink.length; i++) {
    if (!mark.ink[i]) continue;
    distances.push(template.field[i]);
    sum += template.field[i];
  }
  for (let i = 0; i < template.ink.length; i++) {
    if (!template.ink[i]) continue;
    distances.push(mark.field[i]);
    sum += mark.field[i];
  }
  if (!distances.length) return 0;
  distances.sort((a, b) => a - b);
  const mean = sum / distances.length;
  const worst = distances[Math.min(distances.length - 1, Math.floor(distances.length * WORST_AT))];
  const distance = (1 - WORST_SHARE) * mean + WORST_SHARE * worst;
  return Math.max(0, 1 - distance / SHAPE_TOLERANCE);
}

/**
 * Where the strokes are, band by band down the mark.
 *
 * The shape score above says how well two drawings sit on top of each other.
 * This says something different and harder to fake: on each of eight lines
 * across the mark, how many strokes cross it and how far left and right they
 * reach. A 5 reaches the left edge a quarter of the way down where a 3 has
 * nothing; an A stands on two legs where a 4 has one. Those facts survive a
 * change of face, a change of size and a bad scan, and they are what the eye
 * is actually using.
 */
export function strokeProfile(grid) {
  const bands = [];
  const rows = GLYPH_SIZE / BANDS;
  for (let b = 0; b < BANDS; b++) {
    let runs = 0;
    let left = -1;
    let right = -1;
    let on = false;
    for (let x = 0; x < GLYPH_SIZE; x++) {
      let value = 0;
      for (let r = 0; r < rows; r++) {
        const v = grid[(b * rows + r) * GLYPH_SIZE + x];
        if (v > value) value = v;
      }
      const inked = value >= STROKE_LEVEL;
      if (inked) {
        if (left < 0) left = x;
        right = x;
        if (!on) runs++;
      }
      on = inked;
    }
    bands.push({ runs, left: left < 0 ? -1 : left / (GLYPH_SIZE - 1), right: right < 0 ? -1 : right / (GLYPH_SIZE - 1) });
  }
  return bands;
}

/** How much two stroke profiles agree, 0 to 1. */
function strokeScore(mark, template) {
  let total = 0;
  for (let b = 0; b < BANDS; b++) {
    const a = mark[b];
    const t = template[b];
    if (a.left < 0 || t.left < 0) {
      total += a.left < 0 && t.left < 0 ? 1 : 0;
      continue;
    }
    const runs = 1 - Math.min(1, Math.abs(a.runs - t.runs) / 2);
    const edges = 1 - Math.min(1, (Math.abs(a.left - t.left) + Math.abs(a.right - t.right)) / 1.2);
    total += 0.5 * runs + 0.5 * edges;
  }
  return total / BANDS;
}

/** One drawing turned into a mark of the same shape as a real one. */
function componentFromArt(rows) {
  let x0 = GLYPH_SIZE;
  let x1 = -1;
  let y0 = GLYPH_SIZE;
  let y1 = -1;
  for (let y = 0; y < GLYPH_SIZE; y++) {
    for (let x = 0; x < GLYPH_SIZE; x++) {
      if ((rows[y] || "")[x] !== "#") continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const width = x1 - x0 + 1;
  const height = y1 - y0 + 1;
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) cells[y * width + x] = rows[y0 + y][x0 + x] === "#" ? 1 : 0;
  }
  return { x0, x1, y0, y1, width, height, cells };
}

const TEMPLATES = TEMPLATE_ART.map(({ char, art }) => {
  const component = componentFromArt(art);
  const grid = normalizeGlyph(component);
  const ink = inkOf(grid);
  return {
    char,
    ink,
    field: distanceField(ink),
    strokes: strokeProfile(grid),
    // Measured off the drawing rather than written down beside it: one place
    // for the truth, and a template that is redrawn cannot fall out of step
    // with the numbers that describe it.
    holes: holesOf(component),
    aspect: ASPECT_RANGE[char] || [0.3, 1.1],
  };
});

/**
 * A mark redrawn on the standard square, stretched to fill it.
 *
 * Stretched, not scaled, and that is worth explaining because it looks wrong:
 * it makes a 1 as wide as a 0. But how wide a digit is drawn for its height
 * is already measured, separately, by aspectScore — and leaving it in here as
 * well is what breaks a condensed face. Scaled by height and centred, a
 * narrow 5 lands with its left-hand stem two pixels in from where a normally
 * proportioned 5 puts it, so it fits a 3 better than it fits a 5. Stretching
 * asks only what shape the strokes make, which is a question the answer to
 * does not change with the face.
 *
 * Area-averaged rather than sampled, so a stroke thinner than one output
 * pixel still leaves a mark.
 */
export function normalizeGlyph(component) {
  const grid = new Float32Array(GLYPH_SIZE * GLYPH_SIZE);
  const targetWidth = GLYPH_SIZE;
  const offset = 0;
  for (let y = 0; y < GLYPH_SIZE; y++) {
    const sy0 = (y * component.height) / GLYPH_SIZE;
    const sy1 = ((y + 1) * component.height) / GLYPH_SIZE;
    for (let x = 0; x < targetWidth; x++) {
      const sx0 = (x * component.width) / targetWidth;
      const sx1 = ((x + 1) * component.width) / targetWidth;
      let sum = 0;
      let n = 0;
      for (let sy = Math.floor(sy0); sy < Math.max(Math.floor(sy0) + 1, Math.ceil(sy1)); sy++) {
        if (sy < 0 || sy >= component.height) continue;
        for (let sx = Math.floor(sx0); sx < Math.max(Math.floor(sx0) + 1, Math.ceil(sx1)); sx++) {
          if (sx < 0 || sx >= component.width) continue;
          sum += component.cells[sy * component.width + sx];
          n++;
        }
      }
      grid[y * GLYPH_SIZE + offset + x] = n ? sum / n : 0;
    }
  }
  return grid;
}

/** 1 inside the range, falling away outside it. */
function aspectScore(aspect, [low, high]) {
  if (aspect >= low && aspect <= high) return 1;
  const distance = aspect < low ? (low - aspect) / low : (aspect - high) / high;
  return Math.max(0, 1 - distance * 1.6);
}

/**
 * How well two sets of holes agree.
 *
 * The count first — a mark with two holes is an 8 and nothing else — and then
 * where the hole sits and how big it is, which is the whole difference
 * between a 0, a 6 and a 9 once the shapes have been blurred.
 */
function holeScore(mark, template) {
  if (mark.count !== template.count) return 0;
  if (!mark.count) return 1;
  const down = Math.abs(mark.cy - template.cy);
  const across = Math.abs(mark.cx - template.cx);
  const size = Math.abs(mark.area - template.area);
  return Math.max(0, 1 - down * 2.4 - across * 2.4 - size * 2.4);
}

/**
 * What one mark most likely is.
 *
 * Returns { char, score, holes, runnerUp } — `char` is null when nothing
 * scored well enough to be worth believing. A mark the reader is unsure of is
 * counted and reported, never quietly turned into a note.
 */
export function classifyGlyph(component, options = {}) {
  const holes = holesOf(component);
  const aspect = component.width / component.height;
  const grid = normalizeGlyph(component);
  const ink = inkOf(grid);
  const mark = { ink, field: distanceField(ink) };
  const strokes = strokeProfile(grid);
  const best = new Map();
  for (const template of TEMPLATES) {
    const shape = shapeScore(mark, template);
    const score =
      SHAPE_WEIGHT * shape +
      STROKE_WEIGHT * strokeScore(strokes, template.strokes) +
      HOLE_WEIGHT * holeScore(holes, template.holes) +
      ASPECT_WEIGHT * aspectScore(aspect, template.aspect);
    if (!best.has(template.char) || best.get(template.char).score < score) best.set(template.char, { score, shape });
  }
  const scored = [...best.entries()].map(([char, found]) => ({ char, ...found })).sort((a, b) => b.score - a.score);
  const floor = typeof options.minConfidence === "number" ? options.minConfidence : MIN_CONFIDENCE;
  const shapeFloor = typeof options.minShape === "number" ? options.minShape : MIN_SHAPE;
  // Two hurdles, not one. Holes and proportions are cheap to agree with by
  // accident — a smudge with no hole in it, two thirds as wide as it is tall,
  // has most of a digit's score before anyone has looked at its shape — so
  // the shape has to stand on its own as well.
  const sure = scored[0].score >= floor && scored[0].shape >= shapeFloor;
  return {
    char: sure ? scored[0].char : null,
    score: scored[0].score,
    shape: scored[0].shape,
    holes: holes.count,
    runnerUp: scored[1] ? scored[1].char : null,
  };
}

/** True for the marks that mean a note: a fret number or a dead stroke. */
export function isMusicGlyph(char) {
  return typeof char === "string" && MUSIC_GLYPHS.indexOf(char) !== -1;
}

/** True for a bracket, which is neither a note nor something to complain about. */
export function isBracketGlyph(char) {
  return typeof char === "string" && BRACKET_GLYPHS.indexOf(char) !== -1;
}
