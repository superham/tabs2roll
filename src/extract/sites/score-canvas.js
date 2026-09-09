// Picking up a score that is drawn rather than written.
//
// RUNS INSIDE THE TAB PAGE. Concatenated into src/extract/injected.js by
// tools/build-injected.js — NO imports; depends only on `doc`.
//
// The interactive tab players (Ultimate Guitar's "Official" tabs, Songsterr,
// anything built on Guitar Pro files) paint the music onto a <canvas>. There
// is no tab text on those pages at all: not in the DOM, not in a script tag,
// not in an attribute. The notes exist only as pixels.
//
// So this reads the pixels. It takes a copy of what is on the canvas and
// hands it back as one byte of grey per pixel; making sense of it happens in
// the popup, in src/read/, which is ordinary testable code. Nothing is drawn,
// changed, scrolled or sent anywhere — the page is only looked at.
//
// A canvas shows the part of the score that is on screen, and no more. That
// is a real limit and it is reported rather than hidden: `scroll` says how
// much of the score the picture covers, so the popup can say "this is the
// first eighth of it, scroll down for the rest".

/** Smaller than this and it is an avatar, a sparkline or a tuner dial, not a score. */
const MIN_SCORE_WIDTH = 200;
const MIN_SCORE_HEIGHT = 60;

/** Bigger than this and copying it would cost more than it is worth. */
const MAX_SCORE_PIXELS = 8000000;

/** A canvas with less going on than this is blank: an overlay, a cursor layer. */
const MIN_CONTENT = 0.002;

/** At most this many pictures come back, so a page of charts cannot flood the popup. */
const MAX_CANDIDATES = 2;

/** Luminance the way the eye sees it, from the same weights read/image.js uses. */
function grayscaleOf(data, length) {
  const gray = new Uint8Array(length);
  let dark = 0;
  for (let i = 0, p = 0; i < length; i++, p += 4) {
    const alpha = data[p + 3];
    if (alpha === 0) {
      gray[i] = 255;
      continue;
    }
    const lum = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    // Floor the blended value, not the amount blended in: read/image.js
    // rounds the same way, so the same pixels give the same grey whichever
    // path read them.
    gray[i] = alpha === 255 ? lum : (255 - ((255 - lum) * alpha) / 255) | 0;
    if (gray[i] < 128) dark++;
  }
  // How much of the picture is the minority colour: ink on paper, or paper on
  // ink if the player is in its dark theme. Either way a blank canvas scores
  // nothing and a canvas with music on it scores a few per cent.
  const darkShare = dark / length;
  return { gray, content: Math.min(darkShare, 1 - darkShare) };
}

/** The nearest ancestor that scrolls, so the popup can say how much of the score this is. */
function scrollStateOf(el, doc) {
  let node = el;
  for (let depth = 0; node && depth < 20; depth++) {
    if (node.scrollHeight && node.clientHeight && node.scrollHeight > node.clientHeight + 8) {
      return { top: node.scrollTop || 0, height: node.scrollHeight, visible: node.clientHeight };
    }
    node = node.parentElement;
  }
  const root = doc.scrollingElement || doc.documentElement;
  if (root && root.scrollHeight > root.clientHeight + 8) {
    return { top: root.scrollTop || 0, height: root.scrollHeight, visible: root.clientHeight };
  }
  return null;
}

/**
 * Every canvas on the page that might be a score, best first.
 *
 * Returns [{ width, height, gray, content, scroll }]. Empty when there is
 * nothing worth reading, which is the usual answer on an ordinary page.
 */
export function findScoreImages(doc) {
  const canvases = doc.querySelectorAll ? doc.querySelectorAll("canvas") : [];
  const found = [];
  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const width = canvas.width | 0;
    const height = canvas.height | 0;
    if (width < MIN_SCORE_WIDTH || height < MIN_SCORE_HEIGHT) continue;
    if (width * height > MAX_SCORE_PIXELS) continue;
    let image = null;
    try {
      // Returns the context the page is already drawing with; null if the
      // canvas belongs to WebGL. Throws for a canvas holding pixels from
      // another site, which is a canvas we are not allowed to read.
      const context = canvas.getContext("2d");
      if (!context) continue;
      image = context.getImageData(0, 0, width, height);
    } catch (err) {
      continue;
    }
    if (!image || !image.data) continue;
    const { gray, content } = grayscaleOf(image.data, width * height);
    if (content < MIN_CONTENT) continue;
    found.push({ width, height, gray, content, scroll: scrollStateOf(canvas, doc) });
  }
  found.sort((a, b) => b.content - a.content);
  return found.slice(0, MAX_CANDIDATES);
}
