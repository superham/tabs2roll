import { test } from "node:test";
import assert from "node:assert/strict";
import { isTabShapedLine, tabLineCount, looksLikeTab, looksLikeChordSheet, looksLikeSong, isChordOnlyLine, isLyricLine, isSectionLine } from "../src/parse/tabshape.js";

test("isTabShapedLine: needs 12+ chars and 8+ tab characters", () => {
  assert.equal(isTabShapedLine("e|--0--2--3--|"), true);
  assert.equal(isTabShapedLine("--5--7--5--7--"), true);
  assert.equal(isTabShapedLine("e|--0--"), false); // too short
  assert.equal(isTabShapedLine("Hello there, how are you?"), false);
  assert.equal(isTabShapedLine("   Am      C      G   "), false);
  assert.equal(isTabShapedLine(""), false);
  assert.equal(isTabShapedLine(null), false);
});

test("looksLikeTab: four tab lines make a tab", () => {
  const tab = ["e|--0--2--3--|", "B|-----------|", "G|--2--2--2--|", "D|-----------|"].join("\n");
  assert.equal(tabLineCount(tab), 4);
  assert.equal(looksLikeTab(tab), true);
  assert.equal(looksLikeTab(tab.split("\n").slice(0, 3).join("\n")), false);
  assert.equal(looksLikeTab("just some prose\nwith two lines"), false);
});

test("looksLikeTab: ignores lyrics between tab lines", () => {
  const text = "Verse one\ne|--0--2--3--|\nB|-----------|\nSome lyric here\nG|--2--2--2--|\nD|-----------|\nA|-----------|\n";
  assert.equal(looksLikeTab(text), true);
  assert.equal(tabLineCount(text), 5);
});

test("looksLikeTab: handles any line ending", () => {
  const text = "e|--0--2--3--|\r\nB|-----------|\r\nG|--2--2--2--|\r\nD|-----------|\r\n";
  assert.equal(looksLikeTab(text), true);
});

test("isTabShapedLine needs dashes, not just digits", () => {
  assert.equal(isTabShapedLine("146,572 views, added to favorites 5,760 times"), false);
  assert.equal(isTabShapedLine("3 contributors total, last edit on Jul 25, 2025"), false);
  assert.equal(isTabShapedLine("e|--12-14-12--|"), true);
});

test("isChordOnlyLine: chords and fillers only, never a header", () => {
  assert.equal(isChordOnlyLine("Am"), true);
  assert.equal(isChordOnlyLine("   E    C#m   G#m"), true);
  assert.equal(isChordOnlyLine("| C | G | Am | F | x2"), true);
  assert.equal(isChordOnlyLine("D/F# Bb Gsus4"), true);
  // The bug this replaced: a tuning header read as six chords.
  assert.equal(isChordOnlyLine("Tuning: E A D G B E"), false);
  assert.equal(isChordOnlyLine("Key: Ab major"), false);
  assert.equal(isChordOnlyLine("[Verse 1]"), false);
  assert.equal(isChordOnlyLine("Amazing grace"), false);
  assert.equal(isChordOnlyLine(""), false);
});

test("isLyricLine: sung words, not navigation or statistics", () => {
  assert.equal(isLyricLine("I don't want to be with you"), true);
  assert.equal(isLyricLine("tonight"), true); // a one-word lyric, lower case
  assert.equal(isLyricLine("Tabs"), false); // navigation is Capitalised
  assert.equal(isLyricLine("Strumming"), false);
  assert.equal(isLyricLine("146,572 views"), false); // more digits than letters
  assert.equal(isLyricLine("2017 Pop"), false);
  assert.equal(isLyricLine("Am"), false);
  assert.equal(isLyricLine("[Chorus]"), false);
});

test("isSectionLine covers both bracketed and plain section headings", () => {
  for (const s of ["[Verse 1]", "[Intro]", "Chorus 1", "Pre-chorus 2", "Outro 1", "Solo", "Bridge:"]) {
    assert.equal(isSectionLine(s), true, s);
  }
  assert.equal(isSectionLine("I found a love for me"), false);
});

test("looksLikeChordSheet: a song yes, a chord legend no", () => {
  const song = "[Verse]\nAm      C\nsome words here\nF       G\nmore words here\nAm      C\nlast words here";
  assert.equal(looksLikeChordSheet(song), true);
  assert.equal(looksLikeSong(song), true);
  assert.equal(looksLikeTab(song), false);

  // A chord-diagram legend or an A-Z artist index: chord lines, no song.
  assert.equal(looksLikeChordSheet("Chords\nE\nC#m\nG#m\nB\nA\nStrumming"), false);
  assert.equal(looksLikeChordSheet("A\nB\nC\nD\nE\nF\nG"), false);
  assert.equal(looksLikeChordSheet("just some prose\nwith no chords at all"), false);
});

test("chords stacked on their own lines still read as a chord sheet", () => {
  // The layout GuitarTuna uses: one chord per line, then the words.
  const stacked = "Verse 1\nG\nEm\nI found a love for me\nC\nDarling, just dive right in\nD\nAnd follow my lead";
  assert.equal(looksLikeChordSheet(stacked), true);
});
