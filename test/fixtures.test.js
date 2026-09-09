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

// --------------------------------------------------------------------------
// The real-*.txt fixtures: unedited tabs off Ultimate Guitar. Everything
// asserted here was read off the page by eye, so a change that quietly stops
// finding a part of one of these songs fails the build.
// --------------------------------------------------------------------------

test("real-anything: a bracketed lyric under each heading is not a part", () => {
  const g = goldenFor(fixture("real-anything"));
  // The page brackets the words as well as the part, one right under the
  // other: "[Verse]" then "[You know i always try to settle ya']".
  assert.deepEqual(
    g.sections.map((s) => s.replace(/ [\d.]+-[\d.]+$/, "")),
    ["Verse", "Chorus", "Verse 2", "Chorus 2", "Bridge", "Guitar Solo", "Chorus 3", "Verse 3"],
  );
  assert.equal(g.noteCount, 496);
  assert.deepEqual(g.tuning, [28, 33, 38, 43]); // four strings: a bass tab
});

test("real-games: a qualifier after a heading keeps the two parts apart", () => {
  const g = goldenFor(fixture("real-games"));
  // "[Verse 2] (Rythm):" and "[Verse 2] (Lead):" are two different parts.
  assert.deepEqual(
    g.sections.map((s) => s.replace(/ [\d.]+-[\d.]+$/, "")),
    ["Intro", "Verse 1", "Chorus 1", "Verse 2 (Rythm)", "Verse 2 (Lead)", "Chorus 2", "Outro"],
  );
  // "Strumming:Down" sits between every heading and its stave and is a header
  // field, not a part of the song.
  assert.ok(!g.sections.some((s) => /strumming/i.test(s)));
  assert.equal(g.noteCount, 644);
});

test("real-sasquatch: the words reprinted under the same headings are not parts", () => {
  const g = goldenFor(fixture("real-sasquatch"));
  // The page heads 13 blocks; the last six repeat the headings over the words
  // with no tab under them, and the song-region trimmer cuts those away.
  assert.deepEqual(
    g.sections.map((s) => s.replace(/ [\d.]+-[\d.]+$/, "")),
    ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus 2", "Verse 3", "Chorus 3"],
  );
  // The tab opens straight on "[Intro]", so it has no title line. Reading on
  // past the first stave used to name the song after a stray line of words.
  assert.equal(g.title, "");
});

test("real-souls-of-fire: one heading is no parts, and the capo still counts", () => {
  const g = goldenFor(fixture("real-souls-of-fire"));
  assert.deepEqual(g.sections, [], "one part is nothing to tell apart");
  // "Notes relative to capo on 5th fret" — standard tuning, up five semitones.
  assert.deepEqual(g.tuning, [45, 50, 55, 60, 64, 69]);
});

test("real-only-call-me: every part of the song is found and named", () => {
  const g = goldenFor(fixture("real-only-call-me"));
  assert.deepEqual(
    g.sections.map((s) => s.replace(/ [\d.]+-[\d.]+$/, "")),
    ["Intro/Verse", "Chorus", "Verse 2", "Chorus 2", "Bridge", "Ending"],
  );
  assert.equal(g.noteCount, 141);
});

test("every real tab's parts run end to end with no gap and no overlap", () => {
  for (const name of names.filter((n) => n.startsWith("real-"))) {
    const spans = goldenFor(fixture(name)).sections.map((s) => s.match(/ ([\d.]+)-([\d.]+)$/).slice(1).map(Number));
    if (!spans.length) continue;
    assert.equal(spans[0][0], 0, `${name}: the first part does not start at the beginning`);
    for (let i = 1; i < spans.length; i++) {
      assert.equal(spans[i][0], spans[i - 1][1], `${name}: a gap before part ${i + 1}`);
    }
  }
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
