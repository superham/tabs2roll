// Browser smoke test for the popup: serves src/ over HTTP, stubs the
// `browser.*` extension API, and walks through the popup's states in a
// headless Chromium. Skipped when Playwright is not installed globally.
//
// This does not replace trying the extension in Firefox (web-ext run); it
// catches wiring mistakes in popup.js without a browser session.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { STRINGS } from "../src/strings.js";
import { renderTab, createImage } from "./helpers/draw.js";
import { writePng } from "../tools/png.js";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const TAB = "e|--0--2--3--|\nB|-----------|\nG|--2--2--2--|\nD|-----------|\nA|-----------|\nE|-----------|";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

async function loadPlaywright() {
  for (const candidate of ["playwright", "/opt/node22/lib/node_modules/playwright/index.mjs", "/usr/lib/node_modules/playwright/index.mjs"]) {
    try {
      if (candidate.startsWith("/") && !existsSync(candidate)) continue;
      return await import(candidate);
    } catch (err) {
      // try the next one
    }
  }
  return null;
}

function serve() {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(SRC, path);
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch (err) {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

/**
 * The fake `browser` object. `scenario` controls what the page "contains"
 * and what the background "replies"; it is serialised into the page.
 */
const STUB = (scenario) => `
  const scenario = ${JSON.stringify(scenario)};
  const calls = [];
  window.__calls = calls;
  window.browser = {
    runtime: {
      id: "test",
      getURL: (p) => "/" + p,
      getManifest: () => ({ version: "0.2.0" }),
      sendMessage: async (msg) => { calls.push(["sendMessage", msg]); return scenario.reply; },
      openOptionsPage: async () => { calls.push(["openOptionsPage"]); },
    },
    tabs: {
      query: async () => [{ id: 7, url: scenario.url, windowId: 3 }],
      create: async (o) => { calls.push(["tabs.create", o.url]); },
      captureVisibleTab: async (windowId, options) => {
        calls.push(["captureVisibleTab", { windowId: windowId === undefined ? null : windowId, format: options && options.format }]);
        if (scenario.photoFails) throw new Error("Missing activeTab permission");
        return scenario.photo || null;
      },
    },
    scripting: {
      executeScript: async (o) => {
        calls.push(["executeScript", { files: o.files || null, func: !!o.func }]);
        if (o.files) {
          if (scenario.extractThrows) throw new Error("Missing host permission for the tab");
          // A page being read a screenful at a time looks different on every
          // pass; scenario.extracts is that sequence, and the last one stands.
          const queue = scenario.extracts;
          const extract = queue && queue.length ? queue[Math.min(calls.filter((c) => c[0] === "executeScript" && c[1].files).length - 1, queue.length - 1)] : scenario.extract;
          // The real script parks its answer on a global as well as returning it.
          globalThis["__tab2rollResult"] = extract;
          // Firefox does not always hand back a file-injected script's value.
          return scenario.noCompletionValue ? [{}] : [{ result: extract }];
        }
        // The injection that scrolls the page is the one that scrolls. There
        // is no page to scroll here, so the scenario says what it did.
        if (String(o.func).includes("scrollTo")) {
          calls.push(["scroll", o.args]);
          const steps = scenario.scrolls || [];
          const done = calls.filter((c) => c[0] === "scroll").length - 1;
          return [{ result: steps[Math.min(done, steps.length - 1)] || null }];
        }
        return [{ result: o.func.apply(null, o.args || []) }];
      },
    },
  };
`;

const playwright = await loadPlaywright();

test("popup smoke test in Chromium", { skip: !playwright && "playwright not available" }, async (t) => {
  const { server, port } = await serve();
  const browser = await playwright.chromium.launch();
  t.after(async () => {
    await browser.close();
    server.close();
  });

  async function open(scenario, { localStorage = {} } = {}) {
    const context = await browser.newContext();
    await context.addInitScript(STUB(scenario));
    await context.addInitScript((entries) => {
      try {
        localStorage.clear();
        for (const [k, v] of entries) localStorage.setItem(k, v);
      } catch (err) {
        // ignore
      }
    }, Object.entries(localStorage));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/ui/popup.html`);
    await page.waitForSelector("#view-checking[hidden]", { state: "attached", timeout: 5000 });
    return { page, errors, context };
  }

  const visible = (page, sel) => page.$eval(sel, (el) => !el.hidden && el.offsetParent !== null).catch(() => false);
  const text = (page, sel) => page.$eval(sel, (el) => el.textContent.trim());

  await t.test("tab found on the page -> title shown -> click -> confirmation", async () => {
    const reply = { ok: true, filename: "Trad. - Greensleeves (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "standard", tracks: ["Guitar (as tabbed)", "Lead"], title: "Greensleeves" };
    const { page, errors } = await open({ url: "https://tabs.ultimate-guitar.com/x", extract: { ok: true, site: "ultimate-guitar", text: TAB, title: "Greensleeves", artist: "Trad." }, reply });
    assert.equal(await visible(page, "#view-found"), true);
    assert.equal(await text(page, "#song-title"), "Greensleeves — Trad.");
    assert.equal(await text(page, "#found-label"), "Found a tab:");
    assert.equal(await visible(page, "#main-action"), true);
    assert.equal(await text(page, "#main-button .label"), "Send to my DAW");
    assert.equal(await visible(page, "#paste-body"), false);
    // The installed version is shown so a stale add-on is obvious at a glance.
    assert.equal(await text(page, "#version"), "Version 0.2.0");

    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    assert.equal(await text(page, "#saved-filename"), "Saved Trad. - Greensleeves (tab).mid");
    assert.ok((await text(page, "#view-success")).includes("It's in your Downloads folder."));
    assert.ok((await text(page, "#view-success")).includes(STRINGS.popup.nextSteps));
    assert.ok((await text(page, "#view-success")).includes(STRINGS.popup.dragDidNothing));
    assert.equal(await text(page, "#rhythm-note"), "The timing is a best guess — you may need to nudge some notes.");
    assert.equal(await visible(page, "#chords-note"), false);
    assert.equal(await visible(page, "#main-action"), false);
    assert.equal(await page.$eval("#tuning-select", (el) => el.value), "standard");

    const calls = await page.evaluate(() => window.__calls);
    const sent = calls.find((c) => c[0] === "sendMessage")[1];
    assert.equal(sent.type, "tab2roll:convert");
    assert.equal(sent.text, TAB);
    assert.equal(sent.meta.source, "ultimate-guitar");
    assert.equal(sent.meta.title, "Greensleeves");
    assert.equal(sent.options.step, "1/8");
    assert.equal(sent.options.arrange, true);
    assert.equal(calls.find((c) => c[0] === "executeScript")[1].files[0], "/extract/injected.js");

    // The confirmation is remembered for the next time the popup opens.
    const stored = await page.evaluate(() => localStorage.getItem("tab2roll:lastResult"));
    assert.ok(stored && JSON.parse(stored).filename === reply.filename);

    // "Wrong tuning? Re-do as:" re-runs the conversion with the chosen tuning.
    await page.selectOption("#tuning-select", "drop-d");
    await page.waitForFunction(() => window.__calls.filter((c) => c[0] === "sendMessage").length === 2);
    const redo = (await page.evaluate(() => window.__calls)).filter((c) => c[0] === "sendMessage")[1][1];
    assert.equal(redo.options.tuningId, "drop-d");
    assert.equal(redo.options.filenameSuffix, "Drop D");

    // Show me how / help / settings open bundled pages, never external URLs.
    await page.click("#show-me-how");
    await page.click("#drag-trouble");
    await page.click("#link-help");
    await page.click("#link-settings");
    const after = await page.evaluate(() => window.__calls);
    assert.deepEqual(after.filter((c) => c[0] === "tabs.create").map((c) => c[1]), ["/ui/help.html#fl-studio", "/ui/help.html#drag-does-nothing", "/ui/help.html"]);
    assert.ok(after.some((c) => c[0] === "openOptionsPage"));
    assert.deepEqual(errors, []);
  });

  await t.test("the answer is collected separately when the browser returns nothing for the file", async () => {
    // Firefox's behaviour: executeScript resolves, but with no value for a
    // file injection. The extractor still ran, so its answer is fetched with
    // a second, function-based injection instead of the page reading as empty.
    const reply = { ok: true, filename: "A - B (tab).mid", kind: "chords", rhythmSource: "guessed", tuningId: null, tracks: ["Guitar (as tabbed)"], title: "B" };
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/x",
      extract: { ok: true, site: "ultimate-guitar", text: "Am      C\nsome words here\nF       G\nmore words here\nAm      C\nlast words here", title: "Covet", artist: "Basement" },
      reply,
      noCompletionValue: true,
    });
    assert.equal(await visible(page, "#view-found"), true);
    assert.equal(await text(page, "#song-title"), "Covet — Basement");
    const calls = await page.evaluate(() => window.__calls.filter((c) => c[0] === "executeScript").map((c) => c[1]));
    assert.equal(calls.length, 2, "should fall back to a second injection");
    assert.deepEqual(calls[0].files, ["/extract/injected.js"]);
    assert.equal(calls[1].func, true);
    assert.deepEqual(errors, []);
  });

  await t.test("nothing on the page -> message + paste box, no dead button; paste -> button -> success", async () => {
    const reply = { ok: true, filename: "guitar-tab.mid", kind: "chords", rhythmSource: "guessed", tuningId: null, tracks: ["Guitar (as tabbed)", "Chords", "Bass"], title: "" };
    const { page, errors } = await open({ url: "https://example.com/", extract: { ok: false, reason: "none" }, reply });
    assert.equal(await visible(page, "#view-notfound"), true);
    assert.equal(await text(page, "#notfound-message"), "I couldn't find any tab on this page. Make sure you're on a tab page and that it's finished loading.");
    assert.equal(await visible(page, "#main-action"), false);
    assert.equal(await visible(page, "#paste-body"), true);

    await page.fill("#paste-text", "just words");
    assert.equal(await text(page, "#paste-status"), "I can't see any tab in that yet. Paste the whole thing, including the lines of dashes.");
    assert.equal(await visible(page, "#main-action"), false);

    await page.fill("#paste-text", "C  G  Am  F\nla la la\nF  G  C\nla la");
    assert.equal(await text(page, "#paste-status"), "That looks like a chord sheet. Ready when you are.");
    assert.equal(await visible(page, "#main-action"), true);
    assert.equal(await text(page, "#main-subtext"), "Uses the tab you pasted below.");

    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    assert.equal(await text(page, "#chords-note"), "This is a chord sheet, so I made the chords and a bassline.");
    assert.equal(await visible(page, ".tuning-row"), false);
    const sent = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "sendMessage")[1];
    assert.equal(sent.meta.source, "paste");
    assert.deepEqual(errors, []);
  });

  await t.test("an extension page is not read at all, and never reported as a page with no tab on it", async () => {
    // What actually went wrong on a real machine: the onboarding page opened
    // on every reload of the temporary add-on and took the active tab, so the
    // popup aimed at moz-extension://.../onboarding.html. Firefox blocks
    // injection there and returns an entry carrying an error rather than
    // throwing, which read as "no tab on this page".
    const { page, errors } = await open({ url: "moz-extension://abc/ui/onboarding.html", extract: { ok: true, site: "generic", text: TAB, title: "X", artist: "" }, reply: null });
    assert.equal(await visible(page, "#view-notfound"), true);
    assert.equal(await visible(page, "#paste-body"), true);
    const injections = await page.evaluate(() => window.__calls.filter((c) => c[0] === "executeScript"));
    assert.deepEqual(injections, [], "must not try to inject into an extension page");
    assert.deepEqual(errors, []);
  });

  await t.test("unsupported page and a page Firefox will not let us read", async () => {
    const a = await open({ url: "https://tabs.ultimate-guitar.com/pro", extract: { ok: false, reason: "unsupported" }, reply: null });
    assert.equal(await text(a.page, "#notfound-message"), "This tab is in a format I can't read yet. Try one of the text tabs for this song.");
    const b = await open({ url: "about:blank", extractThrows: true, reply: null });
    assert.equal(await visible(b.page, "#view-notfound"), true);
    assert.equal(await visible(b.page, "#paste-body"), true);
    assert.deepEqual(a.errors.concat(b.errors), []);
  });

  await t.test("conversion failure shows plain words and opens the paste box", async () => {
    const { page, errors } = await open({ url: "https://example.com/tab", extract: { ok: true, site: "generic", text: TAB, title: "X", artist: "" }, reply: { ok: false, code: "no-notes" } });
    await page.click("#main-button");
    await page.waitForSelector("#view-error:not([hidden])");
    assert.equal(await text(page, "#error-message"), "I found the tab but couldn't make sense of it. Try pasting the tab text in below and I'll have another go.");
    assert.equal(await visible(page, "#paste-body"), true);
    assert.equal(await visible(page, "#main-action"), false);
    assert.deepEqual(errors, []);
  });

  await t.test("a recent conversion on the same page is shown again on open", async () => {
    const last = { filename: "A - B (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "drop-d", tracks: ["Guitar (as tabbed)"], pageUrl: "https://example.com/tab", at: Date.now() - 60 * 1000 };
    const { page, errors } = await open(
      { url: "https://example.com/tab", extract: { ok: true, site: "generic", text: TAB, title: "X", artist: "" }, reply: null },
      { localStorage: { "tab2roll:lastResult": JSON.stringify(last) } },
    );
    await page.waitForSelector("#view-success:not([hidden])");
    assert.equal(await visible(page, "#recent-heading"), true);
    assert.equal(await text(page, "#saved-filename"), "Saved A - B (tab).mid");
    await page.click("#convert-another");
    await page.waitForSelector("#view-found:not([hidden])");
    assert.equal(await page.evaluate(() => localStorage.getItem("tab2roll:lastResult")), null);

    // Too old, or a different page: back to the normal flow.
    const stale = { ...last, at: Date.now() - 20 * 60 * 1000 };
    const c = await open({ url: "https://example.com/tab", extract: { ok: true, site: "generic", text: TAB, title: "X", artist: "" }, reply: null }, { localStorage: { "tab2roll:lastResult": JSON.stringify(stale) } });
    assert.equal(await visible(c.page, "#view-found"), true);
    const other = await open({ url: "https://example.com/other", extract: { ok: true, site: "generic", text: TAB, title: "X", artist: "" }, reply: null }, { localStorage: { "tab2roll:lastResult": JSON.stringify(last) } });
    assert.equal(await visible(other.page, "#view-found"), true);
    assert.deepEqual(errors.concat(c.errors, other.errors), []);
  });

  await t.test("a page that draws its tab is read off the screen", async () => {
    // The Ultimate Guitar "Official" tabs, and every other interactive tab
    // player: no tab text anywhere in the page, just a canvas with the music
    // painted on it. The extractor hands back the pixels; the popup reads
    // them and puts what it made of them in the paste box, where they can be
    // checked before being sent.
    const drawn = ["|--0--2--3--2--|--0--------|", "|--------------|--1--------|", "|--------------|--0--------|", "|--2--2--2--2--|--2--------|", "|--------------|--3--------|", "|--3-----------|-----------|"].join("\n");
    const picture = renderTab(drawn, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
    const score = [{ width: picture.width, height: picture.height, gray: Array.from(picture.gray), scroll: { top: 0, height: 4000, visible: 500 } }];
    const reply = { ok: true, filename: "Iron Maiden - The Trooper (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "standard", tracks: ["Guitar (as tabbed)"], title: "The Trooper" };
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/tab/iron-maiden/the-trooper-official-1935205",
      extract: { ok: false, reason: "unsupported", site: "ultimate-guitar", type: "official", title: "The Trooper", artist: "Iron Maiden", score },
      reply,
    });

    assert.equal(await visible(page, "#view-found"), true);
    assert.equal(await text(page, "#found-label"), STRINGS.popup.foundPicture);
    assert.equal(await text(page, "#song-title"), "The Trooper — Iron Maiden");
    // The tab it read is shown, not hidden: a picture read slightly wrong is
    // a mystery until you can see it.
    assert.equal(await visible(page, "#paste-body"), true);
    const box = await page.$eval("#paste-text", (el) => el.value);
    assert.match(box, /^\|[-0-9|]+$/m);
    assert.equal(box.split("\n").length, 6);
    assert.ok((await text(page, "#picture-note")).includes("read off the picture"));
    // The canvas held one screenful of a long song, and says so.
    assert.equal(await visible(page, "#picture-partial"), true);
    assert.match(await text(page, "#picture-partial"), /scroll/i);

    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    const sent = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "sendMessage")[1];
    // It came out of the paste box, but it is still this page's song.
    assert.equal(sent.text, box);
    assert.equal(sent.meta.source, "ultimate-guitar");
    assert.equal(sent.meta.title, "The Trooper");
    assert.equal(sent.meta.artist, "Iron Maiden");
    assert.deepEqual(errors, []);
  });

  await t.test("a player whose canvas will not be read is photographed instead", async () => {
    // Ultimate Guitar's "Official" tabs draw the score onto a canvas the page
    // will not hand over — through WebGL, or from a worker. There are no
    // pixels to take, only a rectangle on the screen, so the popup photographs
    // the window with tabs.captureVisibleTab and reads that instead.
    const drawn = ["|--0--2--3--2--|--0--------|", "|--------------|--1--------|", "|--------------|--0--------|", "|--2--2--2--2--|--2--------|", "|--------------|--3--------|", "|--3-----------|-----------|"].join("\n");
    const picture = renderTab(drawn, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
    // A photograph arrives at the screen's own resolution, which is twice the
    // page's measurements on any ordinary laptop. Getting that scale wrong is
    // the whole difficulty of this route, so the test uses a screen where it
    // is wrong by a factor of two if it is not worked out from the picture.
    const dpr = 2;
    const rect = { x: 30, y: 40, width: picture.width / dpr, height: picture.height / dpr };
    const view = { width: Math.ceil(rect.x + rect.width + 30), height: Math.ceil(rect.y + rect.height + 30), dpr };
    const photo = createImage(view.width * dpr, view.height * dpr, 255);
    for (let y = 0; y < picture.height; y++) {
      for (let x = 0; x < picture.width; x++) photo.gray[(y + rect.y * dpr) * photo.width + x + rect.x * dpr] = picture.gray[y * picture.width + x];
    }
    const shots = [{ reason: "no-2d-context", width: picture.width, height: picture.height, rect, scroll: { top: 0, height: 4000, visible: 500 } }];
    const reply = { ok: true, filename: "Iron Maiden - The Trooper (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "standard", tracks: ["Guitar (as tabbed)"], title: "The Trooper" };
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/tab/iron-maiden/the-trooper-official-1935205",
      extract: { ok: false, reason: "unsupported", site: "ultimate-guitar", type: "official", title: "The Trooper", artist: "Iron Maiden", shots, view },
      photo: "data:image/png;base64," + Buffer.from(writePng(photo)).toString("base64"),
      reply,
    });

    assert.equal(await visible(page, "#view-found"), true);
    assert.equal(await text(page, "#found-label"), STRINGS.popup.foundPicture);
    assert.equal(await text(page, "#song-title"), "The Trooper — Iron Maiden");
    const box = await page.$eval("#paste-text", (el) => el.value);
    assert.match(box, /^\|[-0-9|]+$/m);
    assert.equal(box.split("\n").length, 6, "six strings, read off a photograph of the window");
    // A photograph is a PNG on purpose: a JPEG's smudges turn 7s into 1s.
    const shot = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "captureVisibleTab");
    assert.deepEqual(shot[1], { windowId: 3, format: "png" }, "the window is named rather than left to be guessed at");
    assert.deepEqual(errors, []);
  });

  await t.test("a player that cannot be photographed either says so, and does not throw", async () => {
    const shots = [{ reason: "no-2d-context", width: 800, height: 400, rect: { x: 0, y: 0, width: 800, height: 400 }, scroll: null }];
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/tab/x-official-1",
      extract: { ok: false, reason: "unsupported", site: "ultimate-guitar", type: "official", shots, view: { width: 800, height: 600, dpr: 1 } },
      photoFails: true,
    });
    assert.equal(await visible(page, "#view-notfound"), true);
    assert.equal(await text(page, "#notfound-message"), STRINGS.popup.unsupported);
    assert.equal(await visible(page, "#paste-body"), true);
    assert.deepEqual(errors, []);
  });

  await t.test("\"read the whole song\" scrolls the page, joins the screenfuls and puts it back", async () => {
    // One click reads the screenful that happens to be showing. This walks
    // the rest of the page: read, scroll past the last whole staff, read
    // again, and at the end put the page back where the person left it.
    const screenful = (frets) => {
      const drawn = [`|--${frets}--|`, "|-------|", "|--2----|", "|-------|", "|-------|", "|--3----|"].join("\n");
      const picture = renderTab(drawn, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
      return {
        ok: false,
        reason: "unsupported",
        site: "ultimate-guitar",
        type: "official",
        title: "The Trooper",
        artist: "Iron Maiden",
        score: [{ width: picture.width, height: picture.height, gray: Array.from(picture.gray), rect: { x: 0, y: 0, width: picture.width, height: picture.height }, scroll: { top: 0, height: 4000, visible: 500 } }],
      };
    };
    const reply = { ok: true, filename: "Iron Maiden - The Trooper (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "standard", tracks: ["Guitar (as tabbed)"], title: "The Trooper" };
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/tab/iron-maiden/the-trooper-official-1935205",
      // The first look and the loop's first pass see the same screenful: the
      // page has not moved yet when the button is pressed.
      extracts: [screenful("0"), screenful("0"), screenful("5"), screenful("7")],
      scrolls: [
        { was: 0, top: 400, moved: 400, height: 4000, visible: 500, atEnd: false },
        { was: 400, top: 800, moved: 400, height: 4000, visible: 500, atEnd: false },
        { was: 800, top: 3500, moved: 2700, height: 4000, visible: 500, atEnd: true },
      ],
      reply,
    });

    assert.equal(await visible(page, "#view-found"), true);
    // One screenful so far, so the offer to read the rest is there.
    assert.equal(await visible(page, "#whole-song"), true);
    assert.equal(await text(page, "#whole-song"), STRINGS.popup.wholeSong);
    const first = await page.$eval("#paste-text", (el) => el.value);
    assert.equal(first.split("\n").length, 6);

    await page.click("#whole-song");
    await page.waitForFunction(() => !document.getElementById("whole-song").disabled);
    await page.waitForSelector("#whole-song-status:not([hidden])");
    assert.equal(await visible(page, "#whole-song-status"), true);
    assert.match(await text(page, "#whole-song-status"), /whole song/i);
    assert.equal(await visible(page, "#whole-song"), false, "and nothing left to offer: it is all read");

    const box = await page.$eval("#paste-text", (el) => el.value);
    const blocks = box.split("\n\n");
    assert.equal(blocks.length, 3, "three screenfuls, joined in the order they were read");
    assert.notEqual(blocks[0], blocks[1]);
    assert.equal(blocks[0], first, "and the first of them is what one click had already read");
    // The share-of-the-song line goes away: there is no share left.
    assert.equal(await visible(page, "#picture-partial"), false);

    const scrolls = (await page.evaluate(() => window.__calls)).filter((c) => c[0] === "scroll");
    assert.equal(scrolls.length, 4, "three steps down the page, then home again");
    assert.ok(scrolls[0][1][0] > 0, "each step is worked out from where the last whole staff ended");
    assert.deepEqual(scrolls[3][1].slice(0, 2), [0, 0], "and the page is put back where it was found");

    // What was read is still this page's song, and still sendable.
    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    const sent = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "sendMessage")[1];
    assert.equal(sent.text, box);
    assert.equal(sent.meta.title, "The Trooper");
    assert.deepEqual(errors, []);
  });

  await t.test("a page that will not scroll is read once and says so", async () => {
    const drawn = ["|--0----|", "|-------|", "|--2----|", "|-------|", "|-------|", "|--3----|"].join("\n");
    const picture = renderTab(drawn, { spacing: 15, columnWidth: 8, digitHeight: 11, digitWidth: 7 });
    const score = [{ width: picture.width, height: picture.height, gray: Array.from(picture.gray), rect: { x: 0, y: 0, width: picture.width, height: picture.height }, scroll: { top: 0, height: 4000, visible: 500 } }];
    const { page, errors } = await open({
      url: "https://tabs.ultimate-guitar.com/tab/x-official-1",
      extract: { ok: false, reason: "unsupported", site: "ultimate-guitar", type: "official", title: "Stuck", artist: "Nobody", score },
      scrolls: [{ was: 0, top: 0, moved: 0, height: 4000, visible: 500, atEnd: false }],
    });
    const before = await page.$eval("#paste-text", (el) => el.value);
    await page.click("#whole-song");
    await page.waitForFunction(() => !document.getElementById("whole-song").disabled);
    assert.equal(await visible(page, "#whole-song-status"), true, "a reason nobody can see is no reason at all");
    assert.equal(await text(page, "#whole-song-status"), STRINGS.popup.wholeSongNothing);
    assert.equal(await page.$eval("#paste-text", (el) => el.value), before, "what was already read is left alone");
    assert.deepEqual(errors, []);
  });

  await t.test("a page that draws something with no tab in it says so plainly", async () => {
    const blank = { width: 300, height: 200, gray: Array.from(new Uint8Array(300 * 200).fill(255)) };
    // Something on it, but nothing staff-shaped.
    for (let i = 0; i < 400; i++) blank.gray[(20 + (i % 20) * 7) * 300 + 30 + Math.floor(i / 20) * 9] = 0;
    const { page, errors } = await open({ url: "https://songsterr.com/x", extract: { ok: false, reason: "unsupported", site: "generic", score: [blank] } });
    assert.equal(await visible(page, "#view-notfound"), true);
    assert.equal(await text(page, "#notfound-message"), STRINGS.popup.pictureNoStaves);
    assert.equal(await visible(page, "#paste-body"), true);
    assert.deepEqual(errors, []);
  });

  await t.test("the chords/bass/lead toggle: on by default, explains itself on hover, and is remembered", async () => {
    const reply = { ok: true, filename: "A - B (tab).mid", kind: "tab", rhythmSource: "guessed", tuningId: "standard", tracks: ["Guitar (as tabbed)"], title: "B" };
    const scenario = { url: "https://tabs.ultimate-guitar.com/x", extract: { ok: true, site: "ultimate-guitar", text: TAB, title: "B", artist: "A" }, reply };
    const { page, errors } = await open(scenario);

    // On by default, and offered next to the button rather than buried in settings.
    assert.equal(await visible(page, "#arrange-toggle"), true);
    assert.equal(await page.$eval("#arrange-toggle", (el) => el.checked), true);
    assert.equal(await text(page, ".option-label"), STRINGS.extraTracks.label);

    // The explanation is there for the reading, but only once asked for.
    assert.equal(await visible(page, "#arrange-info-text"), false);
    await page.hover("#arrange-info");
    assert.equal(await visible(page, "#arrange-info-text"), true);
    assert.equal(await text(page, "#arrange-info-text"), STRINGS.extraTracks.info);
    // Reachable without a mouse: the same bubble opens on keyboard focus.
    await page.$eval("#arrange-info", (el) => el.blur());
    await page.focus("#arrange-info");
    assert.equal(await visible(page, "#arrange-info-text"), true);
    assert.equal(await page.$eval("#arrange-info", (el) => el.getAttribute("aria-label")), STRINGS.extraTracks.infoLabel);

    // Turning it off asks for the guitar alone, and the choice is saved.
    await page.uncheck("#arrange-toggle");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tab2roll:options")).arrange), false);
    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    const sent = (await page.evaluate(() => window.__calls)).find((c) => c[0] === "sendMessage")[1];
    assert.equal(sent.options.arrange, false);
    assert.deepEqual(errors, []);

    // A window opened later starts from the saved choice, not from the default.
    const again = await open(scenario, { localStorage: { "tab2roll:options": JSON.stringify({ step: "1/8", arrange: false, splitSections: true }) } });
    assert.equal(await again.page.$eval("#arrange-toggle", (el) => el.checked), false);
    // And the settings page shows the same setting, because it is the same setting.
    await again.page.goto(`http://127.0.0.1:${port}/ui/options.html`);
    await again.page.waitForFunction(() => document.getElementById("arrange"));
    assert.equal(await again.page.$eval("#arrange", (el) => el.checked), false);
    assert.deepEqual(again.errors, []);
  });

  await t.test("the other bundled pages load without errors and fill their strings", async () => {
    for (const path of ["ui/onboarding.html", "ui/help.html", "ui/options.html"]) {
      const context = await browser.newContext();
      await context.addInitScript(STUB({ url: "x", extract: null, reply: null }));
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`http://127.0.0.1:${port}/${path}`);
      await page.waitForFunction(() => document.querySelector("h1") && document.querySelector("h1").textContent.trim().length > 0);
      const empty = await page.$$eval("[data-str]", (els) => els.filter((el) => !el.textContent.trim() && !el.hasAttribute("data-str-attr")).map((el) => el.getAttribute("data-str")));
      assert.deepEqual(empty, [], path);
      assert.deepEqual(errors, [], path);
      if (path.endsWith("options.html")) {
        await page.selectOption("#step", "1/16");
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tab2roll:options")).step), "1/16");
        await page.click("#reset");
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tab2roll:options")).step), "1/8");
      }
    }
  });
});
