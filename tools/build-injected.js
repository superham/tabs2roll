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
export const SOURCES = ["src/parse/tabshape.js", "src/extract/sites/ultimate-guitar.js", "src/extract/sites/generic.js", "src/extract/sites/page.js"];
export const OUTPUT = "src/extract/injected.js";

/** Short content hash, so a running browser can report which build it has. */
export function buildStamp(parts) {
  return createHash("sha256").update(parts.join("")).digest("hex").slice(0, 8);
}

export function buildInjected() {
  const parts = SOURCES.map((rel) => {
    const source = readFileSync(join(root, rel), "utf8");
    if (/^\s*import\s/m.test(source)) throw new Error(`${rel} must not import anything: it is injected into web pages`);
    const stripped = source.replace(/^export\s+(?=(?:async\s+)?function|const|let|class)/gm, "");
    if (/^\s*export\s/m.test(stripped)) throw new Error(`${rel}: only "export function/const/let/class" declarations are supported`);
    return `// ---- ${rel} ----\n${stripped.trim()}\n`;
  });
  const stamp = buildStamp(parts);
  return [
    "/* GENERATED FILE — do not edit by hand. Rebuild with: npm run build",
    ` * Built from: ${SOURCES.join(", ")}`,
    ` * Build: ${stamp}`,
    " *",
    " * This is the only code tab2roll ever runs inside a web page. It is injected",
    " * on toolbar click (activeTab), reads the page's DOM, returns plain data, and",
    " * touches nothing else: no UI, no styles, no storage, no network. */",
    "(() => {",
    '"use strict";',
    `const EXTRACTOR_BUILD = ${JSON.stringify(stamp)};`,
    "",
    ...parts,
    "// ---- run ----",
    "return extractFromPage(document, { isTabShapedLine, tabLineCount, looksLikeTab, looksLikeChordSheet, looksLikeSong, isChordOnlyLine, isLyricLine, isSectionLine });",
    "})();",
    "",
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
