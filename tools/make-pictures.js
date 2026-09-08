#!/usr/bin/env node
// Draw the picture fixtures in test/fixtures/pictures/.
//
//   node tools/make-pictures.js            # redraw every picture
//   node tools/make-pictures.js riff       # just one
//
// Each fixture is a pair: `<name>.tab.txt` is the tab that was drawn, which
// is the ground truth a person can read, and `<name>.png` is the picture of
// it that the reader has to get back. Committing the PNG means the tests run
// against a real file rather than against the drawing code, so a change to
// either one shows up.
//
// The pictures are deliberately drawn in a different digit face from the one
// src/read/digits.js matches against — see test/helpers/draw.js.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderTab, createImage, fillRect } from "../test/helpers/draw.js";
import { writePng } from "./png.js";

const dir = new URL("../test/fixtures/pictures/", import.meta.url).pathname;

/** How each fixture is drawn. Between them they cover the sizes and themes a screenshot arrives in. */
const HOW = {
  riff: { spacing: 16, columnWidth: 8, digitHeight: 12, digitWidth: 8 },
  "every-digit": { spacing: 13, columnWidth: 7, digitHeight: 10, digitWidth: 6 },
  "high-frets": { spacing: 20, columnWidth: 7, digitHeight: 15, digitWidth: 9, thickness: 2 },
  chords: { spacing: 12, columnWidth: 8, digitHeight: 9, digitWidth: 6 },
  bass: { spacing: 22, columnWidth: 10, digitHeight: 16, digitWidth: 10 },
  "two-staves": { spacing: 11, columnWidth: 6, digitHeight: 9, digitWidth: 5, background: 22, foreground: 236 },
  // The one drawn the way a real tab player draws: the word TAB down the
  // front, a time signature, bar numbers, the H and P of hammer-ons and
  // pull-offs with their slurs, a vibrato squiggle, a note held in brackets,
  // the rhythm beamed underneath and the player's own cursor across it all.
  "player-page": { spacing: 13, columnWidth: 9, digitHeight: 10, digitWidth: 6, margin: 46, systemGap: 74, furniture: true },
};

/** A staff sitting in the middle of a page, the way a screenshot arrives. */
export function pageAround(picture, options = {}) {
  const pad = options.pad || 60;
  const top = options.top || 130;
  const page = createImage(picture.width + pad * 2, picture.height + top + 70, 255);
  for (let y = 0; y < picture.height; y++) {
    for (let x = 0; x < picture.width; x++) page.gray[(y + top) * page.width + x + pad] = picture.gray[y * picture.width + x];
  }
  fillRect(page, 0, 0, page.width, 18, 60); // a dark navigation bar
  for (let i = 0; i * 22 + 34 < page.width; i++) fillRect(page, 20 + i * 22, 40, 14, 10, 0); // menu words
  fillRect(page, 10, 74, page.width - 20, 1, 0); // a full-width rule
  fillRect(page, 10, top - 12, page.width - 20, 1, 0); // and one right above the staff
  for (let i = 0; i * 11 + 27 < page.width; i++) fillRect(page, 20 + i * 11, page.height - 30, 7, 8, 0); // words underneath
  return page;
}

const only = process.argv.slice(2);
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".tab.txt"))
  .map((f) => f.replace(/\.tab\.txt$/, ""))
  .filter((n) => !only.length || only.includes(n));

for (const name of names) {
  const tab = readFileSync(join(dir, name + ".tab.txt"), "utf8").replace(/\n+$/, "");
  const picture = renderTab(tab, HOW[name] || {});
  const out = name === "riff" ? pageAround(picture) : picture;
  writeFileSync(join(dir, name + ".png"), writePng(out));
  console.log(`${name.padEnd(14)} ${out.width}x${out.height}`);
}
