import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STANDARD_GUITAR,
  parseTuningText,
  tuningFromLabels,
  resolveTuning,
  nearestNotesToReference,
  noteNameToPitchClass,
  identifyTuning,
  tuningById,
  SELECTABLE_TUNING_IDS,
} from "../src/parse/tuning.js";

test("reference data: standard tuning is E2 A2 D3 G3 B3 E4", () => {
  assert.deepEqual(STANDARD_GUITAR, [40, 45, 50, 55, 59, 64]);
  assert.deepEqual(tuningById("drop-d").notes, [38, 45, 50, 55, 59, 64]);
  assert.deepEqual(tuningById("eb-standard").notes, STANDARD_GUITAR.map((n) => n - 1));
  assert.deepEqual(tuningById("d-standard").notes, STANDARD_GUITAR.map((n) => n - 2));
  assert.deepEqual(tuningById("dadgad").notes, [38, 45, 50, 55, 57, 62]);
  assert.deepEqual(tuningById("open-g").notes, [38, 43, 50, 55, 59, 62]);
  assert.deepEqual(tuningById("open-d").notes, [38, 45, 50, 54, 57, 62]);
  for (const id of SELECTABLE_TUNING_IDS) assert.ok(tuningById(id), id);
});

test("noteNameToPitchClass", () => {
  assert.equal(noteNameToPitchClass("C"), 0);
  assert.equal(noteNameToPitchClass("e"), 4);
  assert.equal(noteNameToPitchClass("F#"), 6);
  assert.equal(noteNameToPitchClass("Bb"), 10);
  assert.equal(noteNameToPitchClass("Cb"), 11);
  assert.equal(noteNameToPitchClass("H"), null);
  assert.equal(noteNameToPitchClass("Am"), null);
});

test("parseTuningText: names and phrases", () => {
  assert.equal(parseTuningText("Standard").id, "standard");
  assert.equal(parseTuningText("Drop D").id, "drop-d");
  assert.equal(parseTuningText("drop d (DADGBE)").id, "drop-d");
  assert.equal(parseTuningText("Eb Standard").id, "eb-standard");
  assert.equal(parseTuningText("half step down").id, "eb-standard");
  assert.equal(parseTuningText("Tuned 1/2 step down").id, "eb-standard");
  assert.equal(parseTuningText("D Standard (whole step down)").id, "d-standard");
  assert.equal(parseTuningText("DADGAD").id, "dadgad");
  assert.equal(parseTuningText("Open G").id, "open-g");
  assert.equal(parseTuningText("open d").id, "open-d");
  assert.equal(parseTuningText("Drop C#").id, "drop-c#");
  assert.equal(parseTuningText("Drop C").id, "drop-c");
  assert.equal(parseTuningText("drop dead gorgeous"), null);
  assert.equal(parseTuningText("open ground"), null);
  assert.equal(parseTuningText(""), null);
});

test("parseTuningText: explicit note lists", () => {
  assert.deepEqual(parseTuningText("E A D G B E").notes, STANDARD_GUITAR);
  assert.deepEqual(parseTuningText("EADGBe").notes, STANDARD_GUITAR);
  assert.deepEqual(parseTuningText("D-A-D-G-A-D").notes, [38, 45, 50, 55, 57, 62]);
  assert.equal(parseTuningText("D A D G A D").id, "dadgad");
  assert.deepEqual(parseTuningText("Eb Ab Db Gb Bb Eb").notes, [39, 44, 49, 54, 58, 63]);
  assert.deepEqual(parseTuningText("C G C F A D").notes, [36, 43, 48, 53, 57, 62]);
});

test("parseTuningText: relative shifts", () => {
  assert.deepEqual(parseTuningText("tuned down 1 and a half steps"), { shift: -3 });
  assert.deepEqual(parseTuningText("2 steps down"), { id: "c-standard", notes: [36, 41, 46, 51, 55, 60] });
});

test("nearestNotesToReference computes DADGAD, open G and open D properly", () => {
  const pcs = (s) => s.split(" ").map(noteNameToPitchClass);
  assert.deepEqual(nearestNotesToReference(pcs("D A D G A D"), STANDARD_GUITAR), [38, 45, 50, 55, 57, 62]);
  assert.deepEqual(nearestNotesToReference(pcs("D G D G B D"), STANDARD_GUITAR), [38, 43, 50, 55, 59, 62]);
  assert.deepEqual(nearestNotesToReference(pcs("D A D F# A D"), STANDARD_GUITAR), [38, 45, 50, 54, 57, 62]);
});

test("tuningFromLabels: high string on top is the default reading", () => {
  const r = tuningFromLabels(["e", "B", "G", "D", "A", "E"]);
  assert.deepEqual(r.notes, STANDARD_GUITAR);
  assert.equal(r.reversed, false);
  assert.equal(r.id, "standard");
});

test("tuningFromLabels: low string on top is detected", () => {
  const r = tuningFromLabels(["E", "A", "D", "G", "B", "e"]);
  assert.deepEqual(r.notes, STANDARD_GUITAR);
  assert.equal(r.reversed, true);
});

test("tuningFromLabels: all-caps standard reads as high on top", () => {
  const r = tuningFromLabels(["E", "B", "G", "D", "A", "E"]);
  assert.equal(r.reversed, false);
  assert.deepEqual(r.notes, STANDARD_GUITAR);
});

test("tuningFromLabels: drop D, DADGAD, bass and ukulele", () => {
  assert.equal(tuningFromLabels(["e", "B", "G", "D", "A", "D"]).id, "drop-d");
  const dadgad = tuningFromLabels(["d", "A", "G", "D", "A", "D"]);
  assert.deepEqual(dadgad.notes, [38, 45, 50, 55, 57, 62]);
  assert.equal(dadgad.reversed, false);
  const bass = tuningFromLabels(["G", "D", "A", "E"]);
  assert.deepEqual(bass.notes, [28, 33, 38, 43]);
  const uke = tuningFromLabels(["A", "E", "C", "G"]);
  assert.deepEqual(uke.notes, [67, 60, 64, 69]);
  assert.equal(tuningFromLabels(["1", "2", "3"]), null);
  assert.equal(tuningFromLabels(null), null);
});

test("resolveTuning: precedence is override > header > labels > default; capo raises all", () => {
  const labels = ["e", "B", "G", "D", "A", "D"];
  assert.equal(resolveTuning({ header: null, labels, count: 6 }).id, "drop-d");
  assert.equal(resolveTuning({ header: { notes: tuningById("open-g").notes, id: "open-g" }, labels, count: 6 }).id, "open-g");
  assert.deepEqual(resolveTuning({ header: null, labels, count: 6, override: STANDARD_GUITAR }).notes, STANDARD_GUITAR);
  assert.deepEqual(resolveTuning({ header: null, labels: null, count: 4 }).notes, [28, 33, 38, 43]);
  assert.deepEqual(resolveTuning({ header: { shift: -1 }, labels: null, count: 4 }).notes, [27, 32, 37, 42]);
  assert.deepEqual(resolveTuning({ header: null, labels: null, count: 6, capo: 2 }).notes, STANDARD_GUITAR.map((n) => n + 2));
  // A six-string header on a four-line stave is ignored in favour of the bass default.
  assert.deepEqual(resolveTuning({ header: { notes: STANDARD_GUITAR, id: "standard" }, labels: null, count: 4 }).notes, [28, 33, 38, 43]);
});

test("identifyTuning", () => {
  assert.equal(identifyTuning([38, 45, 50, 55, 59, 64]).id, "drop-d");
  assert.equal(identifyTuning([1, 2, 3]), null);
});
