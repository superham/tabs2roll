// Taking the staff apart: rub out the lines, then pick up what is left.
//
// After this file the picture is a list of marks — a fret number, a bar line,
// a stem, a smudge — each with its own little bitmap. Nothing here knows what
// a mark means; read/digits.js decides that.
//
// Pure ES module: no DOM, no browser APIs.

/**
 * Rub the staff lines out.
 *
 * The whole row goes, not just the pixels that look like line. Anything
 * cleverer gets this wrong: a "3" is drawn over a cleared gap in the string
 * line, and where its middle stroke crosses the height of that line there is
 * often no ink directly above or below it to prove the pixel belongs to the
 * number. Every rule for telling those two pixels apart fails on some
 * perfectly ordinary digit.
 *
 * So the lines go completely and the damage is repaired afterwards, by
 * `findComponents`: marks left lying either side of an erased row are put
 * back together, and each one's picture is then taken from the original ink.
 * Nothing is lost, and no rule has to be right about a single pixel.
 *
 * Returns { width, height, ink, erased } where `erased` marks the rows that
 * were cleared.
 */
export function eraseStaffLines(bitmap, lines) {
  const { width, height, ink } = bitmap;
  const out = Uint8Array.from(ink);
  const erased = new Uint8Array(height);
  for (const line of lines) {
    // Along the line's own length only. A staff is drawn over a page with
    // lyrics and part names on it, and the ink out there is not staff.
    const from = Math.max(0, line.x0 - 2);
    const to = Math.min(width - 1, line.x1 + 2);
    for (let y = line.top; y <= line.bottom; y++) {
      if (y < 0 || y >= height) continue;
      erased[y] = 1;
      for (let x = from; x <= to; x++) out[y * width + x] = 0;
    }
  }
  return { width, height, ink: out, erased, source: ink };
}

/**
 * Every connected mark inside a box, as its own small bitmap.
 *
 * Eight-connected, so a number whose stroke thins to a diagonal pixel stays
 * one mark. Iterative rather than recursive: a bar line is hundreds of pixels
 * and a recursive flood fill runs the stack out.
 *
 * Marks separated only by an erased staff line are then joined back up, and
 * every mark's picture is taken from the ink the reader started with, so a
 * number that sat astride a string line comes out whole.
 */
export function findComponents(bitmap, box, options = {}) {
  const { width, height, ink } = bitmap;
  const source = options.source || bitmap.source || ink;
  const erased = options.erased || bitmap.erased || new Uint8Array(height);
  const x0 = Math.max(0, Math.floor(box.x0));
  const x1 = Math.min(width - 1, Math.ceil(box.x1));
  const y0 = Math.max(0, Math.floor(box.y0));
  const y1 = Math.min(height - 1, Math.ceil(box.y1));
  const minArea = options.minArea || 3;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const pieces = [];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const start = y * width + x;
      if (!ink[start] || seen[start]) continue;
      seen[start] = 1;
      stack.length = 0;
      stack.push(start);
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let area = 0;
      while (stack.length) {
        const at = stack.pop();
        area++;
        const px = at % width;
        const py = (at - px) / width;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < y0 || ny > y1) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < x0 || nx > x1) continue;
            const next = ny * width + nx;
            if (ink[next] && !seen[next]) {
              seen[next] = 1;
              stack.push(next);
            }
          }
        }
      }
      pieces.push({ x0: minX, x1: maxX, y0: minY, y1: maxY, area });
    }
  }

  const merged = rejoin(pieces, erased);
  const found = [];
  for (const piece of merged) {
    if (piece.area < minArea) continue;
    found.push(cut(source, width, piece));
  }
  found.sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
  return found;
}

/**
 * Put back together what erasing the staff lines broke apart.
 *
 * Two pieces belong to one mark when they sit one above the other, overlap
 * across the page, and the only thing between them is a row that was rubbed
 * out. The gap allowed is a couple of pixels: strings are a dozen apart, so
 * this can never join a number on one string to a number on the next.
 */
export function rejoin(pieces, erased, slack = 3) {
  const parts = pieces.slice().sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const groups = parts.map((p, i) => i);
  const find = (i) => (groups[i] === i ? i : (groups[i] = find(groups[i])));

  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      if (b.y0 - a.y1 > slack) continue;
      if (b.y0 <= a.y1) continue; // overlapping vertically: already separate marks
      if (b.x0 > a.x1 + 1 || a.x0 > b.x1 + 1) continue;
      let bridged = true;
      for (let y = a.y1 + 1; y < b.y0; y++) {
        if (!erased[y]) {
          bridged = false;
          break;
        }
      }
      if (!bridged) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) groups[rb] = ra;
    }
  }

  const byRoot = new Map();
  for (let i = 0; i < parts.length; i++) {
    const root = find(i);
    const part = parts[i];
    const at = byRoot.get(root);
    if (!at) {
      byRoot.set(root, { x0: part.x0, x1: part.x1, y0: part.y0, y1: part.y1, area: part.area });
      continue;
    }
    at.x0 = Math.min(at.x0, part.x0);
    at.x1 = Math.max(at.x1, part.x1);
    at.y0 = Math.min(at.y0, part.y0);
    at.y1 = Math.max(at.y1, part.y1);
    at.area += part.area;
  }
  return [...byRoot.values()];
}

/** A mark's own picture, cut out of the ink the reader started with. */
function cut(source, width, box) {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  const cells = new Uint8Array(w * h);
  let area = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = source[(box.y0 + y) * width + (box.x0 + x)];
      cells[y * w + x] = on;
      area += on;
    }
  }
  return {
    x0: box.x0,
    x1: box.x1,
    y0: box.y0,
    y1: box.y1,
    width: w,
    height: h,
    area,
    cx: (box.x0 + box.x1) / 2,
    cy: (box.y0 + box.y1) / 2,
    cells,
  };
}

/** How many holes a mark has. See holesOf for the details. */
export function countHoles(component) {
  return holesOf(component).count;
}

/**
 * The holes in a mark: none in a 1 or a 7, one in a 0 or a 9, two in an 8.
 *
 * The most reliable thing about a printed digit, and the cheapest to measure:
 * flood the background in from outside the mark and count what it could not
 * reach. A margin is added first so a bowl that touches the edge of the box
 * still counts as open.
 *
 * Where the hole sits matters as much as how many there are. A 0, a 6 and a 9
 * are the same shape with the hole in a different place and a different size,
 * and blurred pictures of them are easy to mistake for one another; the hole
 * tells them apart at a glance. Returns { count, cy, area } with the biggest
 * hole's middle and size given as fractions of the mark's own box.
 */
export function holesOf(component) {
  const w = component.width + 2;
  const h = component.height + 2;
  const outside = new Uint8Array(w * h);
  const filled = (x, y) => {
    if (x <= 0 || y <= 0 || x > component.width || y > component.height) return 0;
    return component.cells[(y - 1) * component.width + (x - 1)];
  };
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const at = stack.pop();
    const x = at % w;
    const y = (at - x) / w;
    const neighbours = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const next = ny * w + nx;
      if (outside[next] || filled(nx, ny)) continue;
      outside[next] = 1;
      stack.push(next);
    }
  }
  const holeSeen = new Uint8Array(w * h);
  let holes = 0;
  let biggest = 0;
  let biggestY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      if (outside[at] || holeSeen[at] || filled(x, y)) continue;
      let size = 0;
      let sumY = 0;
      const fill = [at];
      holeSeen[at] = 1;
      while (fill.length) {
        const here = fill.pop();
        size++;
        const hx = here % w;
        const hy = (here - hx) / w;
        sumY += hy;
        const around = [
          [hx - 1, hy],
          [hx + 1, hy],
          [hx, hy - 1],
          [hx, hy + 1],
        ];
        for (const [nx, ny] of around) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const next = ny * w + nx;
          if (holeSeen[next] || outside[next] || filled(nx, ny)) continue;
          holeSeen[next] = 1;
          fill.push(next);
        }
      }
      // A single stray pixel between two strokes is not a hole; two are.
      if (size < 2) continue;
      holes++;
      if (size > biggest) {
        biggest = size;
        biggestY = sumY / size;
      }
    }
  }
  return {
    count: holes,
    cy: biggest ? (biggestY - 1) / component.height : 0,
    area: biggest / (component.width * component.height),
  };
}
