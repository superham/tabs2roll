import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertText, ParseError } from "../src/pipeline.js";
import { readMidi } from "./helpers/midi-read.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

test("convertText: text in, MIDI bytes and a filename out", () => {
  const r = convertText(fixture("greensleeves"), { source: "paste" });
  assert.equal(r.filename, "Greensleeves (tab).mid");
  const file = readMidi(r.bytes);
  assert.equal(file.format, 1);
  assert.deepEqual(file.tracks[0].timeSignature, [3, 4]);
  assert.equal(r.summary.kind, "tab");
  assert.equal(r.summary.rhythmSource, "guessed");
  assert.equal(r.summary.tuningId, "standard");
  assert.ok(r.summary.tracks.includes("Guitar (as tabbed)"));
});

test("convertText: page metadata wins over the text and shapes the filename", () => {
  const r = convertText(fixture("ode-to-joy"), { source: "ultimate-guitar", title: "Ode To Joy", artist: "Beethoven", tempo: 80 });
  assert.equal(r.filename, "Beethoven - Ode To Joy (tab).mid");
  assert.equal(readMidi(r.bytes).tracks[0].tempo, 80);
});

test("convertText: tuning override and filename suffix", () => {
  const r = convertText(fixture("no-labels"), { tuningId: "drop-d", filenameSuffix: "Drop D" });
  assert.equal(r.summary.tuningId, "drop-d");
  assert.deepEqual(r.summary.tuningNotes, [38, 45, 50, 55, 59, 64]);
  assert.equal(r.filename, "Riff with no string labels (tab, Drop D).mid");
});

test("convertText: arrange can be turned off", () => {
  const r = convertText(fixture("power-chords"), { arrange: false });
  assert.deepEqual(r.summary.tracks, ["Guitar (as tabbed)"]);
});

test("convertText: chord sheets report their kind", () => {
  const r = convertText(fixture("amazing-grace-chords"));
  assert.equal(r.summary.kind, "chords");
  assert.deepEqual(r.summary.tracks, ["Guitar (as tabbed)", "Chords", "Bass"]);
});

test("convertText: errors carry a code, never a stack for the UI", () => {
  assert.throws(() => convertText("nothing here"), (err) => err instanceof ParseError && err.code === "no-tab");
  const empty = "e|--------|\nB|--------|\nG|--------|\nD|--------|\nA|--------|\nE|--------|";
  assert.throws(() => convertText(empty), (err) => err instanceof ParseError && err.code === "no-notes");
});
