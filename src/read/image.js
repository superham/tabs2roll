// read/: a picture of sheet music -> ASCII tab text.
//
// This file is the bottom of that stack: whatever the caller has (an
// ImageData off a <canvas>, a decoded PNG, a screenshot) becomes one plain
// grey bitmap, and then one black-and-white "ink" bitmap the rest of the
// reader can walk.
//
// Pure ES module: no DOM, no browser APIs. It runs in the popup and under
// Node exactly the same way.

/**
 * Anything picture-shaped, normalised to { width, height, gray }.
 *
 * Accepts:
 *   { width, height, data }  RGBA bytes, which is what ImageData is
 *   { width, height, gray }  one byte per pixel, 0 = black, 255 = white
 *
 * Grey is computed with the usual luminance weights: the eye reads a green
 * pixel as far brighter than a blue one of the same value, and staff lines
 * are sometimes drawn in colour (Guitar Pro renders the played bar in blue).
 */
export function toGray(image) {
  if (!image || !image.width || !image.height) throw new TypeError("readSheetMusic needs a picture with a width and a height");
  const width = image.width | 0;
  const height = image.height | 0;
  if (image.gray) {
    const gray = image.gray instanceof Uint8Array ? image.gray : Uint8Array.from(image.gray);
    if (gray.length < width * height) throw new TypeError("the picture is smaller than its width and height say");
    return { width, height, gray };
  }
  const data = image.data;
  if (!data || data.length < width * height * 4) throw new TypeError("the picture is smaller than its width and height say");
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const alpha = data[p + 3];
    // An untouched canvas pixel is transparent black. Treated as black it
    // would read as one enormous ink blot, so transparency counts as paper.
    if (alpha === 0) {
      gray[i] = 255;
      continue;
    }
    const lum = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    gray[i] = alpha === 255 ? lum : (255 - ((255 - lum) * alpha) / 255) | 0;
  }
  return { width, height, gray };
}

/** Counts of every grey value in the picture. */
export function histogram(gray) {
  const counts = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) counts[gray[i]]++;
  return counts;
}

/**
 * The most common grey value: the paper.
 *
 * Used instead of "is the average dark?" because a screenshot is mostly page
 * furniture. A dark-themed player with a white surround, or a light score
 * inside a black browser window, both have far more background than ink, and
 * the commonest value is the background either way.
 */
export function backgroundLevel(counts) {
  let best = 0;
  let bestCount = -1;
  for (let v = 0; v < 256; v++) {
    if (counts[v] > bestCount) {
      bestCount = counts[v];
      best = v;
    }
  }
  return best;
}

/**
 * Otsu's threshold: the grey level that best splits the picture into two
 * groups. Chosen over a fixed value because screenshots are taken at every
 * brightness and a fixed threshold turns a light-grey staff line into paper.
 *
 * The value returned belongs to the DARKER group, so ink is `grey <= t`. On a
 * picture of pure black on pure white that comes out as 0, which is right:
 * every black pixel is ink and nothing else is.
 */
export function otsuThreshold(counts, total) {
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * counts[v];
  let sumBack = 0;
  let weightBack = 0;
  let best = 128;
  let bestVariance = -1;
  for (let v = 0; v < 256; v++) {
    weightBack += counts[v];
    if (weightBack === 0) continue;
    const weightFore = total - weightBack;
    if (weightFore === 0) break;
    sumBack += v * counts[v];
    const meanBack = sumBack / weightBack;
    const meanFore = (sum - sumBack) / weightFore;
    const variance = weightBack * weightFore * (meanBack - meanFore) * (meanBack - meanFore);
    if (variance > bestVariance) {
      bestVariance = variance;
      best = v;
    }
  }
  return best;
}

/**
 * Turn a picture into ink: 1 where the engraver's pen went, 0 for paper.
 *
 * `inverted` says the score was drawn light-on-dark, which is what a
 * dark-themed tab player gives you. Reported rather than hidden so the caller
 * can say what it saw.
 */
export function toInk(image, options = {}) {
  const { width, height, gray } = toGray(image);
  const counts = histogram(gray);
  const background = backgroundLevel(counts);
  const inverted = typeof options.inverted === "boolean" ? options.inverted : background < 128;
  const threshold = typeof options.threshold === "number" ? options.threshold : otsuThreshold(counts, width * height);
  const ink = new Uint8Array(width * height);
  if (inverted) {
    for (let i = 0; i < ink.length; i++) ink[i] = gray[i] > threshold ? 1 : 0;
  } else {
    for (let i = 0; i < ink.length; i++) ink[i] = gray[i] <= threshold ? 1 : 0;
  }
  return { width, height, ink, gray, threshold, inverted, background };
}

/** How much of the picture is ink. A blank canvas is not worth reading. */
export function inkFraction(bitmap) {
  let n = 0;
  for (let i = 0; i < bitmap.ink.length; i++) n += bitmap.ink[i];
  return n / bitmap.ink.length;
}
