import { test } from "node:test";
import assert from "node:assert/strict";
import { arrange, analyzeChord, voicePad, toBassRange, groupByStart, buildLeadTrack, CHORD_LOW, CHORD_HIGH, BASS_LOW, BASS_HIGH } from "../src/arrange/index.js";

const note = (midi, start, length = 1, technique = null) => ({ midi, start, length, velocity: 0.8, technique });
const ir = (notes) => ({ version: 1, tracks: [{ role: "guitar", notes }], tuning: [40, 45, 50, 55, 59, 64] });

test("analyzeChord: finds the root and keeps root, third, fifth, seventh", () => {
  // Open C chord: C E G C E
  assert.deepEqual(analyzeChord([48, 52, 55, 60, 64]), { root: 0, intervals: [0, 4, 7] });
  // A minor: A E A C E
  assert.deepEqual(analyzeChord([45, 52, 57, 60, 64]), { root: 9, intervals: [0, 3, 7] });
  // G7: G B D G B F
  assert.deepEqual(analyzeChord([43, 47, 50, 55, 59, 65]), { root: 7, intervals: [0, 4, 7, 10] });
  // Power chord E5
  assert.deepEqual(analyzeChord([40, 47, 52]), { root: 4, intervals: [0, 7] });
  // First inversion C/E: lowest note is E but the chord is still C major.
  assert.deepEqual(analyzeChord([52, 55, 60, 64]), { root: 0, intervals: [0, 4, 7] });
  // B diminished
  assert.deepEqual(analyzeChord([47, 50, 53]), { root: 11, intervals: [0, 3, 6] });
});

test("voicePad keeps everything in 60..84 with the root in the first octave", () => {
  for (const root of [0, 5, 7, 11]) {
    const notes = voicePad({ root, intervals: [0, 4, 7, 11] });
    assert.ok(notes.every((n) => n >= CHORD_LOW && n <= CHORD_HIGH), String(notes));
    assert.equal(notes[0] % 12, root);
    assert.ok(notes[0] < CHORD_LOW + 12);
    assert.equal(new Set(notes.map((n) => n % 12)).size, notes.length, "no doubled octaves");
  }
});

test("toBassRange moves any pitch into 36..48", () => {
  for (const m of [0, 28, 35, 36, 48, 49, 64, 100]) {
    const b = toBassRange(m);
    assert.ok(b >= BASS_LOW && b <= BASS_HIGH, `${m} -> ${b}`);
    assert.equal(Math.abs(b - m) % 12, 0);
  }
});

test("groupByStart groups simultaneous notes, lowest first, in time order", () => {
  const groups = groupByStart([note(64, 1), note(40, 0), note(52, 0), note(45, 0)]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].map((n) => n.midi), [40, 45, 52]);
  assert.deepEqual(groups[1].map((n) => n.midi), [64]);
});

test("arrange: chord groups make a chords track and a bass track", () => {
  const out = arrange(ir([note(48, 0, 4), note(52, 0, 4), note(55, 0, 4), note(60, 0, 4)]));
  const chords = out.tracks.find((t) => t.role === "chords");
  const bass = out.tracks.find((t) => t.role === "bass");
  assert.deepEqual(chords.notes.map((n) => n.midi), [60, 64, 67]);
  assert.equal(chords.notes[0].length, 4);
  assert.deepEqual(bass.notes.map((n) => n.midi), [48]);
  assert.equal(out.tracks.find((t) => t.role === "lead"), undefined);
  // The input is untouched.
  assert.equal(out.tracks[0].notes.length, 4);
});

test("arrange: a two-note power chord counts as a chord; other dyads do not", () => {
  const power = arrange(ir([note(40, 0), note(47, 0)]));
  assert.deepEqual(power.tracks.find((t) => t.role === "chords").notes.map((n) => n.midi), [64, 71]);
  const third = arrange(ir([note(40, 0), note(44, 0)]));
  assert.equal(third.tracks.find((t) => t.role === "chords"), undefined);
  assert.equal(third.tracks.find((t) => t.role === "bass").notes.length, 1);
});

test("arrange: runs of more than four single notes become the lead track", () => {
  const four = arrange(ir([note(60, 0), note(62, 1), note(64, 2), note(65, 3)]));
  assert.equal(four.tracks.find((t) => t.role === "lead"), undefined);
  const five = arrange(ir([note(60, 0), note(62, 1), note(64, 2), note(65, 3), note(67, 4)]));
  assert.deepEqual(five.tracks.find((t) => t.role === "lead").notes.map((n) => n.midi), [60, 62, 64, 65, 67]);
  // A chord in the middle breaks the run.
  const broken = arrange(ir([note(60, 0), note(62, 1), note(64, 2), note(40, 3), note(47, 3), note(52, 3), note(65, 4), note(67, 5)]));
  assert.equal(broken.tracks.find((t) => t.role === "lead"), undefined);
});

test("arrange: empty tracks are skipped; muted notes never lead or drive the bass", () => {
  const out = arrange(ir([note(40, 0, 0.25, "mute"), note(40, 1, 0.25, "mute"), note(40, 2, 0.25, "mute"), note(40, 3, 0.25, "mute"), note(40, 4, 0.25, "mute")]));
  assert.deepEqual(out.tracks.map((t) => t.role), ["guitar"]);
  assert.deepEqual(buildLeadTrack([[note(40, 0, 1, "mute")]]), []);
});

test("arrange: an IR without a guitar track passes through", () => {
  const out = arrange({ tracks: [] });
  assert.deepEqual(out.tracks, []);
});
