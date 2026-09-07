import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChordSymbol, chordLine, chordStats, voiceChord, parseChordSheet } from "../src/parse/chords.js";

test("parseChordSymbol: qualities and extensions", () => {
  assert.deepEqual(parseChordSymbol("C").intervals, [0, 4, 7]);
  assert.deepEqual(parseChordSymbol("Am").intervals, [0, 3, 7]);
  assert.deepEqual(parseChordSymbol("F#m7").intervals, [0, 3, 7, 10]);
  assert.deepEqual(parseChordSymbol("G7").intervals, [0, 4, 7, 10]);
  assert.deepEqual(parseChordSymbol("Dmaj7").intervals, [0, 4, 7, 11]);
  assert.deepEqual(parseChordSymbol("Bdim").intervals, [0, 3, 6]);
  assert.deepEqual(parseChordSymbol("Caug").intervals, [0, 4, 8]);
  assert.deepEqual(parseChordSymbol("Dsus4").intervals, [0, 5, 7]);
  assert.deepEqual(parseChordSymbol("Dsus2").intervals, [0, 2, 7]);
  assert.deepEqual(parseChordSymbol("Asus").intervals, [0, 5, 7]);
  assert.deepEqual(parseChordSymbol("A5").intervals, [0, 7]);
  assert.deepEqual(parseChordSymbol("Cadd9").intervals, [0, 4, 7, 14]);
  assert.deepEqual(parseChordSymbol("E9").intervals, [0, 4, 7, 10, 14]);
  assert.equal(parseChordSymbol("Bb").rootPc, 10);
  assert.equal(parseChordSymbol("D/F#").bassPc, 6);
  assert.equal(parseChordSymbol("D/F#").rootPc, 2);
  assert.equal(parseChordSymbol("Hello"), null);
  assert.equal(parseChordSymbol("Amazing"), null);
  assert.equal(parseChordSymbol("A-"), null);
});

test("chordLine: chords with fillers, not lyrics", () => {
  assert.equal(chordLine("G           G7        C         G").length, 4);
  assert.equal(chordLine("Intro: C G Am F").length, 4);
  assert.equal(chordLine("| C | G | Am | F | x2").length, 4);
  assert.equal(chordLine("Am I wrong"), null);
  assert.equal(chordLine("Amazing grace, how sweet the sound"), null);
  assert.equal(chordLine("[Verse 1]"), null);
  assert.equal(chordLine("Chorus:"), null);
  assert.equal(chordLine(""), null);
});

test("chordStats counts lines and symbols", () => {
  const { chordLines, chords } = chordStats(["C G", "lyrics", "Am F G", "[Chorus]"]);
  assert.equal(chordLines, 2);
  assert.equal(chords, 5);
});

test("voiceChord: guitar-style voicing with a low root and a doubled octave", () => {
  assert.deepEqual(voiceChord(parseChordSymbol("C")), [48, 52, 55, 60]);
  assert.deepEqual(voiceChord(parseChordSymbol("G")), [43, 47, 50, 55]);
  assert.deepEqual(voiceChord(parseChordSymbol("Am")), [45, 48, 52, 57]);
  // Slash chord: the bass note sits below the root.
  assert.deepEqual(voiceChord(parseChordSymbol("D/F#")), [42, 50, 54, 57, 62]);
});

test("parseChordSheet: one chord per bar in document order", () => {
  const r = parseChordSheet("Am  C\nsome lyric\nG   F\n");
  assert.equal(r.chordCount, 4);
  assert.equal(r.lineCount, 2);
  assert.equal(r.totalBeats, 16);
  const starts = [...new Set(r.notes.map((n) => n.start))];
  assert.deepEqual(starts, [0, 4, 8, 12]);
  assert.ok(r.notes.every((n) => n.length === 4));
  assert.equal(r.notes[0].chord, "Am");
});

test("parseChordSheet: honours the time signature", () => {
  const r = parseChordSheet("C G", { timeSignature: [3, 4] });
  assert.deepEqual([...new Set(r.notes.map((n) => n.start))], [0, 3]);
});
