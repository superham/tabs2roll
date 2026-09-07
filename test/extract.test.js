import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { el, document } from "./helpers/fake-dom.js";
import * as shape from "../src/parse/tabshape.js";
import { extractUltimateGuitar, parseUltimateGuitarTitle, findInJson, isUltimateGuitarHost } from "../src/extract/sites/ultimate-guitar.js";
import { extractGeneric, cleanPageTitle, isPlayerOnlyHost } from "../src/extract/sites/generic.js";
import { extractFromPage, describePage } from "../src/extract/sites/page.js";
import { buildInjected, OUTPUT } from "../tools/build-injected.js";

const TAB = "e|--0--2--3--|\nB|-----------|\nG|--2--2--2--|\nD|-----------|\nA|-----------|\nE|-----------|";
const sites = { ultimateGuitar: extractUltimateGuitar, generic: extractGeneric };

test("generic: strategy 2 — <pre> blocks that look like tab, joined in page order", () => {
  const doc = document({
    title: "Greensleeves Tab - Some Tab Site",
    body: [el("h1", {}, ["Greensleeves"]), el("pre", {}, [TAB]), el("p", {}, ["lyrics"]), el("pre", {}, ["not tab"]), el("pre", {}, [TAB])],
  });
  const r = extractGeneric(doc, shape);
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "pre");
  assert.equal(r.title, "Greensleeves");
  assert.equal(r.text.split("\n\n").length, 2);
});

test("generic: strategy 3 — deepest element whose text passes, one per stave", () => {
  const lines = TAB.split("\n").map((l) => el("div", {}, [l]));
  const stave = el("div", { class: "stave" }, lines);
  const doc = document({
    title: "Song | Site",
    body: [el("div", {}, [el("div", {}, [stave]), el("p", {}, ["words"]), el("div", { class: "stave" }, TAB.split("\n").map((l) => el("div", {}, [l])))])],
  });
  const r = extractGeneric(doc, shape);
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "deepest");
  assert.equal(r.title, "Song");
  assert.equal(shape.tabLineCount(r.text), 12);
  assert.ok(r.text.includes("e|--0--2--3--|"));
});

test("generic: strategy 4 — body text as a last resort", () => {
  const doc = document({ title: "T", body: TAB.split("\n").map((l) => el("span", {}, [l, el("br")])) });
  const r = extractGeneric(doc, shape);
  assert.equal(r.ok, true);
  assert.equal(r.strategy, "body");
});

test("generic: nothing tab-shaped gives null; player-only sites are unsupported", () => {
  assert.equal(extractGeneric(document({ body: [el("p", {}, ["hello"])] }), shape), null);
  const r = extractGeneric(document({ hostname: "www.songsterr.com", body: [el("pre", {}, [TAB])] }), shape);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported");
  assert.equal(isPlayerOnlyHost("songsterr.com"), true);
  assert.equal(isPlayerOnlyHost("example.com"), false);
});

test("generic: og:title beats h1 beats document.title; site suffixes are removed", () => {
  const doc = document({
    title: "Ignored",
    head: [el("meta", { property: "og:title", content: "Wildwood Flower Tab | Tabs Site" })],
    body: [el("pre", {}, [TAB])],
  });
  assert.equal(extractGeneric(doc, shape).title, "Wildwood Flower");
  assert.equal(cleanPageTitle("Scarborough Fair (guitar tab) - Site"), "Scarborough Fair");
  assert.equal(cleanPageTitle("Just A Title"), "Just A Title");
});

test("ultimate-guitar: strategy 1 — the embedded store JSON", () => {
  const store = {
    store: { page: { data: { tab: { song_name: "Greensleeves", artist_name: "Traditional", type: "Tab" }, tab_view: { wiki_tab: { content: "[tab]" + TAB + "[/tab]" }, meta: { tuning: { name: "Drop D", value: "D A D G B E" }, capo: 2 } } } } },
  };
  const doc = document({
    hostname: "tabs.ultimate-guitar.com",
    title: "GREENSLEEVES TAB by Traditional @ Ultimate-Guitar.Com",
    body: [el("div", { class: "js-store", "data-content": JSON.stringify(store) }), el("pre", {}, ["something else entirely"])],
  });
  const r = extractUltimateGuitar(doc, shape);
  assert.equal(r.ok, true);
  assert.equal(r.site, "ultimate-guitar");
  assert.equal(r.strategy, "store");
  assert.equal(r.title, "Greensleeves");
  assert.equal(r.artist, "Traditional");
  assert.equal(r.tuning, "D A D G B E");
  assert.equal(r.capo, 2);
  assert.ok(r.text.includes("[tab]"));
});

test("ultimate-guitar: player-only tab types are reported as unsupported", () => {
  const store = { store: { page: { data: { tab: { song_name: "X", artist_name: "Y", type: "Pro" }, tab_view: { wiki_tab: { content: "" } } } } } };
  const doc = document({ hostname: "tabs.ultimate-guitar.com", title: "X GUITAR PRO by Y @ Ultimate-Guitar.Com", body: [el("div", { "data-content": JSON.stringify(store) + " ".repeat(60) })] });
  const r = extractUltimateGuitar(doc, shape);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported");
  const noStore = document({ hostname: "tabs.ultimate-guitar.com", title: "X OFFICIAL by Y @ Ultimate-Guitar.Com", body: [] });
  assert.equal(extractUltimateGuitar(noStore, shape).reason, "unsupported");
});

test("ultimate-guitar: no store falls through to generic but keeps title and artist", () => {
  const doc = document({
    hostname: "tabs.ultimate-guitar.com",
    title: "HOUSE OF THE RISING SUN CHORDS by Traditional @ Ultimate-Guitar.Com",
    body: [el("pre", {}, [TAB])],
  });
  const r = extractFromPage(doc, shape, sites);
  assert.equal(r.ok, true);
  assert.equal(r.site, "ultimate-guitar");
  assert.equal(r.title, "House Of The Rising Sun");
  assert.equal(r.artist, "Traditional");
  assert.equal(r.strategy, "pre");
});

test("ultimate-guitar: helpers", () => {
  assert.equal(isUltimateGuitarHost("tabs.ultimate-guitar.com"), true);
  assert.equal(isUltimateGuitarHost("ultimate-guitar.com"), true);
  assert.equal(isUltimateGuitarHost("notultimate-guitar.com"), false);
  assert.deepEqual(parseUltimateGuitarTitle("SONG NAME BASS TAB by The Band @ Ultimate-Guitar.Com"), { title: "Song Name", artist: "The Band", type: "bass tab" });
  assert.equal(parseUltimateGuitarTitle("Random page"), null);
  assert.equal(findInJson({ a: { b: { song_name: "x" } } }, "song_name").song_name, "x");
  assert.equal(findInJson({ a: 1 }, "song_name"), null);
  assert.equal(extractUltimateGuitar(document({ hostname: "example.com" }), shape), null);
});

test("extractFromPage: nothing found, and errors inside the page never throw", () => {
  const empty = extractFromPage(document({ body: [] }), shape, sites);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, "none");
  // Every result carries a note of what the page looked like, for the console.
  assert.equal(typeof empty.seen, "object");
  assert.equal(empty.seen.chordLines, 0);
  const broken = { location: { hostname: "example.com" }, get title() { throw new Error("boom"); } };
  const r = extractFromPage(broken, shape, sites);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "error");
  assert.equal(typeof r.message, "string");
});

test("injected.js is up to date and runs as a plain script with no imports", () => {
  const built = buildInjected();
  const onDisk = readFileSync(new URL("../" + OUTPUT, import.meta.url), "utf8");
  assert.equal(onDisk, built, "src/extract/injected.js is stale: run `npm run build`");
  assert.ok(!/^\s*(import|export)\s/m.test(built));
  assert.ok(!/\b(fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/.test(built), "the injected script must never talk to the network");

  const doc = document({ title: "Song - Site", body: [el("pre", {}, [TAB])] });
  const result = vm.runInNewContext(built, { document: doc });
  assert.equal(result.ok, true);
  assert.equal(result.text.trim(), TAB);
  assert.equal(result.title, "Song");
});

const CHORD_PAGE_LINES = ["Verse 1", "G", "Em", "I found a love for me", "C", "Darling, just dive right in", "D", "And follow my lead"];

test("generic: a chord page is found even though it has no dashes anywhere", () => {
  // The layout modern chord pages use: every chord in its own element, the
  // words in theirs. Nothing here would ever pass the tab-shape heuristic.
  const song = el("div", { class: "song" }, CHORD_PAGE_LINES.map((l) => el("div", {}, [l])));
  const doc = document({
    hostname: "guitartuna.com",
    title: "Perfect chords by Ed Sheeran",
    body: [el("nav", {}, [el("a", {}, ["Chords & Tabs"]), el("a", {}, ["Tools"])]), song, el("footer", {}, ["© Yousician Oy 2026"])],
  });
  const r = extractGeneric(doc, shape);
  assert.equal(r.ok, true);
  assert.equal(r.title, "Perfect chords by Ed Sheeran");
  assert.ok(r.text.includes("I found a love for me"));
  assert.ok(r.text.includes("Em"));
});

test("generic: a chord legend on its own is not a song", () => {
  const legend = el("div", {}, ["Chords", "E", "C#m", "G#m", "B", "A"].map((l) => el("div", {}, [l])));
  const doc = document({ title: "Some page", body: [legend] });
  assert.equal(extractGeneric(doc, shape), null);
});

test("the injected script finds a chord page, not just tab", () => {
  const built = buildInjected();
  const song = el("div", {}, CHORD_PAGE_LINES.map((l) => el("div", {}, [l])));
  const doc = document({ hostname: "example.com", title: "Perfect chords by Ed Sheeran", body: [song] });
  const result = vm.runInNewContext(built, { document: doc });
  assert.equal(result.ok, true);
  assert.ok(result.text.includes("I found a love for me"));
});

test("describePage reports what the extractor saw, for the console", () => {
  const song = el("div", {}, CHORD_PAGE_LINES.map((l) => el("div", {}, [l])));
  const doc = document({ hostname: "example.com", title: "Perfect chords by Ed Sheeran", body: [song] });
  const seen = describePage(doc, shape);
  assert.equal(seen.build, "dev"); // "dev" under Node; a hash in the built script
  assert.ok(seen.chars > 0);
  assert.equal(seen.chordLines, 4); // G, Em, C, D
  assert.equal(seen.looksLikeChords, true);
  assert.equal(seen.looksLikeTab, false);

  const tabDoc = document({ title: "T", body: [el("pre", {}, [TAB])] });
  const tabSeen = describePage(tabDoc, shape);
  assert.equal(tabSeen.looksLikeTab, true);
  assert.equal(tabSeen.pres, 1);
});

test("a successful extraction reports the running build", () => {
  const doc = document({ title: "Song - Site", body: [el("pre", {}, [TAB])] });
  const built = buildInjected();
  const result = vm.runInNewContext(built, { document: doc });
  assert.equal(result.ok, true);
  assert.match(result.seen.build, /^[0-9a-f]{8}$/);

});
