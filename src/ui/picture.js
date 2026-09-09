// The popup's side of reading a picture of sheet music.
//
// Three ways a picture arrives: taken off the page's own <canvas> by the
// injected extractor, cut out of a photograph of the browser window when the
// page would not hand its canvas over, or dropped (or pasted) into the popup
// by the user. All three end up here, and all three end up as ASCII tab text
// in the paste box, where the user can see exactly what was read and correct
// it before sending.
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
    // Null when the browser will not give us a 2D context at all. Saying so
    // here beats the "cannot read properties of null" the next line would throw.
    if (!context) throw new Error("this browser would not open a canvas to read the picture with");
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}

/**
 * The part of a photograph of the window that holds `rect`, in the
 * photograph's own pixels.
 *
 * A photograph comes back at whatever resolution the screen has: the same
 * window is 1400 pixels wide on one machine and 2800 on another, while the
 * rectangles the page measured are always in CSS pixels. So the scale is
 * measured from the picture that arrived rather than assumed, which gets both
 * machines right without either of them having to say which it is.
 *
 * The result is clipped to the picture, because a player taller than the
 * window runs off the bottom of it. Null when nothing of it is in shot.
 */
export function cropBox(rect, view, imageWidth, imageHeight) {
  if (!rect || !view || !view.width || !view.height || !imageWidth || !imageHeight) return null;
  const scaleX = imageWidth / view.width;
  const scaleY = imageHeight / view.height;
  const left = Math.max(0, Math.round(rect.x * scaleX));
  const top = Math.max(0, Math.round(rect.y * scaleY));
  const right = Math.min(imageWidth, Math.round((rect.x + rect.width) * scaleX));
  const bottom = Math.min(imageHeight, Math.round((rect.y + rect.height) * scaleY));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * One region of a photograph of the browser window, as pixels.
 *
 * `photo` is the data: URL tabs.captureVisibleTab hands back, `shot` is one
 * of the regions the page said it could not read off its own canvas, and
 * `view` is the window those measurements were taken in. The picture never
 * leaves the popup: it is cropped, read, and dropped on the floor.
 */
export async function imageDataFromShot(photo, shot, view) {
  const response = await fetch(photo);
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const box = cropBox(shot && shot.rect, view, bitmap.width, bitmap.height);
    if (!box) throw new Error("that part of the page is not in the photograph");
    const scale = Math.min(1, Math.sqrt(MAX_READ_PIXELS / (box.width * box.height)));
    const width = Math.max(1, Math.round(box.width * scale));
    const height = Math.max(1, Math.round(box.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    // A plain object rather than the ImageData itself, so the scroll state
    // travels with the pixels the way a canvas picture's does. cssPerPixel is
    // how much of the page one pixel of this crop is worth, which is what
    // turns "the last whole staff ends here" into "scroll by this much".
    const cssPerPixel = view && view.height ? box.height / (bitmap.height / view.height) / height : null;
    return { width, height, data: image.data, scroll: (shot && shot.scroll) || null, cssPerPixel };
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
    // How much of the page one pixel of this picture is worth. A canvas says
    // it by where it sits on the screen against how big its buffer is — an
    // ordinary laptop draws two buffer pixels for each one of the page's.
    reading.cssPerPixel =
      typeof image.cssPerPixel === "number" ? image.cssPerPixel : image.rect && image.rect.height && image.height ? image.rect.height / image.height : null;
    best = bestReading(best, reading);
  }
  return best;
}

/**
 * The better of two readings of the same music: more notes, weighted by how
 * sure the reader was of them. A reading beats nothing, and when neither one
 * worked the first is kept, so a canvas that gave a poor answer is not thrown
 * over for a photograph that gave no answer at all.
 */
export function bestReading(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return score(b) > score(a) ? b : a;
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
