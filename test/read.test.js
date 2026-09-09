// Reading sheet music out of a picture.
//
// Two kinds of test in here. The unit tests pin the pieces — how a staff line
// is told from a page rule, how a mark is told from a bar line, how "1" and
// "2" side by side become the 12th fret. The fixture tests are the ones that
// matter: real PNG files in test/fixtures/pictures/, drawn in a digit face
// the reader has never seen, read back and compared with the tab they were
// drawn from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { toGray, toInk, backgroundLevel, histogram, otsuThreshold, inkFraction } from "../src/read/image.js";
import { cropBox, bestReading, coverageOf } from "../src/ui/picture.js";
import { wholeSystems, wholeReading, readTo, stitchReads } from "../src/read/stitch.js";
import { rowRuns, findStaffLines, groupSystems, findStaves, median, commonSize } from "../src/read/staff.js";
import { eraseStaffLines, findComponents, holesOf, countHoles } from "../src/read/glyphs.js";
import { classifyGlyph, normalizeGlyph, isMusicGlyph, MIN_CONFIDENCE } from "../src/read/digits.js";
import { readSystem, joinDigits, columnsOf, staffKind, confidenceOf } from "../src/read/score.js";
import { systemToAscii } from "../src/read/ascii.js";
import { readSheetMusic, REASONS } from "../src/read/index.js";
import { convertText } from "../src/pipeline.js";
import { renderTab, createImage, fillRect, drawGlyph } from "./helpers/draw.js";
import { pageAround } from "../tools/make-pictures.js";
import { readPng, writePng, isPng } from "../tools/png.js";

const PICTURES = new URL("./fixtures/pictures/", import.meta.url).pathname;

/**
 * The notes a piece of ASCII tab holds, in playing order, top string first.
 *
 * A fret in brackets is a note held over, and comes back with its brackets —
 * counted at the column of its NUMBER, because that is what lines up with the
 * notes around it, brackets or no brackets.
 */
function notesOf(text) {
  return text.split(/\n\s*\n/).flatMap((block, stave) => {
    const lines = block
      .split("\n")
      .map((l) => l.replace(/^\s*[A-Ga-g#b]?\s*\|+/, ""))
      .filter((l) => l.length);
    const out = [];
    const width = Math.max(...lines.map((l) => l.length));
    for (let c = 0; c < width; c++) {
      for (let s = 0; s < lines.length; s++) {
        const line = lines[s];
        const ch = line[c];
        if (!/[\dx]/.test(ch || "")) continue;
        if (/[\dx]/.test(line[c - 1] || "")) continue; // the tail of a number already counted
        let at = c;
        let fret = "";
        while (/[\dx]/.test(line[at] || "")) fret += line[at++];
        const held = line[c - 1] === "(" && line[at] === ")";
        out.push(`${stave}.${s}:${held ? `(${fret})` : fret}`);
      }
    }
    return out;
  });
}

/** A component of the shape findComponents makes, straight from ASCII art. */
function componentOf(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const cells = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => [...row].forEach((ch, x) => (cells[y * width + x] = ch === "#" ? 1 : 0)));
  return { x0: 0, x1: width - 1, y0: 0, y1: rows.length - 1, width, height: rows.length, area: cells.reduce((a, b) => a + b, 0), cx: (width - 1) / 2, cy: (rows.length - 1) / 2, cells };
}

// --------------------------------------------------------------------------
// image.js
// --------------------------------------------------------------------------

test("toGray: RGBA becomes one byte a pixel, and see-through counts as paper", () => {
  const data = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255, 12, 34, 56, 0]);
  const { width, height, gray } = toGray({ width: 4, height: 1, data });
  assert.equal(width, 4);
  assert.equal(height, 1);
  assert.equal(gray[0], 0);
  assert.equal(gray[1], 255);
  assert.ok(gray[2] > 60 && gray[2] < 90, `red should be mid-grey, got ${gray[2]}`);
  // A canvas nobody has drawn on is transparent black; read as black it would
  // be one huge blot covering the music.
  assert.equal(gray[3], 255);
});

test("toGray: a picture that is already grey is passed straight through", () => {
  const gray = Uint8Array.from([1, 2, 3, 4]);
  assert.equal(toGray({ width: 2, height: 2, gray }).gray, gray);
});

test("toGray refuses a picture smaller than it claims to be", () => {
  assert.throws(() => toGray({ width: 10, height: 10, data: new Uint8ClampedArray(8) }));
  assert.throws(() => toGray(null));
});

test("toInk: ink is dark on light, and light on dark, without being told which", () => {
  const light = { width: 4, height: 2, gray: Uint8Array.from([255, 255, 0, 255, 255, 255, 255, 255]) };
  const onLight = toInk(light);
  assert.equal(onLight.inverted, false);
  assert.equal(onLight.ink[2], 1);
  assert.equal(onLight.ink[0], 0);

  const dark = { width: 4, height: 2, gray: Uint8Array.from([10, 10, 250, 10, 10, 10, 10, 10]) };
  const onDark = toInk(dark);
  assert.equal(onDark.inverted, true);
  assert.equal(onDark.ink[2], 1);
  assert.equal(onDark.ink[0], 0);
});

test("backgroundLevel is the commonest grey, not the average", () => {
  // Two thirds of this is white; the average would call it mid-grey.
  const gray = Uint8Array.from([255, 255, 255, 255, 0, 0]);
  assert.equal(backgroundLevel(histogram(gray)), 255);
});

test("otsu picks a level with every pixel of ink below it", () => {
  const gray = Uint8Array.from([0, 0, 20, 240, 255, 255]);
  const t = otsuThreshold(histogram(gray), gray.length);
  assert.ok(t >= 20 && t < 240, `threshold ${t} should sit between the ink and the paper`);
});

// --------------------------------------------------------------------------
// staff.js
// --------------------------------------------------------------------------

test("rowRuns measures the longest run, and how much of it is ink", () => {
  const img = createImage(40, 3, 255);
  fillRect(img, 5, 1, 20, 1, 0);
  const runs = rowRuns(toInk(img), 2);
  assert.equal(runs.longest[1], 20);
  assert.equal(runs.inked[1], 20);
  assert.equal(runs.longest[0], 0);
});

test("rowRuns bridges the holes left behind fret numbers", () => {
  const img = createImage(60, 3, 255);
  fillRect(img, 5, 1, 15, 1, 0);
  fillRect(img, 27, 1, 15, 1, 0); // a seven-pixel hole between them
  const tight = rowRuns(toInk(img), 2);
  const loose = rowRuns(toInk(img), 9);
  assert.equal(tight.longest[1], 15, "a small allowance sees two separate strokes");
  assert.equal(loose.longest[1], 37, "a big enough one sees a line with a hole in it");
  assert.equal(loose.inked[1], 30, "and still knows how much of it was ink");
});

test("findStaffLines finds six lines and ignores a thick block", () => {
  const img = createImage(200, 120, 255);
  fillRect(img, 0, 0, 200, 14, 0); // a navigation bar
  for (let i = 0; i < 6; i++) fillRect(img, 20, 40 + i * 12, 160, 1, 0);
  const lines = findStaffLines(toInk(img));
  assert.deepEqual(lines.map((l) => l.y), [40, 52, 64, 76, 88, 100]);
});

test("groupSystems keeps a five-line stave and a six-line one apart", () => {
  const img = createImage(240, 200, 255);
  for (let i = 0; i < 5; i++) fillRect(img, 20, 20 + i * 9, 200, 1, 0); // notation
  for (let i = 0; i < 6; i++) fillRect(img, 20, 110 + i * 14, 200, 1, 0); // tab
  const systems = groupSystems(findStaffLines(toInk(img)));
  assert.deepEqual(
    systems.map((s) => [s.count, s.spacing]),
    [
      [5, 9],
      [6, 14],
    ],
  );
});

test("a rule drawn just above a stave does not cost it a string", () => {
  // The bug this pins: the stray line joined the first staff line at a
  // nonsense spacing, the group was thrown away for being too small, and the
  // stave came back with five strings instead of six — every note one string
  // out, silently.
  const img = createImage(240, 160, 255);
  fillRect(img, 10, 20, 220, 1, 0);
  for (let i = 0; i < 6; i++) fillRect(img, 20, 50 + i * 13, 200, 1, 0);
  const systems = groupSystems(findStaffLines(toInk(img)));
  assert.equal(systems.length, 1);
  assert.equal(systems[0].count, 6);
  assert.equal(systems[0].lines[0].y, 50);
});

test("findStaves widens its allowance until the staff turns up", () => {
  // Drawn big: the holes behind the numbers are wider than the first guess.
  const picture = renderTab(["|--3--5--7--|", "|-----------|", "|--0--------|", "|-----------|", "|-----------|", "|--3--------|"].join("\n"), {
    spacing: 30,
    columnWidth: 16,
    digitHeight: 24,
    digitWidth: 15,
    thickness: 2,
  });
  const { systems, gapAllowance } = findStaves(toInk(picture));
  assert.equal(systems.length, 1);
  assert.equal(systems[0].count, 6);
  assert.ok(gapAllowance > 9, `should have widened past the first guess, stayed at ${gapAllowance}`);
});

test("median", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), 0);
});

// --------------------------------------------------------------------------
// glyphs.js
// --------------------------------------------------------------------------

test("erasing the staff lines and putting the numbers back together", () => {
  // A number sits ON its string, so rubbing out the line cuts it in half.
  // Anything that leaves the halves apart turns one note into two marks.
  const picture = renderTab(["|--3--5--|", "|--------|", "|--------|", "|--------|", "|--------|", "|--------|"].join("\n"));
  const bitmap = toInk(picture);
  const { systems } = findStaves(bitmap);
  const erased = eraseStaffLines(bitmap, findStaffLines(bitmap));
  const system = systems[0];
  const marks = findComponents(erased, { x0: system.x0, x1: system.x1, y0: system.top - system.spacing, y1: system.bottom + system.spacing }, { minArea: 4 });
  const numbers = marks.filter((m) => m.height > system.spacing * 0.4 && m.height < system.spacing * 1.5 && m.width < system.spacing);
  assert.equal(numbers.length, 2, "two numbers, not four halves");
  for (const number of numbers) assert.ok(number.height >= system.spacing * 0.5, "and each one its full height");
});

test("holesOf: how many holes, where the biggest one is, and how big", () => {
  assert.equal(countHoles(componentOf(["#####", "#...#", "#...#", "#...#", "#####"])), 1);
  assert.equal(countHoles(componentOf(["#####", "#...#", "#####", "#...#", "#####"])), 2);
  assert.equal(countHoles(componentOf([".###.", "...#.", "...#.", "...#.", "...#."])), 0);
  // A 6 and a 9 are the same shape with the hole in a different place.
  const six = holesOf(componentOf(["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."]));
  const nine = holesOf(componentOf([".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."]));
  assert.equal(six.count, 1);
  assert.equal(nine.count, 1);
  assert.ok(six.cy > nine.cy, `a 6 keeps its hole low (${six.cy}) and a 9 keeps it high (${nine.cy})`);
});

test("a single stray pixel between two strokes is not a hole", () => {
  assert.equal(countHoles(componentOf(["###", "#.#", "###"])), 0);
});

// --------------------------------------------------------------------------
// digits.js
// --------------------------------------------------------------------------

test("every digit is recognised in a face the reader has never seen", () => {
  // The whole point of this test: test/helpers/draw.js draws a plain 5x7
  // terminal font — a 1 with a foot, a flat-topped 3, a 4 open at the corner —
  // and none of those are the shapes src/read/digits.js matches against. A
  // reader that only knew its own drawings would sail through a test drawn
  // with them and fail on the first real screenshot.
  for (const char of "0123456789x") {
    for (const height of [8, 11, 16, 24]) {
      const width = Math.max(3, Math.round(height * (char === "1" ? 0.4 : 0.62)));
      const img = createImage(width + 4, height + 4, 255);
      drawGlyph(img, char, 2, 2, width, height, 0);
      const bitmap = toInk(img);
      const [mark] = findComponents(bitmap, { x0: 0, x1: img.width - 1, y0: 0, y1: img.height - 1 }, { minArea: 2 });
      const read = classifyGlyph(mark);
      assert.equal(read.char, char, `a ${height}px "${char}" was read as "${read.char}" (${read.score.toFixed(2)})`);
    }
  }
});

test("the word written down the front of a tab staff becomes no notes", () => {
  // Guitar Pro and every tab player after it write "TAB" across the left of
  // the staff, in letters two or three strings tall. Three things have to
  // agree for that not to come out as three frets: the letters are far bigger
  // than the numbers, they do not sit on a string, and they do not look like
  // digits. This checks the lot of them together, on a staff with real notes
  // on it, which is the only way that matters.
  const picture = renderTab(["|------3--5--7--|", "|---------------|", "|------0--------|", "|---------------|", "|---------------|", "|------3--------|"].join("\n"), { spacing: 16, columnWidth: 9, digitHeight: 12, digitWidth: 8 });
  const clef = [
    ["T", 26, 20],
    ["A", 26, 44],
    ["B", 26, 68],
  ];
  for (const [char, x, y] of clef) drawGlyph(picture, char, x, y, 16, 22, 0);
  const reading = readSheetMusic(picture);
  assert.equal(reading.ok, true, reading.reason);
  assert.deepEqual(notesOf(reading.text), notesOf(["|--3--5--7--|", "|-----------|", "|--0--------|", "|-----------|", "|-----------|", "|--3--------|"].join("\n")));
});

test("a mark that is nothing in particular is reported, not guessed at", () => {
  const slur = componentOf(["..###..", ".#...#.", "#.....#"]);
  assert.equal(classifyGlyph(slur).char, null);
  // ...unless the caller says it will take anything.
  assert.notEqual(classifyGlyph(slur, { minConfidence: 0, minShape: 0 }).char, null);
});

test("shape has to stand on its own, whatever the holes and the width say", () => {
  // A mark with no hole in it, two thirds as wide as it is tall, already has
  // most of a digit's score before anyone has looked at its shape, so the
  // shape is asked separately. It costs one reading in a couple of hundred at
  // the very smallest sizes, and that one is reported as unreadable rather
  // than turned into the wrong note, which is the trade worth making.
  const tiny = componentOf(["####", "...#", "..#.", ".#..", ".#.."]);
  const read = classifyGlyph(tiny, { minShape: 0.99 });
  assert.equal(read.char, null);
  assert.ok(read.score >= MIN_CONFIDENCE, "the total was fine; it was the shape that was turned down");
});

test("marks that are not fret numbers never become notes", () => {
  // The reader's real defence against page furniture is not the classifier:
  // it is that a fret number is a certain size and sits on a string. This is
  // a staff with the things that actually surround one — a time signature at
  // the front, a slur arching over the top, staccato dots underneath — and
  // none of them are notes.
  const tab = ["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n");
  const picture = renderTab(tab, { spacing: 16, columnWidth: 9, digitHeight: 12, digitWidth: 8, margin: 40 });
  drawGlyph(picture, "4", 14, 24, 14, 34, 0); // a time signature, across two strings
  drawGlyph(picture, "4", 14, 60, 14, 34, 0);
  for (let x = 50; x < 110; x++) fillRect(picture, x, 14 - Math.round(Math.sin(((x - 50) / 60) * Math.PI) * 5), 1, 1, 0); // a slur
  for (let i = 0; i < 6; i++) fillRect(picture, 50 + i * 18, picture.height - 12, 2, 2, 0); // staccato dots
  const reading = readSheetMusic(picture);
  assert.equal(reading.ok, true, reading.reason);
  assert.deepEqual(notesOf(reading.text), notesOf(tab));
});

test("normalizeGlyph stretches to fill, so a condensed face reads the same", () => {
  // Scaled by height and centred instead, a narrow 5 lands with its stem two
  // pixels in from where a normally proportioned 5 puts it, and fits a 3
  // better than it fits a 5. How wide a digit is drawn is measured on its
  // own, by the aspect term, and does not belong in the shape as well.
  const wide = normalizeGlyph(componentOf(["######", "#.....", "#####.", ".....#", ".....#", "#....#", ".####."]));
  const narrow = normalizeGlyph(componentOf(["###", "#..", "###", "..#", "..#", "#.#", ".#."]));
  let apart = 0;
  for (let i = 0; i < wide.length; i++) apart += Math.abs(wide[i] - narrow[i]);
  assert.ok(apart / wide.length < 0.25, `the same 5 drawn narrow should land in the same place, off by ${(apart / wide.length).toFixed(2)}`);
});

// --------------------------------------------------------------------------
// score.js and ascii.js
// --------------------------------------------------------------------------

test('joinDigits: "1" then "2" close together is the 12th fret', () => {
  const near = [
    { cx: 10, x0: 8, x1: 12, string: 0, char: "1", score: 0.9 },
    { cx: 15, x0: 13, x1: 17, string: 0, char: "2", score: 0.9 },
  ];
  assert.deepEqual(joinDigits(near, 10).map((e) => e.fret), [12]);
});

test("joinDigits leaves two notes alone when they are a beat apart", () => {
  const apart = [
    { cx: 10, x0: 8, x1: 12, string: 0, char: "1", score: 0.9 },
    { cx: 40, x0: 38, x1: 42, string: 0, char: "2", score: 0.9 },
  ];
  assert.deepEqual(joinDigits(apart, 10).map((e) => e.fret), [1, 2]);
});

test("joinDigits never makes a fret no guitar has", () => {
  // 3 and 4 side by side would be the 34th fret, so they stay two notes.
  const marks = [
    { cx: 10, x0: 8, x1: 12, string: 0, char: "3", score: 0.9 },
    { cx: 15, x0: 13, x1: 17, string: 0, char: "4", score: 0.9 },
  ];
  assert.deepEqual(joinDigits(marks, 10).map((e) => e.fret), [3, 4]);
});

test("joinDigits keeps two strings apart even when the numbers line up", () => {
  const marks = [
    { cx: 10, x0: 8, x1: 12, string: 0, char: "1", score: 0.9 },
    { cx: 15, x0: 13, x1: 17, string: 3, char: "2", score: 0.9 },
  ];
  assert.deepEqual(joinDigits(marks, 10).map((e) => e.fret), [1, 2]);
});

test("columnsOf groups a chord and puts the top string first", () => {
  const events = [
    { x: 10, string: 3, fret: 2 },
    { x: 12, string: 0, fret: 0 },
    { x: 40, string: 1, fret: 5 },
  ];
  const columns = columnsOf(events, 12);
  assert.equal(columns.length, 2);
  assert.deepEqual(columns[0].events.map((e) => e.string), [0, 3]);
});

test("staffKind: line count decides, except at five, where the numbers do", () => {
  assert.equal(staffKind(6, 0, 0), "tab");
  assert.equal(staffKind(4, 0, 0), "tab");
  assert.equal(staffKind(5, 0, 8), "notation");
  assert.equal(staffKind(5, 7, 8), "tab");
  assert.equal(staffKind(3, 5, 5), "notation");
});

test("the dashes between two notes follow the gap on the page", () => {
  const system = {
    strings: 2,
    spacing: 12,
    bars: [],
    columns: [
      { x: 0, events: [{ string: 0, fret: 3 }] },
      { x: 30, events: [{ string: 0, fret: 5 }] },
      { x: 60, events: [{ string: 1, fret: 7 }] },
      { x: 120, events: [{ string: 0, fret: 0 }] }, // twice the gap: twice the dashes
    ],
  };
  const [top] = systemToAscii(system);
  assert.equal(top.indexOf("3"), 1);
  assert.equal(top.indexOf("5"), 4);
  assert.equal(top.indexOf("0"), 13);
});

test("two marks squeezed together still get a dash between them", () => {
  const system = {
    strings: 1,
    spacing: 12,
    bars: [],
    columns: [
      { x: 0, events: [{ string: 0, fret: 12 }] },
      { x: 1, events: [{ string: 0, fret: 14 }] },
    ],
  };
  assert.match(systemToAscii(system)[0], /12-14/);
});

test("commonSize is the size most marks agree on, not the middle one", () => {
  // Nine fret numbers and three clef letters half again as tall. The median
  // would be a number here too, but only because the numbers happen to
  // outnumber the letters three to one; the agreed size says so outright.
  const heights = [10, 10, 11, 10, 10, 9, 10, 11, 10, 15, 15, 16];
  assert.ok(Math.abs(commonSize(heights) - 10) < 0.5, `got ${commonSize(heights)}`);
  assert.equal(commonSize([]), 0);
});

test("a bar of mostly dead notes keeps the two real numbers in it", () => {
  // A dead note is drawn smaller than a fret number, and in a muted strumming
  // bar there are more of them than there are numbers. Measuring the size of
  // "a fret number on this staff" across every mark would make the two real
  // numbers look oversized and throw them both away.
  const tab = ["|--x--3--x--x--x--|", "|--x-----x--x--x--|", "|--x--0--x--x--x--|", "|-----------------|", "|-----------------|", "|-----------------|"].join("\n");
  const reading = readSheetMusic(renderTab(tab));
  assert.equal(reading.ok, true);
  assert.deepEqual(notesOf(reading.text), notesOf(tab));
});

test("a fret in brackets is a note held over, not three marks", () => {
  // Tab players write a note tied over from the bar before in brackets. Left
  // unrecognised each bracket reads as some narrow mark of its own — most
  // often a 1 — so a held 7 came back as three notes, or as the 17th fret.
  const tab = ["|--(7)-7--5--|", "|------------|", "|--------(9)-|", "|------------|", "|------------|", "|------------|"].join("\n");
  const reading = readSheetMusic(renderTab(tab, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 }));
  assert.equal(reading.ok, true);
  assert.deepEqual(notesOf(reading.text), notesOf(tab));
  const held = reading.systems[0].events.filter((e) => e.ghost);
  assert.deepEqual(held.map((e) => `${e.string}:${e.fret}`), ["0:7", "2:9"]);
  // ...and the parser downstream already knows what a bracketed fret means.
  const ir = convertText(reading.text, { source: "paste", arrange: false });
  assert.equal(ir.ir.tracks[0].notes.filter((n) => String(n.technique || "").includes("ghost")).length, 2);
});

test("a slur is not a fret number", () => {
  // The arc joining two hammered notes is drawn a whisker above the string,
  // near enough to read as sitting on it. It is told apart by being five or
  // ten times as wide as it is tall.
  const tab = ["|--5--7--5--|", "|-----------|", "|-----------|", "|-----------|", "|-----------|", "|-----------|"].join("\n");
  const picture = renderTab(tab, { spacing: 15, columnWidth: 9, digitHeight: 11, digitWidth: 7 });
  for (let i = 0; i < 2; i++) {
    for (let dx = 0; dx < 40; dx++) {
      const x = 26 + i * 18 + dx;
      fillRect(picture, x, 11 - Math.round(Math.sin((dx / 40) * Math.PI) * 4), 1, 1, 0);
    }
  }
  const reading = readSheetMusic(picture);
  assert.equal(reading.ok, true);
  // Two slurs arching over the same bar sit at the same height, which is
  // exactly what a staff line looks like. A staff that came back with seven
  // strings would put every note on the wrong one, without a word.
  assert.equal(reading.strings, 6);
  assert.deepEqual(notesOf(reading.text), notesOf(tab));
  assert.equal(reading.unreadable, 0, "and it is not reported as something it could not read, either");
});

test("a short stroke at the right height is not the staff's seventh line", () => {
  const img = createImage(300, 160, 255);
  for (let dx = 0; dx < 40; dx++) fillRect(img, 60 + dx, 26, 1, 1, 0); // a slur, one spacing above
  for (let i = 0; i < 6; i++) fillRect(img, 20, 40 + i * 14, 260, 1, 0);
  const systems = groupSystems(findStaffLines(toInk(img)));
  assert.equal(systems.length, 1);
  assert.equal(systems[0].count, 6);
  assert.equal(systems[0].lines[0].y, 40);
});

// --------------------------------------------------------------------------
// The fixtures
// --------------------------------------------------------------------------

const fixtures = readdirSync(PICTURES)
  .filter((f) => f.endsWith(".tab.txt"))
  .map((f) => f.replace(/\.tab\.txt$/, ""));

test("there are enough picture fixtures to trust the reader", () => {
  assert.ok(fixtures.length >= 7, `${fixtures.length} pictures`);
});

for (const name of fixtures) {
  test(`picture: ${name}`, () => {
    const wanted = readFileSync(join(PICTURES, name + ".tab.txt"), "utf8").replace(/\n+$/, "");
    const picture = readPng(new Uint8Array(readFileSync(join(PICTURES, name + ".png"))));
    const reading = readSheetMusic(picture);
    assert.equal(reading.ok, true, `${name}: ${reading.reason}`);
    assert.equal(reading.unreadable, 0, `${name}: ${reading.unreadable} mark(s) could not be made out`);
    assert.deepEqual(notesOf(reading.text), notesOf(wanted));
    assert.ok(reading.confidence > 0.7, `${name}: only ${reading.confidence.toFixed(2)} sure`);
  });
}

test("a picture fixture goes all the way to a MIDI file", () => {
  const picture = readPng(new Uint8Array(readFileSync(join(PICTURES, "riff.png"))));
  const reading = readSheetMusic(picture);
  const result = convertText(reading.text, { source: "paste", title: "Riff", artist: "Fixture" });
  assert.equal(result.summary.kind, "tab");
  assert.equal(result.summary.noteCount, reading.notes);
  assert.equal(result.summary.rhythmSource, "guessed");
  assert.ok(result.bytes.length > 100);
});

// --------------------------------------------------------------------------
// What the reader will not do
// --------------------------------------------------------------------------

test("notes on a five-line stave are reported as such, never guessed at", () => {
  const img = createImage(300, 120, 255);
  for (let i = 0; i < 5; i++) fillRect(img, 20, 30 + i * 10, 260, 1, 0);
  for (let n = 0; n < 8; n++) {
    const cx = 40 + n * 28;
    const cy = 35 + (n % 5) * 5;
    for (let y = -3; y <= 3; y++) for (let x = -4; x <= 4; x++) if ((x * x) / 16 + (y * y) / 9 <= 1) img.gray[(cy + y) * 300 + cx + x] = 0;
    fillRect(img, cx + 4, cy - 25, 1, 25, 0);
  }
  const reading = readSheetMusic(img);
  assert.equal(reading.ok, false);
  assert.equal(reading.reason, REASONS.notationOnly);
  assert.deepEqual(reading.systems.map((s) => s.kind), ["notation"]);
});

test("a blank picture says it is blank", () => {
  const reading = readSheetMusic(createImage(200, 200, 255));
  assert.equal(reading.ok, false);
  assert.equal(reading.reason, REASONS.blank);
});

test("a picture with no staves in it says so", () => {
  const img = createImage(200, 200, 255);
  for (let i = 0; i < 40; i++) fillRect(img, 10 + (i % 8) * 22, 20 + Math.floor(i / 8) * 30, 12, 12, 0);
  const reading = readSheetMusic(img);
  assert.equal(reading.ok, false);
  assert.equal(reading.reason, REASONS.noStaves);
});

test("the same tab reads the same drawn light on dark", () => {
  const tab = ["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n");
  const light = readSheetMusic(renderTab(tab));
  const dark = readSheetMusic(renderTab(tab, { background: 20, foreground: 240 }));
  assert.equal(light.ok, true);
  assert.deepEqual(notesOf(dark.text), notesOf(light.text));
});

test("a stave in the middle of a page is found, furniture and all", () => {
  const tab = ["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n");
  const reading = readSheetMusic(pageAround(renderTab(tab, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 })));
  assert.equal(reading.ok, true);
  assert.equal(reading.strings, 6);
  assert.deepEqual(notesOf(reading.text), notesOf(tab));
});

test("confidence falls when marks cannot be made out", () => {
  const clean = readSheetMusic(renderTab(["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n")));
  assert.ok(clean.confidence > 0.8);
  assert.equal(inkFraction(toInk(createImage(50, 50, 255))), 0);
});

// --------------------------------------------------------------------------
// png.js — only the command line and these tests use it
// --------------------------------------------------------------------------

test("PNG: written and read back unchanged", () => {
  const picture = renderTab(["|--3--5--|", "|--------|", "|--------|", "|--------|", "|--------|", "|--------|"].join("\n"));
  const bytes = writePng(picture);
  assert.equal(isPng(bytes), true);
  const back = readPng(bytes);
  assert.equal(back.width, picture.width);
  assert.equal(back.height, picture.height);
  assert.deepEqual([...back.gray], [...picture.gray]);
});

test("PNG: the project's own screenshots decode", () => {
  const dir = new URL("../docs/screenshots/", import.meta.url).pathname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".png"));
  assert.ok(files.length > 0);
  for (const file of files) {
    const picture = readPng(new Uint8Array(readFileSync(join(dir, file))));
    assert.ok(picture.width > 100 && picture.height > 100, file);
    assert.equal(picture.gray.length, picture.width * picture.height, file);
  }
});

test("PNG: a file cut short after a chunk body is turned down, not decoded", () => {
  // The four bytes after a chunk's body are its CRC. A file that ends where
  // the body ends still has a whole body, so without checking for the CRC the
  // reader would accept the chunk, run out of input, and hand back a picture
  // built from a truncated stream instead of saying the file is broken.
  const picture = renderTab(["|--3--5--|", "|--------|", "|--------|", "|--------|", "|--------|", "|--------|"].join("\n"));
  const bytes = writePng(picture);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let bodyEnd = null;
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === "IDAT") bodyEnd = at + 8 + length;
    at = at + 8 + length + 4;
  }
  assert.ok(bodyEnd, "the fixture should hold an IDAT chunk");
  assert.throws(() => readPng(bytes.subarray(0, bodyEnd)));
});

test("PNG: anything else is turned down with a plain reason", () => {
  assert.equal(isPng(new Uint8Array([1, 2, 3])), false);
  assert.throws(() => readPng(new Uint8Array([1, 2, 3])), /not a PNG/);
});

// --------------------------------------------------------------------------
// Cutting a player out of a photograph of the browser window
// --------------------------------------------------------------------------

test("cropBox: the scale is measured from the photograph, not assumed", () => {
  const rect = { x: 100, y: 50, width: 400, height: 200 };
  const view = { width: 1000, height: 800 };
  // A screen at one device pixel per CSS pixel.
  assert.deepEqual(cropBox(rect, view, 1000, 800), { x: 100, y: 50, width: 400, height: 200 });
  // The same window on a laptop that draws two device pixels for each of
  // them: the photograph is twice the size, and so is everything in it.
  assert.deepEqual(cropBox(rect, view, 2000, 1600), { x: 200, y: 100, width: 800, height: 400 });
});

test("cropBox: a player taller than the window is cut off at the window", () => {
  // Which is the whole reason the popup says "that's about 14% of the song".
  const box = cropBox({ x: -20, y: 600, width: 900, height: 2000 }, { width: 1000, height: 800 }, 1000, 800);
  assert.deepEqual(box, { x: 0, y: 600, width: 880, height: 200 });
});

test("cropBox: nothing comes back for a rectangle that is not in shot", () => {
  const view = { width: 1000, height: 800 };
  assert.equal(cropBox({ x: 0, y: 900, width: 400, height: 200 }, view, 1000, 800), null, "scrolled past the bottom");
  assert.equal(cropBox({ x: -500, y: 10, width: 400, height: 200 }, view, 1000, 800), null, "off to the left");
  assert.equal(cropBox(null, view, 1000, 800), null);
  assert.equal(cropBox({ x: 0, y: 0, width: 10, height: 10 }, null, 1000, 800), null);
});

test("bestReading: the reading with more notes in it wins, and anything beats nothing", () => {
  const poor = { ok: true, notes: 4, confidence: 0.9 };
  const good = { ok: true, notes: 40, confidence: 0.8 };
  const failed = { ok: false, reason: "no-staves" };
  assert.equal(bestReading(poor, good), good);
  assert.equal(bestReading(good, poor), good);
  assert.equal(bestReading(null, poor), poor);
  assert.equal(bestReading(poor, null), poor);
  assert.equal(bestReading(null, null), null);
  assert.equal(bestReading(poor, failed), poor, "a reading is never given up for one that failed");
  assert.equal(bestReading(failed, poor), poor);
});

test("coverageOf: a screenful of a long score is reported as a share of it", () => {
  assert.equal(coverageOf({ top: 0, height: 6503, visible: 935 }), 14);
  assert.equal(coverageOf({ top: 0, height: 1000, visible: 950 }), null, "all of it, near enough, so nothing to say");
  assert.equal(coverageOf(null), null);
});

// --------------------------------------------------------------------------
// Reading a score that does not fit on the screen
// --------------------------------------------------------------------------

/** A staff at a known place in the picture, of the shape readSystem hands back. */
function system(top, bottom, { kind = "tab", spacing = 10, events = 4, bars = 2, unreadable = 0, strings = 6 } = {}) {
  return { kind, strings, spacing, top, bottom, events: new Array(events).fill({ score: 1 }), columns: [], bars: new Array(bars).fill(0), unreadable, marks: events };
}

test("wholeSystems: a staff running off the bottom of the screen is dropped", () => {
  // Six lines cut down to four still group as a staff — a bass, to look at
  // it — so a staff on the fold is music nobody played. The rule is a whole
  // line spacing of clear picture below the last line: if a line could be
  // hiding just off the bottom, this staff is not to be trusted.
  const staves = [system(40, 90), system(200, 250), system(360, 410)];
  assert.deepEqual(wholeSystems(staves, 500).map((s) => s.top), [40, 200, 360]);
  assert.deepEqual(wholeSystems(staves, 420).map((s) => s.top), [40, 200, 360], "exactly one spacing of clear air is enough");
  assert.deepEqual(wholeSystems(staves, 419).map((s) => s.top), [40, 200], "one pixel less is not");
  assert.deepEqual(wholeSystems(staves, 260).map((s) => s.top), [40, 200]);
  assert.deepEqual(wholeSystems(staves, 0).map((s) => s.top), [40, 200, 360], "no height, nothing to be cut off by");
});

test("wholeSystems: the top edge is left alone", () => {
  // The scroll lands the next staff hard against the top of the picture on
  // purpose. Trimming there would drop the bars the scroll was made to reach.
  const staves = [system(0, 50), system(200, 250)];
  assert.equal(wholeSystems(staves, 500).length, 2);
});

test("readTo: the next look starts past the last whole staff", () => {
  const staves = [system(40, 90), system(200, 250), system(360, 410)];
  // Past the bottom of the last whole staff, clear of its own lines.
  assert.equal(readTo(staves, 419), 260);
  assert.equal(readTo(staves, 500), 420);
  // Never past the end of the picture, because a staff is only kept when
  // that much clear picture was found below it.
  assert.equal(readTo([system(40, 85)], 100), 95);
  // A picture with nothing whole in it has nothing to measure from.
  assert.equal(readTo([system(40, 495)], 500), null);
  assert.equal(readTo([], 500), null);
});

test("wholeReading: a screenful is cut down to the staves that were whole", () => {
  // A real picture of two staves, read for real, then told the screen ended
  // part-way down the second one — which is what a tab player looks like.
  const two = ["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n");
  const picture = renderTab([two, two].join("\n\n"), { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const reading = readSheetMusic(picture);
  assert.equal(reading.staves, 2);

  const whole = wholeReading({ ...reading, height: reading.systems[1].bottom });
  assert.equal(whole.staves, 1, "the second one runs off the bottom of the screen");
  assert.equal(whole.text.split("\n").length, 6, "one staff, six strings");
  assert.equal(whole.text, reading.text.split("\n\n")[0]);
  assert.ok(whole.notes > 0 && whole.notes < reading.notes);

  // Nothing whole, nothing to keep — and never an empty success.
  assert.equal(wholeReading({ ...reading, height: reading.systems[0].bottom }), null);
  assert.equal(wholeReading({ ok: false, reason: "no-staves" }), null);
  assert.equal(wholeReading(null), null);
});

test("wholeReading: how sure it is follows the staves that were kept", () => {
  const two = ["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n");
  const picture = renderTab([two, two].join("\n\n"), { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const reading = readSheetMusic(picture);
  assert.equal(reading.staves, 2);

  // Make the staff that runs off the bottom of the screen the badly-read one:
  // marks matched only loosely, and five it could not make out at all.
  const cut = reading.systems[1];
  for (const event of cut.events) event.score = 0.1;
  cut.unreadable = 5;
  const tabs = reading.systems.filter((s) => s.kind === "tab");
  const spoiled = { ...reading, unreadable: 5, confidence: confidenceOf(tabs, 5, reading.notes) };
  assert.ok(spoiled.confidence < 0.6, `the picture as a whole now reads badly (${spoiled.confidence})`);

  // Trimmed to the one whole staff, none of that is in what was kept, so
  // none of it may be in how sure the reader says it is.
  const whole = wholeReading({ ...spoiled, height: cut.bottom });
  assert.equal(whole.staves, 1);
  assert.equal(whole.unreadable, 0, "not one of the marks it gave up on was kept");
  assert.ok(whole.confidence > 0.8, `the kept staff read perfectly, so it should say so (${whole.confidence})`);
  assert.equal(whole.confidence, confidenceOf(whole.systems, 0, whole.notes));
});

test("stitchReads: the screenfuls join in the order they were read", () => {
  const stitched = stitchReads([
    { ok: true, text: "|--0--|", notes: 2, bars: 1, staves: 1, strings: 6, unreadable: 0, confidence: 1 },
    { ok: true, text: "|--3--|", notes: 4, bars: 1, staves: 1, strings: 6, unreadable: 1, confidence: 0.5 },
  ]);
  assert.equal(stitched.ok, true);
  assert.equal(stitched.text, "|--0--|\n\n|--3--|");
  assert.equal(stitched.screenfuls, 2);
  assert.equal(stitched.notes, 6);
  assert.equal(stitched.bars, 2);
  assert.equal(stitched.unreadable, 1);
  // Weighted by notes: four notes read at half confidence and two read sure.
  assert.equal(stitched.confidence, (1 * 2 + 0.5 * 4) / 6);
  // The whole song was read, so there is no share of it left to report.
  assert.equal(stitched.scroll, null);
});

test("stitchReads: a page that did not move is not read twice", () => {
  const same = { ok: true, text: "|--0--|", notes: 2, bars: 1, staves: 1, strings: 6, unreadable: 0, confidence: 1 };
  const stitched = stitchReads([same, { ...same }, { ok: false, reason: "no-staves" }, { ok: true, text: "  ", notes: 0 }]);
  assert.equal(stitched.text, "|--0--|");
  assert.equal(stitched.screenfuls, 1);
  assert.equal(stitched.notes, 2, "the counts follow the tab, not the work it took");
});

test("stitchReads: nothing readable anywhere is a failure with a reason", () => {
  const stitched = stitchReads([{ ok: false, reason: "no-staves" }]);
  assert.equal(stitched.ok, false);
  assert.equal(stitched.reason, "no-notes");
  assert.equal(stitched.text, "");
  assert.equal(stitchReads([]).ok, false);
});

test("readSheetMusic says how big the picture was, so a staff on the fold can be spotted", () => {
  const picture = renderTab(["|--0--2--3--|", "|-----------|", "|--2--2--2--|", "|-----------|", "|-----------|", "|--3--------|"].join("\n"), {
    spacing: 15,
    columnWidth: 8,
    digitHeight: 11,
    digitWidth: 7,
  });
  const reading = readSheetMusic(picture);
  assert.equal(reading.ok, true);
  assert.equal(reading.width, picture.width);
  assert.equal(reading.height, picture.height);
  // Every staff in it is whole, so trimming takes nothing away.
  assert.equal(wholeReading(reading).text, reading.text);
});
