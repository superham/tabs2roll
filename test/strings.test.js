// Language rules for user-facing copy (see the build spec):
// banned words never appear in src/strings.js, and UI code has no string
// literals of its own for the user.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { STRINGS, str } from "../src/strings.js";

const BANNED = ["parse", "parser", "IR", "JSON", "schema", "tick", "PPQ", "serialize", "export", "validate", "null", "undefined", "config"];

function allStrings(node, path = "") {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    const p = path ? `${path}.${key}` : key;
    if (typeof value === "string") out.push([p, value]);
    else if (typeof value === "function") out.push([p, value("X")]);
    else if (value && typeof value === "object") out.push(...allStrings(value, p));
  }
  return out;
}

test("no banned words in any user-facing string", () => {
  for (const [path, text] of allStrings(STRINGS)) {
    for (const word of BANNED) {
      const re = word === "IR" || word === "PPQ" || word === "JSON" ? new RegExp(`\\b${word}\\b`) : new RegExp(`\\b${word}\\w*\\b`, "i");
      assert.ok(!re.test(text), `${path} contains banned word "${word}": ${text}`);
    }
  }
});

test("the required failure and success messages exist word for word", () => {
  const P = STRINGS.popup;
  assert.equal(P.mainButton, "Send to my DAW");
  assert.equal(P.mainSubtext, "Downloads a MIDI file.");
  assert.equal(P.pasteLabel, "Or paste tab text here.");
  assert.equal(P.notFound, "I couldn't find any tab on this page. Make sure you're on a tab page and that it's finished loading.");
  assert.equal(P.chordSheet, "This is a chord sheet, so I made the chords and a bassline.");
  assert.equal(P.unsupported, "This tab is in a format I can't read yet. Try one of the text tabs for this song.");
  assert.equal(P.noNotes, "I found the tab but couldn't make sense of it. Try pasting the tab text in below and I'll have another go.");
  // Dragging is the shortcut, not the instruction: FL Studio refuses dropped
  // files silently when it runs as an administrator, in the Fruity Edition,
  // or when the name is very long. The menu route works in every edition.
  assert.match(P.nextSteps, /File \u2192 Import \u2192 MIDI file/);
  assert.match(P.nextSteps, /playlist/);
  assert.equal(P.rhythmGuessed, "The timing is a best guess — you may need to nudge some notes.");
  assert.equal(P.wrongTuning, "Wrong tuning? Re-do as:");
  assert.equal(P.showMeHow, "Show me how");
  assert.ok(!/inferred|confidence/i.test(P.rhythmGuessed + P.rhythmExact));
});

test("the help page answers a drag that does nothing", () => {
  const H = STRINGS.help;
  // The one thing a user cannot see for themselves: FL Studio saying no is
  // indistinguishable from a broken file, so the help has to say so outright.
  assert.match(H.drag1, /file itself is fine/i);
  for (const key of ["drag2", "drag3", "drag4"]) assert.ok(H[key] && H[key].length > 40, `help.${key} should explain one cause`);
  assert.match(H.drag2, /administrator/i);
  assert.match(H.drag3, /Fruity/i);
  assert.match(H.drag5, /File \u2192 Import \u2192 MIDI file/);
  assert.match(STRINGS.popup.dragDidNothing, /nothing happened/i);
});

test("str() resolves dotted keys and returns empty for unknown ones", () => {
  assert.equal(str("popup.mainButton"), "Send to my DAW");
  assert.equal(str("nope.nothing"), "");
});

test("every data-str key used in the HTML pages exists", () => {
  const dir = new URL("../src/ui/", import.meta.url).pathname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html"))) {
    const html = readFileSync(join(dir, file), "utf8");
    for (const m of html.matchAll(/data-str="([^"]+)"/g)) {
      assert.ok(str(m[1]) !== "", `${file}: missing string for ${m[1]}`);
    }
  }
});

test("UI code has no user-facing string literals (only strings.js does)", () => {
  const dir = new URL("../src/ui/", import.meta.url).pathname;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const code = readFileSync(join(dir, file), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    // A user-facing literal is a quoted string with a space and a capital letter or sentence punctuation.
    const suspicious = [...code.matchAll(/(["'`])((?:(?!\1).){12,})\1/g)].map((m) => m[2]).filter((s) => /[A-Z][a-z]+ [a-z]+/.test(s) && !/^[\w./#:-]+$/.test(s) && !/\[tab2roll\]/.test(s));
    assert.deepEqual(suspicious, [], `${file} has user-facing literals`);
  }
});

test("the popup shows the version, and manifest and package agree on it", () => {
  const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
  const manifest = read("../src/manifest.json");
  const pkg = read("../package.json");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version, "src/manifest.json and package.json disagree on the version");
  // The popup reads the number from the manifest at run time; only its
  // wording lives in strings.js.
  assert.equal(STRINGS.popup.version(manifest.version), `Version ${manifest.version}`);
  const html = readFileSync(new URL("../src/ui/popup.html", import.meta.url), "utf8");
  assert.match(html, /id="version"/);
});

test("the injected script is referenced by an absolute path that exists", () => {
  const popup = readFileSync(new URL("../src/ui/popup.js", import.meta.url), "utf8");
  const match = /const INJECTED_SCRIPT = "([^"]+)"/.exec(popup);
  assert.ok(match, "popup.js should name the injected script");
  const path = match[1];
  // Without the leading slash Firefox resolves the path against the popup's
  // own directory and asks for ui/extract/injected.js, which does not exist.
  // It reports that as an entry carrying an error rather than by throwing, so
  // the extractor silently never runs and every page reads as empty.
  assert.ok(path.startsWith("/"), `injected script path must be absolute, got "${path}"`);
  assert.ok(existsSync(new URL("../src" + path, import.meta.url)), `no such file: src${path}`);
});
