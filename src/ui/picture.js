// The popup's side of reading a picture of sheet music.
//
// Two ways a picture arrives: taken off the page's own <canvas> by the
// injected extractor, or dropped (or pasted) into the popup by the user. Both
// end up here, and both end up as ASCII tab text in the paste box, where the
// user can see exactly what was read and correct it before sending.
//
// The reading itself is src/read/. This file only fetches pixels and picks
// the best answer out of them.

import { readSheetMusic } from "../read/index.js";

/** Bigger than this and the picture is scaled down before reading. */
export const MAX_READ_PIXELS = 6000000;

/**
 * A dropped or pasted file as pixels.
 *
 * Very large photographs are scaled down first: a twelve-megapixel picture of
 * a songbook costs seconds to walk through and holds no more music than the
 * same page at a quarter of the size.
 */
export async function imageDataFromFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, Math.sqrt(MAX_READ_PIXELS / (bitmap.width * bitmap.height)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

/** The first image on a drop or a paste, or nothing. */
export function imageFileOf(transfer) {
  if (!transfer) return null;
  const files = transfer.files ? [...transfer.files] : [];
  const found = files.find((file) => file && /^image\//.test(file.type));
  if (found) return found;
  const items = transfer.items ? [...transfer.items] : [];
  for (const item of items) {
    if (item.kind === "file" && /^image\//.test(item.type)) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Read every picture the page gave us and keep the best answer.
 *
 * A tab player usually has two canvases stacked, one holding the music and
 * one holding the playing cursor. Rather than guess which is which from class
 * names that change every release, both are read and the one with the most
 * music in it wins.
 */
export function readBestPicture(images, options = {}) {
  let best = null;
  for (const image of images || []) {
    let reading;
    try {
      reading = readSheetMusic(image, options);
    } catch (err) {
      console.warn("[tab2roll] could not read one of the pictures", err);
      continue;
    }
    reading.scroll = image.scroll || null;
    if (!best) best = reading;
    else if (score(reading) > score(best)) best = reading;
  }
  return best;
}

function score(reading) {
  if (!reading || !reading.ok) return -1;
  return reading.notes * Math.max(0.2, reading.confidence);
}

/**
 * How much of the score the picture covered, as a whole percentage.
 *
 * A tab player draws only the bars that are on screen, so one look at the
 * canvas is one screenful of a four-minute song. Saying so is the difference
 * between "tab2roll only read eight bars" and "tab2roll is broken".
 */
export function coverageOf(scroll) {
  if (!scroll || !scroll.height || !scroll.visible) return null;
  const share = scroll.visible / scroll.height;
  if (share >= 0.9) return null;
  return Math.max(1, Math.round(share * 100));
}
