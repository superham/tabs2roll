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
// A canvas does not always hand its pixels over. One drawn through WebGL has
// no 2d context to read; one whose control has been passed to a worker has no
// pixels here at all; one holding another site's images may not be read. All
// three are ordinary things for a tab player to be, and all three used to
// look exactly like "this page has no music on it". So every canvas that is
// passed over is now recorded with the reason, and the ones that are still on
// the screen come back as `shots`: a rectangle the popup can photograph with
// tabs.captureVisibleTab and read instead. A photograph holds what the person
// is looking at, whatever the page drew it with.
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

/**
 * Why a canvas gave nothing.
 *
 *   tiny           too small to hold a stave
 *   huge           more pixels than it is worth copying
 *   no-2d-context  drawn through WebGL, so there is no 2d context to read
 *   transferred    control passed to a worker; the pixels are not here
 *   blocked        holds another site's images and may not be read
 *   unreadable     asked for its pixels and refused, for some other reason
 *   empty          answered, but with nothing in it
 *   blank          read fine and had no music on it: an overlay, a cursor
 *   extra          real music, but further down the page than we look
 */
const CAN_PHOTOGRAPH = ["no-2d-context", "transferred", "blocked", "unreadable"];

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

/**
 * What the browser calls the refusal, in our own words.
 *
 * The two that matter are told apart because they need opposite answers: a
 * canvas drawn in a worker is a photograph away from being readable, while
 * one holding another site's pixels is a wall. Both are photographable, which
 * is why the distinction lives in the log rather than in the behaviour.
 */
function refusalOf(err) {
  const name = err && err.name ? String(err.name) : "";
  if (name === "SecurityError") return "blocked";
  if (name === "InvalidStateError") return "transferred";
  return "unreadable";
}

/** Where the canvas is on the screen, in CSS pixels, or null if it is nowhere. */
function rectOf(el) {
  if (!el || typeof el.getBoundingClientRect !== "function") return null;
  try {
    const box = el.getBoundingClientRect();
    if (!box || !box.width || !box.height) return null;
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  } catch (err) {
    return null;
  }
}

/** The size of the window the rectangles above were measured in. */
function viewOf(doc) {
  const win = doc ? doc.defaultView : null;
  const root = doc ? doc.documentElement : null;
  const width = (root && root.clientWidth) || (win && win.innerWidth) || 0;
  const height = (root && root.clientHeight) || (win && win.innerHeight) || 0;
  if (!width || !height) return null;
  return { width, height, dpr: (win && win.devicePixelRatio) || 1 };
}

/** True when any part of the rectangle is inside the window, so a photograph would hold it. */
function onScreen(rect, view) {
  if (!rect || !view) return false;
  return rect.x < view.width && rect.y < view.height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
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
 * Every canvas on the page that might be a score, and an account of the ones
 * that gave nothing.
 *
 * Returns:
 *   images   [{ width, height, gray, content, scroll, rect }], best first
 *   skipped  [{ reason, width, height }] for every canvas passed over
 *   shots    [{ reason, width, height, rect, scroll }] — canvases whose
 *            pixels are out of reach but which are on the screen, so a
 *            photograph of the window would hold them
 *   view     { width, height, dpr } the window those rectangles are in
 *
 * `images` empty is the usual answer on an ordinary page. `images` empty with
 * `shots` filled is a tab player this cannot read directly, which is the one
 * case worth taking a photograph for.
 */
export function findScoreImages(doc) {
  const canvases = doc.querySelectorAll ? doc.querySelectorAll("canvas") : [];
  const view = viewOf(doc);
  const images = [];
  const skipped = [];
  const shots = [];

  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i];
    const width = canvas.width | 0;
    const height = canvas.height | 0;
    const rect = rectOf(canvas);
    const scroll = scrollStateOf(canvas, doc);
    // Passing over a canvas is written down rather than done in silence.
    // "There is a score here I am not allowed to read" and "there is no score
    // here" look identical from the popup otherwise, and they want opposite
    // answers: one is a photograph away, the other is a different page.
    const pass = (reason) => {
      skipped.push({ reason, width, height });
      if (CAN_PHOTOGRAPH.indexOf(reason) !== -1 && onScreen(rect, view)) shots.push({ reason, width, height, rect, scroll });
    };

    if (width < MIN_SCORE_WIDTH || height < MIN_SCORE_HEIGHT) {
      pass("tiny");
      continue;
    }
    if (width * height > MAX_SCORE_PIXELS) {
      pass("huge");
      continue;
    }
    let image = null;
    try {
      // Returns the context the page is already drawing with; null if the
      // canvas belongs to WebGL. Throws for a canvas holding pixels from
      // another site, and for one whose control has gone to a worker.
      const context = canvas.getContext("2d");
      if (!context) {
        pass("no-2d-context");
        continue;
      }
      image = context.getImageData(0, 0, width, height);
    } catch (err) {
      pass(refusalOf(err));
      continue;
    }
    if (!image || !image.data) {
      pass("empty");
      continue;
    }
    const { gray, content } = grayscaleOf(image.data, width * height);
    if (content < MIN_CONTENT) {
      pass("blank");
      continue;
    }
    images.push({ width, height, gray, content, scroll, rect });
  }

  images.sort((a, b) => b.content - a.content);
  for (const over of images.splice(MAX_CANDIDATES)) skipped.push({ reason: "extra", width: over.width, height: over.height });
  // Biggest first: on a player with a cursor layer over the score, both are
  // out of reach together and the score is the one worth the photograph.
  shots.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height);
  return { images, skipped, shots: shots.slice(0, MAX_CANDIDATES), view };
}
