import { test } from "node:test";
import assert from "node:assert/strict";
import { isTabShapedLine, tabLineCount, looksLikeTab } from "../src/parse/tabshape.js";

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
