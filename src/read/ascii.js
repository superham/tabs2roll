// Writing what was read back out as ordinary ASCII tab.
//
// This is on purpose, and it is the reason the whole feature is only a few
// hundred lines: everything downstream of here — the tab parser, the timing
// guesses, the arranger, the MIDI encoder — already exists and is already
// tested. The reader's job is finished once the picture has been turned into
// the same text a person would have pasted in.
//
// It is also what the user is shown. A picture read slightly wrong is a
// mystery; a line of dashes with a 7 where a 1 belongs can be fixed by hand
// in five seconds.
//
// Pure ES module: no DOM, no browser APIs.

import { median } from "./staff.js";

/**
 * Characters per note gap.
 *
 * Three, to match the spacing the tab parser assumes when a tab gives it
 * nothing else to go on (parse/tab.js DEFAULT_UNIT). Engraved music is laid
 * out along the page roughly in proportion to time, so the distance between
 * two numbers on the page really does carry the rhythm; keeping that
 * proportion in the dashes is what hands it on.
 */
export const CHARS_PER_GAP = 3;

/** With one note and nothing to measure, assume the staff is drawn at this many pixels per gap. */
const FALLBACK_GAP_SPACINGS = 2;

/** One staff, as lines of ASCII tab. Returns [] when nothing was read off it. */
export function systemToAscii(system) {
  const columns = system.columns || [];
  if (!columns.length) return [];

  const noteGaps = [];
  for (let i = 1; i < columns.length; i++) noteGaps.push(columns[i].x - columns[i - 1].x);
  const unit = median(noteGaps.filter((g) => g > 0)) || system.spacing * FALLBACK_GAP_SPACINGS;

  const origin = Math.min(columns[0].x, system.bars.length ? system.bars[0] : Infinity);
  const items = [
    ...columns.map((column) => ({ x: column.x, kind: "notes", column })),
    ...system.bars.map((x) => ({ x, kind: "bar" })),
  ].sort((a, b) => a.x - b.x);

  const rows = [];
  for (let i = 0; i < system.strings; i++) rows.push([]);
  let at = -1;
  let width = 0;
  for (const item of items) {
    const wanted = Math.round(((item.x - origin) / unit) * CHARS_PER_GAP);
    // Never let one mark land on top of the one before it: a squeezed gap in
    // the engraving becomes the smallest gap the text can show, which the tab
    // parser then reads as a half step rather than a whole one.
    const pos = at < 0 ? Math.max(0, wanted) : Math.max(wanted, at + width + 1);
    if (item.kind === "bar") {
      for (const row of rows) put(row, pos, "|");
      at = pos;
      width = 1;
      continue;
    }
    let widest = 1;
    for (const event of item.column.events) {
      const text = String(event.fret);
      put(row(rows, event.string), pos, text);
      if (text.length > widest) widest = text.length;
    }
    at = pos;
    width = widest;
  }

  const length = at + width + 2;
  return rows.map((cells) => {
    let line = "|";
    for (let i = 0; i < length; i++) line += cells[i] || "-";
    return line;
  });
}

function row(rows, index) {
  return rows[Math.max(0, Math.min(rows.length - 1, index))];
}

function put(cells, pos, text) {
  for (let i = 0; i < text.length; i++) cells[pos + i] = text[i];
}

/**
 * Every tab staff in the picture, top to bottom, as one block of text.
 *
 * Staves are written out one after another, which is how a person reads a
 * page of tab and how the tab parser takes it: the second stave carries on
 * where the first one stopped.
 */
export function toAsciiTab(systems, options = {}) {
  const blocks = [];
  for (const system of systems) {
    if (system.kind !== "tab") continue;
    const lines = systemToAscii(system);
    if (!lines.length) continue;
    blocks.push(labelled(lines, options.labels).join("\n"));
  }
  return blocks.join("\n\n");
}

/**
 * Put the string names down the left when the caller knows them.
 *
 * A picture never says how the guitar was tuned, so the reader does not
 * invent labels; but a page that says "Tuning: D A D G A D" above the player
 * does, and passing them through saves the user from re-picking the tuning
 * afterwards.
 */
function labelled(lines, labels) {
  if (!Array.isArray(labels) || labels.length !== lines.length) return lines;
  const width = Math.max(...labels.map((l) => String(l).length));
  return lines.map((line, i) => String(labels[i]).padStart(width) + line);
}
