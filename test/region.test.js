import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classifyLine, markSupportedChords, bestRun, scoreLines, findSongRegion, trimToSong } from "../src/parse/region.js";
import { splitLines } from "../src/parse/text.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.txt`, import.meta.url), "utf8");

test("classifyLine sorts a page into song content and furniture", () => {
  assert.equal(classifyLine("e|--0--2--3--|"), "tab");
  assert.equal(classifyLine("[Verse 1]"), "section");
  assert.equal(classifyLine("Chorus 1"), "section");
  assert.equal(classifyLine("Pre-chorus 2"), "section");
  assert.equal(classifyLine("   E    C#m   G#m"), "chord");
  assert.equal(classifyLine("Am"), "chord");
  assert.equal(classifyLine("I don't want to be with you"), "lyric");
  assert.equal(classifyLine("Tuning: E A D G B E"), "metadata");
  assert.equal(classifyLine("Capo: No capo"), "metadata");
  assert.equal(classifyLine("© 2026"), "metadata");
  assert.equal(classifyLine("Tabs"), "other");
  assert.equal(classifyLine("146,572 views"), "other"); // more digits than letters
  assert.equal(classifyLine("4.8 (44.9K)"), "other");
  assert.equal(classifyLine(""), "blank");
});

test("markSupportedChords: chords next to words count, lists of chords do not", () => {
  // A chord-diagram legend: chord lines with only single words around them.
  const legend = ["other", "chord", "chord", "chord", "chord", "other"];
  assert.deepEqual(markSupportedChords(legend), [false, false, false, false, false, false]);

  // Chord over lyric, the aligned layout.
  const aligned = ["chord", "lyric", "chord", "lyric"];
  assert.deepEqual(markSupportedChords(aligned), [true, false, true, false]);

  // Chords stacked on their own lines before the words, the modern layout.
  const stacked = ["section", "chord", "chord", "chord", "lyric"];
  assert.deepEqual(markSupportedChords(stacked), [false, true, true, true, false]);

  // A run longer than MAX_CHORD_RUN is an index, even with words beside it.
  const index = ["lyric", ...Array(9).fill("chord"), "other"];
  assert.equal(markSupportedChords(index).filter(Boolean).length, 0);

  // Blank lines do not break a run.
  assert.deepEqual(markSupportedChords(["chord", "blank", "chord", "lyric"]), [true, false, true, false]);
});

test("bestRun finds the highest scoring stretch", () => {
  assert.deepEqual(bestRun([-2, -2, 3, 4, -1, 5, -3, -2]), { start: 2, end: 5, total: 11 });
  assert.deepEqual(bestRun([5]), { start: 0, end: 0, total: 5 });
  assert.equal(bestRun([-1, -2]).total, -1);
});

test("scoreLines rewards interleaved chords and words, punishes bare chord lists", () => {
  const song = splitLines("[Verse]\nAm      C\nsome words here\nF       G\nmore words here");
  assert.ok(scoreLines(song).every((s) => s > 0));
  const legend = splitLines("Chords\nE\nC#m\nG#m\nB\nA\nStrumming");
  assert.ok(scoreLines(legend).every((s) => s < 0));
});

test("a real Ultimate Guitar chord page is trimmed to the song", () => {
  const text = fixture("page-ug-chords");
  const lines = splitLines(text);
  const region = findSongRegion(text);
  assert.equal(region.trimmed, true);
  assert.equal(lines[region.start], "[Intro]");
  assert.equal(lines[region.end].trim(), "Demanding dream.");

  const song = trimToSong(text);
  // The chord-diagram legend, the tuning header and the A-Z artist index are
  // all gone; the song itself is untouched.
  assert.ok(!song.includes("Strumming"));
  assert.ok(!song.includes("All artists"));
  assert.ok(!song.includes("Tuning:"));
  assert.ok(!song.includes("Related tabs"));
  assert.ok(song.includes("I don't want to be with you"));
  assert.ok(song.includes("A pleasant surprise."));
});

test("a real GuitarTuna chord page is trimmed to the song", () => {
  const text = fixture("page-guitartuna");
  const song = trimToSong(text);
  assert.ok(!song.includes("Skip to content"));
  assert.ok(!song.includes("More songs by Ed Sheeran"));
  assert.ok(!song.includes("Yousician"));
  assert.ok(song.includes("I found a love for me"));
  assert.ok(song.includes("Baby, I'm dancing in the dark"));
  // The song's own outro chords survive, the sidebar chord list does not.
  assert.ok(song.trim().endsWith("Request a fix") || song.includes("tonight"));
  assert.ok(!/G\nEm\nC\nD\n*$/.test(song.trim()));
});

test("trimming never loses a line of music from a clean tab or chord sheet", () => {
  // Trimming a header off a tab is harmless (metadata is read from the whole
  // text separately), but on a text that is nothing but song, no line of tab
  // or chords may ever be dropped. The two real page fixtures are excluded on
  // purpose: dropping chord-shaped lines that are a legend or an A-Z index is
  // the entire point, and those are pinned by their own tests above.
  const names = ["ode-to-joy", "greensleeves", "house-of-the-rising-sun", "amazing-grace-chords", "techniques", "power-chords", "bass-blues", "chords-with-intro-tab", "wildwood-flower", "scarborough-fair", "drop-d-riff"];
  for (const name of names) {
    const before = splitLines(fixture(name));
    const after = new Set(splitLines(trimToSong(fixture(name))));
    const lost = before.filter((l) => ["tab", "chord"].includes(classifyLine(l)) && !after.has(l));
    assert.deepEqual(lost, [], `${name} lost music`);
  }
});

test("a plain tab keeps every stave even when its header is trimmed", () => {
  const song = trimToSong(fixture("ode-to-joy"));
  assert.equal(splitLines(song).filter((l) => classifyLine(l) === "tab").length, 12); // two staves of six
});

test("nothing convincing to cut means nothing is cut", () => {
  assert.equal(findSongRegion("").trimmed, false);
  assert.equal(findSongRegion("just some prose\nand some more").trimmed, false);
  assert.equal(trimToSong("hello\nworld"), "hello\nworld");
});

test("the trimmer refuses to throw away most of the song", () => {
  // Two equally good halves: keeping only one would lose half the music, so
  // the safety rail keeps everything.
  const half = "[Verse]\nAm      C\nsome words here\nF       G\nmore words here\n";
  const text = half + "\n\n" + half;
  const song = trimToSong(text);
  assert.equal((song.match(/some words here/g) || []).length, 2);
});
