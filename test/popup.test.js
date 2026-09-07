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
      getManifest: () => ({ version: "0.1.6" }),
      sendMessage: async (msg) => { calls.push(["sendMessage", msg]); return scenario.reply; },
      openOptionsPage: async () => { calls.push(["openOptionsPage"]); },
    },
    tabs: {
      query: async () => [{ id: 7, url: scenario.url }],
      create: async (o) => { calls.push(["tabs.create", o.url]); },
    },
    scripting: {
      executeScript: async (o) => {
        calls.push(["executeScript", { files: o.files || null, func: !!o.func }]);
        if (o.files) {
          if (scenario.extractThrows) throw new Error("Missing host permission for the tab");
          // The real script parks its answer on a global as well as returning it.
          globalThis["__tab2rollResult"] = scenario.extract;
          // Firefox does not always hand back a file-injected script's value.
          return scenario.noCompletionValue ? [{}] : [{ result: scenario.extract }];
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
    assert.equal(await text(page, "#version"), "Version 0.1.6");

    await page.click("#main-button");
    await page.waitForSelector("#view-success:not([hidden])");
    assert.equal(await text(page, "#saved-filename"), "Saved Trad. - Greensleeves (tab).mid");
    assert.ok((await text(page, "#view-success")).includes("It's in your Downloads folder."));
    assert.ok((await text(page, "#view-success")).includes("Open FL Studio, then drag this file from your Downloads folder onto the playlist."));
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
    await page.click("#link-help");
    await page.click("#link-settings");
    const after = await page.evaluate(() => window.__calls);
    assert.deepEqual(after.filter((c) => c[0] === "tabs.create").map((c) => c[1]), ["/ui/help.html#fl-studio", "/ui/help.html"]);
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
