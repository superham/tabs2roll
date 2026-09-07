// Golden-file tests: every test/fixtures/*.txt has a *.expected.json next to
// it. Regenerate with `npm run goldens` and review the diff.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { goldenFor } from "./helpers/golden.js";

const dir = new URL("./fixtures/", import.meta.url).pathname;
const names = readdirSync(dir).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));

test("there are enough fixtures to trust the parser", () => {
  assert.ok(names.length >= 15, `${names.length} fixtures`);
});

for (const name of names) {
  test(`fixture: ${name}`, () => {
    const text = readFileSync(join(dir, name + ".txt"), "utf8");
    const expected = JSON.parse(readFileSync(join(dir, name + ".expected.json"), "utf8"));
    assert.deepEqual(goldenFor(text), expected);
  });
}

// A few hand-checked facts that do not depend on the golden files.
const fixture = (name) => readFileSync(join(dir, name + ".txt"), "utf8");

test("ode-to-joy: 30 notes on the B string, E4 first, C4 last", () => {
  const g = goldenFor(fixture("ode-to-joy"));
  assert.equal(g.noteCount, 30);
  assert.equal(g.firstMidi, 64);
  assert.equal(g.lastMidi, 60);
  assert.equal(g.staves, 2);
  assert.equal(g.tempo, 100);
  assert.equal(g.totalBeats, 16);
});

test("techniques: every technique survives as a plain note with a label", () => {
  const g = goldenFor(fixture("techniques"));
  assert.equal(g.noteCount, 15);
  assert.deepEqual(g.techniques, { hammer: 1, pull: 1, ghost: 1, slide: 2, bend: 1, "bend-target": 1, release: 1, mute: 1 });
});

test("tempo-and-capo: capo 2 raises every pitch by two semitones", () => {
  const g = goldenFor(fixture("tempo-and-capo"));
  assert.equal(g.tempo, 96);
  assert.deepEqual(g.tuning, [42, 47, 52, 57, 61, 66]);
  assert.equal(g.firstMidi, 66);
});

test("dadgad / open-g / eb-standard / drop-d tunings come out as listed in the spec", () => {
  assert.deepEqual(goldenFor(fixture("dadgad")).tuning, [38, 45, 50, 55, 57, 62]);
  assert.deepEqual(goldenFor(fixture("open-g")).tuning, [38, 43, 50, 55, 59, 62]);
  assert.deepEqual(goldenFor(fixture("eb-standard")).tuning, [39, 44, 49, 54, 58, 63]);
  assert.deepEqual(goldenFor(fixture("drop-d-riff")).tuning, [38, 45, 50, 55, 59, 64]);
});

test("low-on-top: labels flip the string order", () => {
  const g = goldenFor(fixture("low-on-top"));
  assert.equal(g.firstMidi, 64);
  assert.equal(g.lastMidi, 43);
});

test("bass-blues and four-lines-no-labels use bass tuning", () => {
  assert.deepEqual(goldenFor(fixture("bass-blues")).tuning, [28, 33, 38, 43]);
  assert.deepEqual(goldenFor(fixture("four-lines-no-labels")).tuning, [28, 33, 38, 43]);
});

test("seven-string gets a low B", () => {
  assert.deepEqual(goldenFor(fixture("seven-string")).tuning, [35, 40, 45, 50, 55, 59, 64]);
});

test("amazing-grace-chords is a chord sheet with chords and bass tracks", () => {
  const g = goldenFor(fixture("amazing-grace-chords"));
  assert.equal(g.kind, "chords");
  assert.equal(g.chords, 15);
  assert.ok(g.tracks.chords > 0 && g.tracks.bass > 0);
});

test("not-a-tab is neither", () => {
  assert.equal(goldenFor(fixture("not-a-tab")).kind, "none");
});

test("a whole Ultimate Guitar chord page converts to the song and nothing else", () => {
  const g = goldenFor(fixture("page-ug-chords"));
  assert.equal(g.kind, "chords");
  assert.equal(g.title, "Covet");
  assert.equal(g.artist, "Basement");
  // 57 bars: the song. Reading the whole page gave 75, the extra 18 being the
  // tuning header read as six chords, the five-chord diagram legend and the
  // seven letters A-G of the A-Z artist index.
  assert.equal(g.chords, 57);
  assert.ok(g.tracks.chords > 0 && g.tracks.bass > 0);
});

test("a whole GuitarTuna chord page converts, capo and tempo included", () => {
  const g = goldenFor(fixture("page-guitartuna"));
  assert.equal(g.kind, "chords");
  assert.equal(g.title, "Perfect");
  assert.equal(g.artist, "Ed Sheeran");
  assert.equal(g.tempo, 95); // the page says "BPM: 95"
  assert.equal(g.chords, 36);
  // "Capo: Fret 1" raises everything a semitone, so a written G sounds as Ab,
  // which is the key the page itself states.
  assert.equal(g.firstMidi % 12, 8);
});
