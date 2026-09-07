// The background event page, run in a sandbox with a stubbed browser API.
// It is a classic script (not a module), so it is loaded with vm.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SOURCE = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");

function loadBackground({ stored = {}, storageThrows = false } = {}) {
  const installedListeners = [];
  const created = [];
  const store = { ...stored };
  const browser = {
    runtime: {
      id: "tab2roll@test",
      getURL: (path) => "moz-extension://test/" + path,
      onInstalled: { addListener: (fn) => installedListeners.push(fn) },
      onMessage: { addListener: () => {} },
    },
    tabs: { create: async (options) => created.push(options.url) },
    downloads: { onChanged: { addListener: () => {}, removeListener: () => {} } },
  };
  const localStorage = {
    getItem: (key) => {
      if (storageThrows) throw new Error("storage is off");
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem: (key, value) => {
      if (storageThrows) throw new Error("storage is off");
      store[key] = String(value);
    },
  };
  const context = vm.createContext({ browser, localStorage, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout });
  vm.runInContext(SOURCE, context);
  const install = (reason) => installedListeners.forEach((fn) => fn({ reason }));
  return { install, created, store };
}

test("the onboarding page opens once, on a genuine first install", () => {
  const bg = loadBackground();
  bg.install("install");
  assert.deepEqual(bg.created, ["moz-extension://test/ui/onboarding.html"]);
});

test("reloading a temporary add-on does not open onboarding again", () => {
  // about:debugging reports reason "install" every time the add-on is
  // reloaded. Opening a tab each time put the onboarding page in front of the
  // tab page, and the popup then read THAT instead of the song.
  const bg = loadBackground();
  bg.install("install");
  bg.install("install");
  bg.install("install");
  assert.equal(bg.created.length, 1);

  // A later session sees the flag already set and opens nothing.
  const next = loadBackground({ stored: bg.store });
  next.install("install");
  assert.deepEqual(next.created, []);
});

test("an update never opens the onboarding page", () => {
  const bg = loadBackground();
  bg.install("update");
  bg.install("browser_update");
  assert.deepEqual(bg.created, []);
});

test("onboarding still opens when storage is unavailable", () => {
  // Better to show it than to swallow it: a first-time user has to find the
  // toolbar button somehow.
  const bg = loadBackground({ storageThrows: true });
  bg.install("install");
  assert.equal(bg.created.length, 1);
});
