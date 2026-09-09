import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { el, document } from "./helpers/fake-dom.js";
import * as shape from "../src/parse/tabshape.js";
import { extractUltimateGuitar, parseUltimateGuitarTitle, findInJson, isUltimateGuitarHost } from "../src/extract/sites/ultimate-guitar.js";
import { extractGeneric, cleanPageTitle, isPlayerOnlyHost } from "../src/extract/sites/generic.js";
import { extractFromPage, describePage } from "../src/extract/sites/page.js";
import { findScoreImages } from "../src/extract/sites/score-canvas.js";
import { toGray } from "../src/read/image.js";
import { renderTab } from "./helpers/draw.js";
import { buildInjected, OUTPUT } from "../tools/build-injected.js";

const TAB = "e|--0--2--3--|\nB|-----------|\nG|--2--2--2--|\nD|-----------|\nA|-----------|\nE|-----------|";
const sites = { ultimateGuitar: extractUltimateGuitar, generic: extractGeneric, scoreCanvas: findScoreImages };

/**
 * A <canvas> with something painted on it, of the shape the extractor uses:
 * width and height, a 2d context that hands back RGBA, somewhere on the
 * screen, and a parent that scrolls. `picture` is grey, one byte a pixel.
 *
 * `refuses` is the name of the DOMException it throws when asked for its
 * pixels; `webgl` makes it a canvas with no 2d context at all; `at` puts it
 * somewhere other than the top left of the window.
 */
function canvas(picture, { scroll = null, refuses = null, webgl = false, at = { x: 0, y: 0 }, alpha = 255 } = {}) {
  const node = el("canvas", {});
  node.width = picture.width;
  node.height = picture.height;
  node.getBoundingClientRect = () => (at ? { left: at.x, top: at.y, width: at.width || picture.width, height: at.height || picture.height } : { left: 0, top: 0, width: 0, height: 0 });
  node.getContext = (kind) => {
    if (kind !== "2d" || webgl) return null;
    return {
      getImageData(x, y, w, h) {
        // A canvas holding pixels from another site, or one drawn in a
        // worker, throws instead of answering.
        if (refuses) {
          const err = new Error("the canvas would not hand its pixels over");
          err.name = refuses;
          throw err;
        }
        const data = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const v = picture.gray[i];
          data[i * 4] = v;
          data[i * 4 + 1] = v;
          data[i * 4 + 2] = v;
          data[i * 4 + 3] = alpha;
        }
        return { data, width: w, height: h };
      },
    };
  };
  node.parentElement = scroll ? { scrollTop: scroll.top, scrollHeight: scroll.height, clientHeight: scroll.visible, parentElement: null } : null;
  return node;
}

const DRAWN_TAB = ["|--0--2--3--2--|--0--------|", "|--------------|--1--------|", "|--------------|--0--------|", "|--2--2--2--2--|--2--------|", "|--------------|--3--------|", "|--3-----------|-----------|"].join("\n");

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

// --------------------------------------------------------------------------
// Pages that draw their tab instead of writing it
// --------------------------------------------------------------------------

test("findScoreImages: a canvas with music on it comes back as pixels", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({ hostname: "tabs.ultimate-guitar.com", title: "(1) OFFICIAL THE TROOPER CHORDS & TABS by Iron Maiden @ Ultimate-Guitar.Com", body: [el("div", {}, [canvas(picture, { scroll: { top: 0, height: 8133, visible: 887 } })])] });
  const { images, skipped, shots } = findScoreImages(doc);
  const [found, ...rest] = images;
  assert.equal(rest.length, 0);
  assert.equal(found.width, picture.width);
  assert.equal(found.height, picture.height);
  assert.equal(found.gray.length, picture.width * picture.height);
  assert.ok(found.content > 0.002 && found.content < 0.5, `${found.content} of it should be ink`);
  // How much of the score was on screen, so the popup can say so.
  assert.deepEqual(found.scroll, { top: 0, height: 8133, visible: 887 });
  // A canvas we read is never photographed: we already have better pixels.
  assert.deepEqual(skipped, []);
  assert.deepEqual(shots, []);
});

test("findScoreImages: a canvas that will not hand its pixels over is offered as a photograph", () => {
  // Ultimate Guitar's Official player: the score is on a canvas the page
  // draws through WebGL, with a cursor layer over it that we may read and
  // that has nothing on it. Reading the pixels is impossible; photographing
  // the screen is not, so the rectangle comes back instead of nothing.
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const blank = { width: picture.width, height: picture.height, gray: new Uint8Array(picture.width * picture.height).fill(255) };
  const doc = document({
    hostname: "tabs.ultimate-guitar.com",
    view: { width: 1280, height: 900, dpr: 2 },
    body: [el("div", {}, [canvas(blank, { at: { x: 40, y: 120 } }), canvas(picture, { webgl: true, at: { x: 40, y: 120 } })])],
  });
  const { images, skipped, shots, view } = findScoreImages(doc);
  assert.deepEqual(images, [], "there is nothing here we are allowed to read");
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["blank", "no-2d-context"],
    "and the reason for each is written down rather than swallowed"
  );
  assert.equal(shots.length, 1, "only the one whose pixels are out of reach is worth a photograph");
  assert.equal(shots[0].reason, "no-2d-context");
  assert.deepEqual(shots[0].rect, { x: 40, y: 120, width: picture.width, height: picture.height });
  assert.deepEqual(view, { width: 1280, height: 900, dpr: 2 });
});

test("findScoreImages: a canvas off the bottom of the window is not photographed", () => {
  // A photograph holds the window and no more, so there is no point offering
  // one for a player the person has scrolled past.
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({ view: { width: 1280, height: 900, dpr: 1 }, body: [el("div", {}, [canvas(picture, { webgl: true, at: { x: 40, y: 1400 } })])] });
  const { images, skipped, shots } = findScoreImages(doc);
  assert.deepEqual(images, []);
  assert.deepEqual(skipped.map((s) => s.reason), ["no-2d-context"]);
  assert.deepEqual(shots, []);
});

test("findScoreImages: a refusal is named by what the browser called it", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({
    body: [
      el("div", {}, [
        canvas(picture, { refuses: "SecurityError" }), // pixels from another site
        canvas(picture, { refuses: "InvalidStateError" }), // control passed to a worker
        canvas(picture, { refuses: "TypeError" }), // something else again
      ]),
    ],
  });
  const { skipped, shots } = findScoreImages(doc);
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["blocked", "transferred", "unreadable"]
  );
  // All three are still on the screen, so all three could be photographed —
  // but only as many as the popup will read.
  assert.equal(shots.length, 2);
});

test("findScoreImages greys a see-through canvas exactly as the reader would", () => {
  // Both paths blend transparency onto white, and they have to round it the
  // same way: a grey one off here is a pixel the threshold can put on the
  // other side of the ink line, so the same score would read differently
  // depending on whether it came off the page or out of a dropped file.
  // Solid black alone would not catch it — the blend only lands between two
  // whole numbers when the pixel is a middling grey, so this picture is one.
  const width = 240;
  const height = 80;
  const size = width * height;
  const gray = new Uint8Array(size).fill(255);
  for (let i = 0; i < size; i++) {
    if (i % 25 === 0) gray[i] = 0; // ink, dark whatever the transparency
    else if (i % 25 === 1) gray[i] = 1 + (i % 92); // the greys that round awkwardly
  }
  const picture = { width, height, gray };
  for (const alpha of [128, 199, 254]) {
    const [found] = findScoreImages(document({ body: [el("div", {}, [canvas(picture, { alpha })])] })).images;
    assert.ok(found, `alpha ${alpha} should still read as a score`);
    const data = new Uint8ClampedArray(size * 4);
    for (let i = 0; i < size; i++) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray[i];
      data[i * 4 + 3] = alpha;
    }
    assert.deepEqual(found.gray, toGray({ width, height, data }).gray, `alpha ${alpha} greys differently from read/image.js`);
  }
});

test("findScoreImages: icons, blank overlays and canvases it may not read are skipped", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const tiny = { width: 40, height: 40, gray: new Uint8Array(1600).fill(0) };
  const blank = { width: 400, height: 300, gray: new Uint8Array(120000).fill(255) };
  const doc = document({
    body: [
      el("div", {}, [
        canvas(tiny), // an avatar or a tuner dial
        canvas(blank), // the playing-cursor layer, painted on only while playing
        canvas(picture, { refuses: "SecurityError" }), // pixels from another site
        canvas(picture, { webgl: true }), // not a 2d canvas at all
        canvas(picture),
      ]),
    ],
  });
  const { images, skipped } = findScoreImages(doc);
  assert.equal(images.length, 1);
  assert.equal(images[0].width, picture.width);
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["tiny", "blank", "blocked", "no-2d-context"]
  );
});

test("extractFromPage: a page with no text but a score on a canvas hands back the pixels", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({
    hostname: "tabs.ultimate-guitar.com",
    title: "(1) OFFICIAL THE TROOPER CHORDS & TABS by Iron Maiden @ Ultimate-Guitar.Com",
    body: [el("h1", {}, ["Official The Trooper Tab"]), el("div", {}, [canvas(picture)])],
  });
  const r = extractFromPage(doc, shape, sites);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported");
  assert.equal(r.score.length, 1);
  assert.equal(r.seen.canvases, 1);
  assert.equal(r.shots, undefined, "there is nothing to photograph when the pixels are already in hand");
  // The song's name still comes off the page, even though its notes did not.
  assert.equal(r.title, "The Trooper");
  assert.equal(r.artist, "Iron Maiden");
});

test("extractFromPage: a page whose tab is text is never asked for its pixels", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({ title: "Greensleeves Tab", body: [el("pre", {}, [TAB]), el("div", {}, [canvas(picture)])] });
  const r = extractFromPage(doc, shape, sites);
  assert.equal(r.ok, true);
  assert.equal(r.score, undefined, "copying a megabyte of pixels off a page that gave us the text is pure waste");
});

test("extractFromPage: a page with neither text nor a canvas is unchanged", () => {
  const r = extractFromPage(document({ body: [el("p", {}, ["nothing here"])] }), shape, sites);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "none");
  assert.equal(r.score, undefined);
  assert.equal(r.seen.canvases, 0);
  assert.equal(r.seen.canvasSkipped, undefined);
});

test("extractFromPage: a player whose canvas is out of reach comes back as a rectangle to photograph", () => {
  const picture = renderTab(DRAWN_TAB, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
  const doc = document({
    hostname: "tabs.ultimate-guitar.com",
    title: "(1) OFFICIAL THE TROOPER CHORDS & TABS by Iron Maiden @ Ultimate-Guitar.Com",
    view: { width: 1280, height: 900, dpr: 2 },
    body: [el("div", {}, [canvas(picture, { webgl: true, at: { x: 12, y: 60 } })])],
  });
  const r = extractFromPage(doc, shape, sites);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unsupported");
  assert.equal(r.score, undefined);
  assert.equal(r.shots.length, 1);
  assert.deepEqual(r.view, { width: 1280, height: 900, dpr: 2 });
  // The one line in the console that says which kind of nothing this was.
  assert.equal(r.seen.canvases, 0);
  assert.equal(r.seen.canvasSkipped, `${picture.width}x${picture.height} no-2d-context`);
  assert.equal(r.title, "The Trooper");
});

test("the page title of a real Official tab is read the way the site writes it", () => {
  // Straight off tabs.ultimate-guitar.com: an unread-messages count in front,
  // "CHORDS & TABS" rather than "TAB", and the word "OFFICIAL" sitting inside
  // the song's name. All three used to make this hand back nothing at all, so
  // an Official page lost its song title as well as its notes.
  const real = parseUltimateGuitarTitle("(1) OFFICIAL THE TROOPER CHORDS & TABS by Iron Maiden @ Ultimate-Guitar.Com");
  assert.deepEqual(real, { title: "The Trooper", artist: "Iron Maiden", type: "official" });
});
