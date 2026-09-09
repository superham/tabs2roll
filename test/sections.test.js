// The callout finder and the split it drives. The interesting cases are the
// ones a keyword list cannot reach: a heading in a language nobody listed, a
// heading drawn out of dashes, and a lyric that looks exactly like both.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  stripDecoration,
  hasSectionWord,
  isHeadingPhrase,
  calloutCandidate,
  findCallouts,
  buildSections,
  DEFAULT_SECTION_NAME,
} from "../src/parse/sections.js";
import { splitBySection, sectionRanges } from "../src/arrange/sections.js";
import { parseText } from "../src/parse/index.js";
import { convertText } from "../src/pipeline.js";
import { readMidi } from "./helpers/midi-read.js";

// --------------------------------------------------------------------------
// Reading one line
// --------------------------------------------------------------------------

test("stripDecoration peels off every way a heading gets dressed up", () => {
  assert.equal(stripDecoration("[Chorus]").label, "Chorus");
  assert.equal(stripDecoration("(Intro)").label, "Intro");
  assert.equal(stripDecoration("{Solo}").label, "Solo");
  assert.equal(stripDecoration("-- Chorus --").label, "Chorus");
  assert.equal(stripDecoration("*** Guitar solo ***").label, "Guitar solo");
  assert.equal(stripDecoration("Chorus:").label, "Chorus");
  assert.equal(stripDecoration("*** [Verse 2] *** x4").label, "Verse 2");
  assert.equal(stripDecoration("[Verse] x4").repeat, 4);
  assert.equal(stripDecoration("Chorus 4x").repeat, 4);
  // What was peeled is remembered, because it is what makes a heading a heading.
  assert.equal(stripDecoration("[Chorus]").bracketed, true);
  assert.equal(stripDecoration("== Chorus ==").decorated, true);
  assert.equal(stripDecoration("Chorus:").colon, true);
});

test("a full stop is punctuation, and one dash is not a rule", () => {
  // Reading either as decoration turned every sentence into a heading.
  assert.equal(stripDecoration("Is on your outside.").decorated, false);
  assert.equal(stripDecoration("Waiting-").decorated, false);
  // A rule is either fenced on both sides or long enough to be unmistakable.
  assert.equal(stripDecoration("- Chorus -").decorated, true);
  assert.equal(stripDecoration("*** Chorus").decorated, true);
});

test("section words are matched past their accents and their endings", () => {
  assert.ok(hasSectionWord("Chorus"));
  assert.ok(hasSectionWord("Estribillo"));
  assert.ok(hasSectionWord("Refrão"));
  assert.ok(hasSectionWord("Zwrotka 2"));
  assert.ok(hasSectionWord("припев"));
  assert.ok(hasSectionWord("前奏"));
  assert.ok(!hasSectionWord("Bananas"));
  // "most" is Polish for bridge and English for most things; it is left out.
  assert.ok(!hasSectionWord("My most"));
});

test("a heading phrase is section words, who plays them, and a number", () => {
  assert.ok(isHeadingPhrase("Chorus"));
  assert.ok(isHeadingPhrase("Guitar solo"));
  assert.ok(isHeadingPhrase("Riff 2"));
  assert.ok(isHeadingPhrase("Verse III"));
  assert.ok(!isHeadingPhrase("The end"));
  assert.ok(!isHeadingPhrase("Bananas"));
});

test("a bracketed line of words is the line being played, not the part", () => {
  // Ultimate Guitar tabbers bracket the words they are about to play as well
  // as the part they are playing, and brackets alone cannot tell them apart.
  assert.equal(calloutCandidate("[you know i always try to settle her down]"), null);
  assert.equal(calloutCandidate("[\"it gets difficult to talk when you laugh\"]"), null);
  assert.ok(calloutCandidate("[Verse]"));
  assert.ok(calloutCandidate("[Guitar Solo]"));
});

test("a note after a heading joins the name, or is dropped for being one", () => {
  // "[Verse 2] (Rythm)" and "[Verse 2] (Lead)" are two different parts, so
  // the qualifier has to survive; a sentence after the heading does not.
  assert.equal(stripDecoration("[Verse 2] (Rythm):").label, "Verse 2 (Rythm)");
  assert.equal(stripDecoration("[Verse] THIS GRADUALLY SLOWS DOWN TOWARDS THE END").label, "Verse");
});

test("music, headers and playing instructions are never headings", () => {
  assert.equal(calloutCandidate("e|--0--2--3--0--2--|"), null);
  assert.equal(calloutCandidate("Am  G  F  C"), null);
  assert.equal(calloutCandidate("Tuning: Drop D"), null);
  assert.equal(calloutCandidate("x4"), null);
  assert.equal(calloutCandidate("let ring"), null);
  assert.equal(calloutCandidate("Palm mute"), null);
  assert.equal(calloutCandidate(""), null);
  // "Chorus:" matches the metadata rule too, and has to survive it.
  assert.ok(calloutCandidate("Chorus:"));
});

// --------------------------------------------------------------------------
// Finding them in a text
// --------------------------------------------------------------------------

const linesOf = (text) => text.split("\n");

test("a heading is found with no keyword, no bracket and no English", () => {
  const lines = linesOf(["Estrofa", "", "MUSIC", "", "Estribillo", "", "MUSIC"].join("\n"));
  const music = new Set([2, 6]);
  assert.deepEqual(
    findCallouts(lines, music).map((c) => c.label),
    ["Estrofa", "Estribillo"],
  );
});

test("a sung line above the music is not a heading, however it is capitalised", () => {
  const lines = linesOf(["Everything.", "", "MUSIC", "", "And a hopeful smile", "", "MUSIC"].join("\n"));
  assert.deepEqual(findCallouts(lines, new Set([2, 6])), []);
});

test("...but a marked one is, and so is one that says only the name of a part", () => {
  const lines = linesOf(["[The waiting game]", "", "MUSIC", "", "Guitar solo", "", "MUSIC"].join("\n"));
  assert.deepEqual(
    findCallouts(lines, new Set([2, 6])).map((c) => c.label),
    ["The waiting game", "Guitar solo"],
  );
});

test("a heading with no music left below it heads nothing", () => {
  // The tail of a tab page: the song is over and this is the site talking.
  const lines = linesOf(["[Intro]", "", "MUSIC", "", "Comments", "", "Related tabs"].join("\n"));
  assert.deepEqual(
    findCallouts(lines, new Set([2])).map((c) => c.label),
    ["Intro"],
  );
});

test("a quoted lyric between a heading and its stave does not steal the part", () => {
  const lines = linesOf(["[Verse]", "", "[and the words go something like this]", "", "MUSIC", "", "[Chorus]", "", "MUSIC"].join("\n"));
  const sections = buildSections(lines, [place(4, 0, 4), place(8, 4, 4)]);
  assert.deepEqual(sections.map((s) => s.name), ["Verse", "Chorus"]);
});

test("a comment between a heading and its music does not break them apart", () => {
  const lines = linesOf(["[Chorus]", "", "play this one softly", "", "MUSIC"].join("\n"));
  assert.deepEqual(
    findCallouts(lines, new Set([4])).map((c) => c.label),
    ["Chorus"],
  );
});

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

const place = (firstLine, start, length) => ({ firstLine, lastLine: firstLine, start, length });

test("every stave belongs to the nearest heading above it", () => {
  const lines = linesOf(["[Intro]", "M", "[Chorus]", "M", "M"].join("\n"));
  const sections = buildSections(lines, [place(1, 0, 4), place(3, 4, 4), place(4, 8, 4)]);
  assert.deepEqual(
    sections.map((s) => [s.name, s.start, s.end]),
    [
      ["Intro", 0, 4],
      ["Chorus", 4, 12],
    ],
  );
});

test("music before the first heading still gets a section of its own", () => {
  const lines = linesOf(["M", "[Chorus]", "M"].join("\n"));
  const sections = buildSections(lines, [place(0, 0, 4), place(2, 4, 4)]);
  assert.deepEqual(sections.map((s) => s.name), [DEFAULT_SECTION_NAME, "Chorus"]);
});

test("a heading used twice gives two sections with names of their own", () => {
  const lines = linesOf(["[Chorus]", "M", "[Verse]", "M", "[Chorus]", "M"].join("\n"));
  const sections = buildSections(lines, [place(1, 0, 4), place(3, 4, 4), place(5, 8, 4)]);
  assert.deepEqual(sections.map((s) => s.name), ["Chorus", "Verse", "Chorus 2"]);
  assert.deepEqual(sections.map((s) => s.label), ["Chorus", "Verse", "Chorus"]);
});

test("one part is no parts: there is nothing to tell apart", () => {
  const lines = linesOf(["[Intro]", "M", "M"].join("\n"));
  assert.deepEqual(buildSections(lines, [place(1, 0, 4), place(2, 4, 4)]), []);
  assert.deepEqual(buildSections(linesOf("M\nM"), [place(0, 0, 4)]), []);
});

// --------------------------------------------------------------------------
// Splitting
// --------------------------------------------------------------------------

const note = (start) => ({ midi: 60, start, length: 1, velocity: 0.8, technique: null });

test("sections reach back to the start and on to the end, so no note is lost", () => {
  const ranges = sectionRanges([
    { name: "A", start: 0, end: 4 },
    { name: "B", start: 4, end: 8 },
  ]);
  assert.equal(ranges[0].from, -Infinity);
  assert.equal(ranges[1].to, Infinity);
});

test("splitBySection cuts the tab and leaves the arranger's tracks whole", () => {
  const ir = {
    sections: [
      { name: "Intro", start: 0, end: 4 },
      { name: "Chorus", start: 4, end: 8 },
    ],
    tracks: [
      { role: "guitar", notes: [note(0), note(2), note(4), note(9)] },
      { role: "lead", notes: [note(5)] },
      { role: "bass", notes: [note(1), note(6)] },
    ],
  };
  const out = splitBySection(ir);
  // Only the tabbed track is cut up. Cutting every role turns a six-part song
  // with a full arrangement into twenty-four tracks, which is worse to open
  // than the one track it replaced.
  assert.deepEqual(
    out.tracks.map((t) => [t.role, t.section || null, t.notes.length]),
    [
      ["guitar", "Intro", 2],
      ["guitar", "Chorus", 2], // the note at beat 9 is past the last heading
      ["lead", null, 1],
      ["bass", null, 2],
    ],
  );
  // Absolute beats, not loops rebased to zero.
  assert.deepEqual(out.tracks[1].notes.map((n) => n.start), [4, 9]);
  assert.equal(ir.tracks[0].notes.length, 4, "the input is left alone");
});

test("nothing to cut means nothing is cut, and no track claims a part", () => {
  // The arranger's roles are not split, so an IR holding only those comes
  // back exactly as it went in — which is what lets the summary report
  // whether a file really was split by looking at the tracks themselves.
  const ir = {
    sections: [
      { name: "Intro", start: 0, end: 4 },
      { name: "Chorus", start: 4, end: 8 },
    ],
    tracks: [{ role: "chords", notes: [note(0), note(5)] }],
  };
  const out = splitBySection(ir);
  assert.deepEqual(out.tracks, ir.tracks);
  assert.ok(!out.tracks.some((t) => t.section));
});

test("a song with one part comes back whole", () => {
  const ir = { sections: [{ name: "Intro", start: 0, end: 4 }], tracks: [{ role: "guitar", notes: [note(0)] }] };
  assert.deepEqual(splitBySection(ir).tracks, ir.tracks);
});

// --------------------------------------------------------------------------
// End to end
// --------------------------------------------------------------------------

const TAB = `[Intro]

e|-----------------|
B|-----------------|
G|-----------------|
D|-----------------|
A|-----------------|
E|-0---0---3---3---|

Estribillo

e|-----------------|
B|-----------------|
G|--0---2---3---2--|
D|-----------------|
A|-----------------|
E|-----------------|

** Guitar solo **

e|--5---7---5---7--|
B|-----------------|
G|-----------------|
D|-----------------|
A|-----------------|
E|-----------------|
`;

test("a tab headed three different ways comes out as three sections", () => {
  const ir = parseText(TAB);
  assert.deepEqual(ir.sections.map((s) => s.name), ["Intro", "Estribillo", "Guitar solo"]);
  // Each one starts where the one before it ends, with no gap and no overlap.
  for (let i = 1; i < ir.sections.length; i++) {
    assert.equal(ir.sections[i].start, ir.sections[i - 1].end);
  }
});

test("the callouts become markers in the file, whether or not it is split", () => {
  const { bytes } = convertText(TAB, { arrange: false });
  const markers = readMidi(bytes).tracks[0].markers.map((m) => [m.text, m.tick / 480]);
  assert.deepEqual(markers, [
    ["Intro", 0],
    ["Estribillo", 4],
    ["Guitar solo", 8],
  ]);
});

test("a track is named for its part first, then the instrument", () => {
  const { bytes, summary } = convertText(TAB, { arrange: false, splitSections: true });
  const tracks = readMidi(bytes).tracks.slice(1);
  assert.deepEqual(tracks.map((t) => t.name), [
    "Intro - Guitar",
    "Estribillo - Guitar",
    "Guitar solo - Guitar",
  ]);
  assert.ok(tracks.every((t) => t.notes.length > 0), "no empty tracks");
  assert.equal(summary.splitSections, true);
  assert.deepEqual(summary.sections, ["Intro", "Estribillo", "Guitar solo"]);
});

test("splitting loses no notes and moves none of them", () => {
  const whole = convertText(TAB, { arrange: false, splitSections: false });
  const split = convertText(TAB, { arrange: false, splitSections: true });
  const starts = (r) => r.ir.tracks.flatMap((t) => t.notes.map((n) => n.start)).sort((a, b) => a - b);
  assert.deepEqual(starts(split), starts(whole));
});

test("a section named in another script survives into the file", () => {
  // The callout finder reads Cyrillic and CJK headings, so the encoder has to
  // carry them. Writing meta text as ASCII turned 前奏 into "??" and threw
  // away the one thing that detection exists to produce.
  const tab = `前奏

e|-----------------|
B|-----------------|
G|-----------------|
D|-----------------|
A|-----------------|
E|-0---0---3---3---|

припев

e|-----------------|
B|-----------------|
G|--0---2---3---2--|
D|-----------------|
A|-----------------|
E|-----------------|
`;
  const { ir, bytes } = convertText(tab, { arrange: false, splitSections: true });
  assert.deepEqual(ir.sections.map((s) => s.name), ["前奏", "припев"]);
  const file = readMidi(bytes);
  assert.deepEqual(file.tracks[0].markers.map((m) => m.text), ["前奏", "припев"]);
  assert.deepEqual(file.tracks.slice(1).map((t) => t.name), [
    "前奏 - Guitar",
    "припев - Guitar",
  ]);
});

test("a marked-up tab arrives split, without anyone having to ask", () => {
  // The default used to be off, so the parts were found, written as markers,
  // and then handed over as one track anyway — which is not what someone who
  // asked for a track per part expects to open.
  const { summary } = convertText(TAB, { arrange: false });
  assert.equal(summary.splitSections, true);
  assert.deepEqual(summary.trackNames, [
    "Intro - Guitar",
    "Estribillo - Guitar",
    "Guitar solo - Guitar",
  ]);
});

test("the summary reports what happened, not what was asked for", () => {
  // Splitting asked for, but a tab with no callouts has nothing to split.
  const plain = "e|--0--2--3--2--0--|\nB|-----------------|\nG|-----------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|\n";
  const { summary } = convertText(plain, { arrange: false, splitSections: true });
  assert.equal(summary.splitSections, false);
});

test("...and splitSections: false still gets you the one long track", () => {
  const { summary } = convertText(TAB, { arrange: false, splitSections: false });
  assert.equal(summary.splitSections, false);
  assert.deepEqual(summary.trackNames, ["Guitar (as tabbed)"]);
});

test("a tab with no callouts is left as one track, as it always was", () => {
  const plain = "e|--0--2--3--2--0--|\nB|-----------------|\nG|-----------------|\nD|-----------------|\nA|-----------------|\nE|-----------------|\n";
  const { ir, summary } = convertText(plain, { arrange: false, splitSections: true });
  assert.deepEqual(ir.sections, []);
  assert.deepEqual(summary.trackNames, ["Guitar (as tabbed)"]);
});
