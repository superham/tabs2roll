// Draws pictures of tablature for the reader tests.
//
// The digits here are a plain 5x7 bitmap font, deliberately NOT the shapes
// src/read/digits.js matches against: a 1 with a foot on it, a flat-topped 3,
// a 4 open at the corner. A reader that only recognises the exact pictures it
// ships with would pass a test drawn with those pictures and fail on the
// first real screenshot, so the test font disagrees with the templates on
// purpose.

/** Classic 5x7 terminal digits, one string per row, "1" is ink. */
const FONT = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  x: ["00000", "10001", "01010", "00100", "01010", "10001", "00000"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
};

export function createImage(width, height, background = 255) {
  return { width, height, gray: new Uint8Array(width * height).fill(background) };
}

export function fillRect(img, x0, y0, w, h, value) {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(img.height, Math.round(y0 + h)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(img.width, Math.round(x0 + w)); x++) {
      img.gray[y * img.width + x] = value;
    }
  }
}

/**
 * One glyph, scaled from 5x7 into a w x h box.
 *
 * Every source cell paints the target rectangle it lands on, rather than each
 * target pixel picking one source cell. Sampling drops strokes when the target
 * is narrower than the source — a 1 scaled from five columns down to four can
 * lose its stem and leave a single pixel behind — and a rasterizer asked for a
 * small size does not do that either. At the font's own size and above the
 * rectangles tile exactly; below it they overlap, and strokes thicken instead
 * of vanishing, which is also what a rasterizer does.
 */
export function drawGlyph(img, char, x, y, w, h, value = 0) {
  const rows = FONT[char];
  if (!rows) throw new Error(`the test font has no "${char}"`);
  for (let sy = 0; sy < 7; sy++) {
    const y0 = Math.floor((sy * h) / 7);
    const y1 = Math.max(y0 + 1, Math.floor(((sy + 1) * h) / 7));
    for (let sx = 0; sx < 5; sx++) {
      if (rows[sy][sx] !== "1") continue;
      const x0 = Math.floor((sx * w) / 5);
      const x1 = Math.max(x0 + 1, Math.floor(((sx + 1) * w) / 5));
      for (let ty = y0; ty < Math.min(y1, h); ty++) {
        for (let tx = x0; tx < Math.min(x1, w); tx++) {
          const px = Math.round(x) + tx;
          const py = Math.round(y) + ty;
          if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
          img.gray[py * img.width + px] = value;
        }
      }
    }
  }
}

/**
 * Draw a picture of a piece of ASCII tab.
 *
 * Every character of the text is one column of the picture, so the note
 * spacing on the page matches the note spacing in the text and a test can
 * compare what came back with what went in.
 *
 * Numbers are drawn the way an engraver draws them: over a cleared box, so
 * the string line stops at one side of the number and starts again at the
 * other.
 */
export function renderTab(text, options = {}) {
  const spacing = options.spacing || 13;
  const columnWidth = options.columnWidth || 6;
  const margin = options.margin || 20;
  const thickness = options.thickness || 1;
  const digitHeight = options.digitHeight || Math.round(spacing * 0.8);
  const digitWidth = options.digitWidth || Math.max(3, Math.round(digitHeight * 0.62));
  const background = options.background === undefined ? 255 : options.background;
  const foreground = options.foreground === undefined ? 0 : options.foreground;

  const staves = String(text)
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.replace(/^\s*[A-Ga-g#b]?\s*\|/, "")).filter((line) => line.length))
    .filter((block) => block.length);

  const columns = Math.max(...staves.map((block) => Math.max(...block.map((l) => l.length))));
  const width = margin * 2 + columns * columnWidth;
  const staffHeight = (Math.max(...staves.map((b) => b.length)) - 1) * spacing;
  const gap = options.systemGap || Math.round(spacing * 3);
  const height = margin * 2 + staves.length * staffHeight + (staves.length - 1) * gap;
  const img = createImage(width, height, background);

  let top = margin;
  for (const block of staves) {
    const lineY = block.map((_, i) => top + i * spacing);
    for (const y of lineY) fillRect(img, margin, y, columns * columnWidth, thickness, foreground);

    for (let s = 0; s < block.length; s++) {
      const line = block[s];
      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === "-" || ch === " ") continue;
        const x = margin + c * columnWidth;
        if (ch === "|") {
          // A bar line is drawn once, from the top string to the bottom one.
          if (s === 0) fillRect(img, x, lineY[0], Math.max(1, thickness), staffHeight + thickness, foreground);
          continue;
        }
        // A two-digit fret is written as two characters in the text; draw it
        // once, at the first of them.
        if (/\d/.test(ch) && /\d/.test(line[c - 1] || "")) continue;
        const text2 = /\d/.test(ch) && /\d/.test(line[c + 1] || "") ? ch + line[c + 1] : ch;
        drawNumber(img, text2, x, lineY[s], { digitWidth, digitHeight, background, foreground });
      }
    }
    top += staffHeight + gap;
  }
  return img;
}

function drawNumber(img, text, x, centreY, { digitWidth, digitHeight, background, foreground }) {
  const totalWidth = text.length * digitWidth + (text.length - 1);
  const left = x - Math.round(totalWidth / 2) + Math.round(digitWidth / 2);
  const topY = Math.round(centreY - digitHeight / 2);
  // The gap an engraver clears around a number grows with the number.
  const clear = Math.max(1, Math.round(digitHeight * 0.15));
  fillRect(img, left - clear, topY - 1, totalWidth + clear * 2, digitHeight + 2, background);
  for (let i = 0; i < text.length; i++) {
    drawGlyph(img, text[i], left + i * (digitWidth + 1), topY, digitWidth, digitHeight, foreground);
  }
}

/** Turn a picture into something a person can read in a test failure. */
export function asAscii(img, threshold = 128) {
  const rows = [];
  for (let y = 0; y < img.height; y++) {
    let line = "";
    for (let x = 0; x < img.width; x++) line += img.gray[y * img.width + x] < threshold ? "#" : ".";
    rows.push(line);
  }
  return rows.join("\n");
}
