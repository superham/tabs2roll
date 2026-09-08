#!/usr/bin/env node
// Build src/extract/injected.js — the ONE script that runs inside a tab page.
//
// The tab-shape heuristic (src/parse/tabshape.js) and the site extractors
// (src/extract/sites/*.js) are ES modules so they can be unit tested under
// Node. The injected script has to be a plain, import-free script, so this
// tool concatenates those files, drops the `export` keywords and wraps the
// lot in one self-contained function whose value is the extraction result.
//
//   node tools/build-injected.js          # write src/extract/injected.js
//   node tools/build-injected.js --check  # exit 1 if the file is stale
//
// The generated file is committed so the extension can be loaded straight
// from a checkout (about:debugging) without a build. test/extract.test.js
// fails when it is out of date.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCES = ["src/parse/tabshape.js", "src/extract/sites/ultimate-guitar.js", "src/extract/sites/generic.js", "src/extract/sites/score-canvas.js", "src/extract/sites/page.js"];
export const OUTPUT = "src/extract/injected.js";

/** Where the injected script leaves its result for the popup to collect. */
export const RESULT_GLOBAL = "__tab2rollResult";

/**
 * Short content hash of the whole generated script, so a running browser can
 * report exactly which build it has. It covers the wrapper as well as the
 * sources: a change to either has to move the stamp, or it is useless for
 * telling one build from another.
 */
export function buildStamp(body) {
  return createHash("sha256").update(Array.isArray(body) ? body.join("\n") : String(body)).digest("hex").slice(0, 8);
}

export function buildInjected() {
  const parts = SOURCES.map((rel) => {
    const source = readFileSync(join(root, rel), "utf8");
    if (/^\s*import\s/m.test(source)) throw new Error(`${rel} must not import anything: it is injected into web pages`);
    const stripped = source.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, "");
    if (/^\s*export\s/m.test(stripped)) throw new Error(`${rel}: only "export function/const/let/class" declarations are supported`);
    return `// ---- ${rel} ----\n${stripped.trim()}\n`;
  });
  const body = [
    "(() => {",
    '"use strict";',
    "%%BUILD%%",
    "",
    ...parts,
    "// ---- run ----",
    "var RESULT = extractFromPage(document, { isTabShapedLine, tabLineCount, looksLikeTab, looksLikeChordSheet, looksLikeSong, isChordOnlyLine, isLyricLine, isSectionLine });",
    "// Firefox does not reliably hand back a file-injected script's completion",
    "// value, so leave the result where a second, tiny injection can read it.",
    "// This is the extension's own isolated sandbox, not the page's window.",
    `try { globalThis[${JSON.stringify(RESULT_GLOBAL)}] = RESULT; } catch (err) { /* nothing to do */ }`,
    "return RESULT;",
    "})();",
    "",
  ];
  const stamp = buildStamp(body);
  return [
    "/* GENERATED FILE — do not edit by hand. Rebuild with: npm run build",
    ` * Built from: ${SOURCES.join(", ")}`,
    ` * Build: ${stamp}`,
    " *",
    " * This is the only code tab2roll ever runs inside a web page. It is injected",
    " * on toolbar click (activeTab), reads the page's DOM, returns plain data, and",
    " * touches nothing else: no UI, no styles, no storage, no network. */",
    ...body.map((line) => (line === "%%BUILD%%" ? `const EXTRACTOR_BUILD = ${JSON.stringify(stamp)};` : line)),
  ].join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const out = buildInjected();
  const target = join(root, OUTPUT);
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch (err) {
      current = "";
    }
    if (current !== out) {
      console.error(`${relative(root, target)} is out of date. Run: npm run build`);
      process.exit(1);
    }
    console.log(`${relative(root, target)} is up to date.`);
  } else {
    writeFileSync(target, out);
    console.log(`wrote ${relative(root, target)} (${out.length} bytes)`);
  }
}
