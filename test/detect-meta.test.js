import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "../src/parse/detect.js";
import { findTempo, findCapo, findTuningHeader, findTimeSignature, findTitleAndArtist, findMeta } from "../src/parse/meta.js";
import { cleanText } from "../src/parse/text.js";

const STAVE = "e|--0--2--3--|\nB|-----------|\nG|--2--2--2--|\nD|-----------|\nA|-----------|\nE|-----------|";

test("detect: tab, chords, none", () => {
  assert.equal(detect(STAVE).kind, "tab");
  assert.equal(detect("C  G  Am  F\nlyrics here\nF  G  C").kind, "chords");
  assert.equal(detect("just words\nmore words").kind, "none");
  assert.equal(detect("").kind, "none");
});

test("detect: chord names above a stave do not turn a tab into a chord sheet", () => {
  assert.equal(detect("   Am   C   G   F\n" + STAVE + "\n\n   Am   C\n" + STAVE).kind, "tab");
});

test("detect: a chord sheet with one short intro riff is still a chord sheet", () => {
  const text = "[Intro]\n" + STAVE + "\n\nC  G  Am  F\nla la la\nC  G  F  C\nla la la\nF  G  C  Am\nla la";
  const d = detect(text);
  assert.equal(d.kind, "chords");
  assert.equal(d.staves, 1);
});

test("findTempo", () => {
  assert.equal(findTempo(["Tempo: 120"]), 120);
  assert.equal(findTempo(["Played at 96 BPM"]), 96);
  assert.equal(findTempo(["bpm = 88"]), 88);
  assert.equal(findTempo(["♩ = 72"]), 72);
  assert.equal(findTempo(["Tempo = 110 bpm"]), 110);
  assert.equal(findTempo(["Tempo: 999"]), null);
  assert.equal(findTempo(["no tempo here"]), null);
});

test("findCapo", () => {
  assert.equal(findCapo(["Capo: 2"]), 2);
  assert.equal(findCapo(["Capo 3rd fret"]), 3);
  assert.equal(findCapo(["capo on 5"]), 5);
  assert.equal(findCapo(["Capo: none"]), 0);
  assert.equal(findCapo(["No capo"]), 0);
  assert.equal(findCapo(["nothing"]), 0);
});

test("findTuningHeader", () => {
  assert.equal(findTuningHeader(["Tuning: Drop D"]).id, "drop-d");
  assert.equal(findTuningHeader(["Tuning: E A D G B E"]).id, "standard");
  assert.equal(findTuningHeader(["Tuned half a step down"]).id, "eb-standard");
  assert.equal(findTuningHeader(["Open G tuning"]).id, "open-g");
  assert.equal(findTuningHeader(["Standard"]), null);
  assert.equal(findTuningHeader(["Standard tuning"]).id, "standard");
  assert.equal(findTuningHeader(["He will drop dead if he sees this"]), null);
});

test("findTimeSignature", () => {
  assert.deepEqual(findTimeSignature(["Time: 3/4"]), [3, 4]);
  assert.deepEqual(findTimeSignature(["in 6/8 time"]), [6, 8]);
  assert.deepEqual(findTimeSignature(["Time signature: 4/4"]), [4, 4]);
  assert.equal(findTimeSignature(["1/2 step down"]), null);
});

test("findTitleAndArtist", () => {
  assert.deepEqual(findTitleAndArtist(["Title: Greensleeves", "Artist: Traditional"]), { title: "Greensleeves", artist: "Traditional" });
  assert.deepEqual(findTitleAndArtist(["Song: Foo", "by Someone"]), { title: "Foo", artist: "Someone" });
  assert.deepEqual(findTitleAndArtist(["Ode to Joy - Beethoven", "Tuning: Standard"]), { title: "Ode to Joy - Beethoven", artist: "" });
  assert.deepEqual(findTitleAndArtist(["e|--0--|"]), { title: "", artist: "" });
});

test("findMeta gathers everything", () => {
  const m = findMeta(["Song: X", "Artist: Y", "Tempo: 90", "Capo: 1", "Tuning: Drop D", "Time: 3/4"]);
  assert.equal(m.title, "X");
  assert.equal(m.artist, "Y");
  assert.equal(m.tempo, 90);
  assert.equal(m.capo, 1);
  assert.equal(m.tuning.id, "drop-d");
  assert.deepEqual(m.timeSignature, [3, 4]);
});

test("cleanText strips UG markup, nbsp, unicode dashes and normalises line endings", () => {
  const dirty = "[tab]e|\u2013\u20130\u00A0-|[/tab]\r\n[ch]Am[/ch]\tC\u200B";
  assert.equal(cleanText(dirty), "e|--0 -|\nAm    C");
  assert.equal(cleanText(null), "");
});
