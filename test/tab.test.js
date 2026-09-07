import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyLine, findStaves, splitDigitRun, scanLine, estimateUnit, layoutStave, parseTab } from "../src/parse/tab.js";
import { splitLines } from "../src/parse/text.js";

test("classifyLine: accepts the common string-line shapes", () => {
  const a = classifyLine("e|--0--2--3--|");
  assert.equal(a.label, "e");
  assert.equal(a.sep, "|");
  assert.equal(a.body, "--0--2--3--|");
  assert.equal(a.bodyStart, 2);

  assert.equal(classifyLine("E |---3---").label, "E");
  assert.equal(classifyLine("D#|-5---5--").label, "D#");
  assert.equal(classifyLine("1|--7--7--").label, "1");
  assert.equal(classifyLine("|--5--7--|").label, null);
  assert.equal(classifyLine("|--5--7--|").sep, "|");
  assert.equal(classifyLine("   ----0----2----").label, null);
  assert.equal(classifyLine("   ----0----2----").bodyStart, 3);
  assert.equal(classifyLine("A-5-7-5---").label, "A");
  assert.equal(classifyLine("e|:--0--2--:|").sep, "|:");
});

test("classifyLine: keeps a trailing annotation out of the body", () => {
  const l = classifyLine("E|--3--3--3--3-- (let ring)");
  assert.equal(l.body, "--3--3--3--3-- (");
  assert.equal(l.annotation, "let ring)");
  const x2 = classifyLine("e|--0--0--|x2");
  assert.equal(x2.body, "--0--0--|x2");
});

test("classifyLine: rejects prose, chord names, and rhythm lines", () => {
  for (const line of [
    "Amazing grace, how sweet the sound",
    "   Am        C        G",
    "B--- baby",
    "D-day is here again",
    "E-strings vibrate when plucked",
    "Baby---",
    "   PM------------------",
    "  v  ^  v  ^",
    "Am: x02210",
    "",
    "----",
    "5h5h5h5h5h5h5",
  ]) {
    assert.equal(classifyLine(line), null, JSON.stringify(line));
  }
});

test("findStaves: groups consecutive string lines, splits on blank lines and lyrics", () => {
  const text = [
    "Some header",
    "e|--0--|",
    "B|--1--|",
    "G|--2--|",
    "D|-----|",
    "A|-----|",
    "E|-----|",
    "",
    "a lyric line",
    "e|--3--|",
    "B|--3--|",
    "G|--4--|",
    "D|-----|",
    "A|-----|",
    "E|-----|",
  ].join("\n");
  const staves = findStaves(splitLines(text));
  assert.equal(staves.length, 2);
  assert.equal(staves[0].lines.length, 6);
  assert.equal(staves[0].firstLine, 1);
  assert.equal(staves[1].firstLine, 9);
});

test("findStaves: splits a 12-line block into two staves using labels", () => {
  const lines = [];
  for (let i = 0; i < 2; i++) for (const l of ["e", "B", "G", "D", "A", "E"]) lines.push(`${l}|--${i}--|`);
  const staves = findStaves(lines);
  assert.equal(staves.length, 2);
  assert.equal(staves[1].lines[0].label, "e");
});

test("findStaves: splits an unlabelled 12-line block into two 6-line staves", () => {
  const lines = Array.from({ length: 12 }, (_, i) => `---${i % 6}---`);
  const staves = findStaves(lines);
  assert.equal(staves.length, 2);
});

test("findStaves: trims separator lines glued to a stave and ignores lone separators", () => {
  const text = ["------------------", "e|--0--|", "B|--1--|", "G|--2--|", "D|-----|", "A|-----|", "E|-----|", "------------------", "", "------------------"].join("\n");
  const staves = findStaves(splitLines(text));
  assert.equal(staves.length, 1);
  assert.equal(staves[0].lines.length, 6);
});

test("findStaves: a two-line block is not a stave", () => {
  assert.equal(findStaves(["e|--0--|", "B|--1--|"]).length, 0);
});

test("splitDigitRun: two-digit frets start with 1 or 2", () => {
  assert.deepEqual(splitDigitRun("12"), [{ offset: 0, fret: 12 }]);
  assert.deepEqual(splitDigitRun("120"), [
    { offset: 0, fret: 12 },
    { offset: 2, fret: 0 },
  ]);
  assert.deepEqual(splitDigitRun("012"), [
    { offset: 0, fret: 0 },
    { offset: 1, fret: 12 },
  ]);
  assert.deepEqual(splitDigitRun("333"), [
    { offset: 0, fret: 3 },
    { offset: 1, fret: 3 },
    { offset: 2, fret: 3 },
  ]);
  assert.deepEqual(splitDigitRun("25"), [
    { offset: 0, fret: 2 },
    { offset: 1, fret: 5 },
  ]);
  assert.deepEqual(splitDigitRun("24"), [{ offset: 0, fret: 24 }]);
});

test("scanLine: frets, techniques, ghost notes, mutes and bar lines", () => {
  const { events, barCols } = scanLine("--5h7--7p5--(8)--x--12/14--7b9r7~--|--3--|x2");
  const frets = events.map((e) => e.fret);
  assert.deepEqual(frets, [5, 7, 7, 5, 8, 0, 12, 14, 7, 9, 7, 3]);
  assert.equal(events[1].technique, "hammer");
  assert.equal(events[3].technique, "pull");
  assert.equal(events[4].technique, "ghost");
  assert.equal(events[5].technique, "mute");
  assert.equal(events[7].technique, "slide");
  assert.equal(events[8].technique, "bend");
  assert.equal(events[9].technique, "bend-target");
  assert.equal(events[10].technique, "release");
  assert.equal(events[6].col, "--5h7--7p5--(8)--x--".length);
  assert.deepEqual(barCols, ["--5h7--7p5--(8)--x--12/14--7b9r7~--".length, "--5h7--7p5--(8)--x--12/14--7b9r7~--|--3--".length]);
  // "x2" after the final bar has no dash next to it, so it is not a mute.
  assert.equal(events.filter((e) => e.technique === "mute").length, 1);
});

test("scanLine: vibrato attaches to the previous note; harmonics are flagged", () => {
  const { events } = scanLine("--7~--<12>--");
  assert.equal(events[0].technique, "vibrato");
  assert.equal(events[1].technique, "harmonic");
  assert.equal(events[1].fret, 12);
});

test("estimateUnit: most common gap wins, ties go to the smaller gap", () => {
  assert.equal(estimateUnit(new Map([[2, 10], [3, 4], [6, 3]])), 2);
  assert.equal(estimateUnit(new Map([[3, 5], [2, 5]])), 2);
  assert.equal(estimateUnit(new Map()), 3);
});

test("layoutStave: evenly spaced notes land on the grid and bars snap to whole bars", () => {
  const lines = ["--5--7--5--7--|--3--3--3--3--|", "--------------|--------------|", "--------------|--------------|"].map((l) => classifyLine(l));
  const layout = layoutStave({ lines }, { unit: 3, stepBeats: 0.5, beatsPerBar: 4 });
  assert.deepEqual(
    layout.notes.map((n) => n.beat),
    [0, 0.5, 1, 1.5, 4, 4.5, 5, 5.5],
  );
  assert.equal(layout.length, 8);
});

test("layoutStave: leading padding longer than a unit becomes a rest", () => {
  const lines = ["-------5--7--|", "-------------|", "-------------|"].map((l) => classifyLine(l));
  const layout = layoutStave({ lines }, { unit: 3, stepBeats: 0.5, beatsPerBar: 4 });
  assert.deepEqual(
    layout.notes.map((n) => n.beat),
    [1, 1.5],
  );
});

test("layoutStave: a slightly squeezed hammer-on still reads as even steps", () => {
  const lines = ["--5h7--9--|", "----------|", "----------|"].map((l) => classifyLine(l));
  const layout = layoutStave({ lines }, { unit: 3, stepBeats: 0.5, beatsPerBar: 4 });
  assert.deepEqual(
    layout.notes.map((n) => n.beat),
    [0, 0.5, 1],
  );
});

test("layoutStave: a clearly squeezed hammer-on becomes a quick note into a longer one", () => {
  const lines = ["----5h7----9----|", "----------------|", "----------------|"].map((l) => classifyLine(l));
  const layout = layoutStave({ lines }, { unit: 4, stepBeats: 0.5, beatsPerBar: 4 });
  assert.deepEqual(
    layout.notes.map((n) => n.beat),
    [0.5, 0.75, 1.25],
  );
});

test("layoutStave: an empty bar between notes is a bar of rest", () => {
  const lines = ["--5--|-----|--7--|", "-----|-----|-----|", "-----|-----|-----|"].map((l) => classifyLine(l));
  const layout = layoutStave({ lines }, { unit: 2, stepBeats: 0.5, beatsPerBar: 4 });
  assert.deepEqual(
    layout.notes.map((n) => n.beat),
    [0.5, 8.5],
  );
  assert.equal(layout.length, 12);
});

test("parseTab: pitches use midi = openString + fret, high string on top", () => {
  const text = "e|--0--|\nB|--1--|\nG|--2--|\nD|--2--|\nA|--0--|\nE|-----|";
  // (one column of notes: no spacing to measure, so the default unit applies)
  const r = parseTab(text);
  assert.equal(r.staveCount, 1);
  assert.deepEqual(
    r.notes.map((n) => n.midi).sort((a, b) => a - b),
    [45, 52, 57, 60, 64],
  );
  assert.ok(r.notes.every((n) => n.start === 0));
  assert.deepEqual(r.tuning, [40, 45, 50, 55, 59, 64]);
});

test("parseTab: note length runs until the next note on the same string, capped at a bar", () => {
  const text = "e|--0-----0--|--0--0--0--|\nB|-----------|-----------|\nG|-----------|-----------|\nD|-----------|-----------|\nA|-----------|-----------|\nE|-----------|-----------|";
  const r = parseTab(text);
  assert.equal(r.notes.length, 5);
  assert.deepEqual(
    r.notes.map((n) => n.start),
    [0, 1, 4, 4.5, 5],
  );
  assert.equal(r.notes[0].length, 1);
  assert.equal(r.notes[1].length, 3);
  assert.equal(r.notes[4].length, 4);
});

test("parseTab: staves are laid out one after another", () => {
  const stave = "e|--0--0--0--0--|\nB|--------------|\nG|--------------|\nD|--------------|\nA|--------------|\nE|--------------|";
  const r = parseTab(stave + "\n\n" + stave);
  assert.equal(r.staveCount, 2);
  assert.equal(r.notes.length, 8);
  assert.equal(r.notes[4].start, 4);
  assert.equal(r.totalBeats, 8);
});

test("parseTab: user-selected step changes the timing", () => {
  const text = "e|--0--0--0--0--|\nB|--------------|\nG|--------------|\nD|--------------|\nA|--------------|\nE|--------------|";
  assert.equal(parseTab(text, { step: "1/4" }).notes[1].start, 1);
  assert.equal(parseTab(text, { step: "1/8" }).notes[1].start, 0.5);
  assert.equal(parseTab(text, { step: "1/16" }).notes[1].start, 0.25);
});

test("parseTab: 3/4 time makes three-beat bars", () => {
  const text = "e|--0--0--0--|--0--0--0--|\nB|-----------|-----------|\nG|-----------|-----------|\nD|-----------|-----------|\nA|-----------|-----------|\nE|-----------|-----------|";
  const r = parseTab(text, { timeSignature: [3, 4] });
  assert.equal(r.notes[3].start, 3);
  assert.equal(r.totalBeats, 6);
});

test("parseTab: nothing tab-like gives zero staves", () => {
  const r = parseTab("Hello\nworld");
  assert.equal(r.staveCount, 0);
  assert.equal(r.notes.length, 0);
});
