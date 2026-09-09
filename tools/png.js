#!/usr/bin/env node
// A PNG reader, so the command line can be pointed at a screenshot.
//
// Node only. The extension never uses this: in the browser a picture comes
// from a <canvas> or from createImageBitmap, both of which hand over pixels
// already. This exists so `node tools/convert.js screenshot.png out.mid`
// works, and so the reader's tests can be given a real file.
//
// Written out by hand rather than pulled from npm because the whole project
// has no runtime dependencies and this is the only piece of decoding it
// needs. Node's own zlib does the hard part.

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Colour types, and how many samples each pixel has. */
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export function isPng(bytes) {
  if (!bytes || bytes.length < SIGNATURE.length) return false;
  return SIGNATURE.every((byte, i) => bytes[i] === byte);
}

/**
 * Read a PNG into { width, height, gray }: one byte a pixel, 0 black,
 * 255 white, which is all the sheet-music reader wants.
 *
 * Throws with a plain message for the formats it does not handle, rather
 * than returning something quietly wrong.
 */
export function readPng(bytes) {
  if (!isPng(bytes)) throw new Error("that file is not a PNG");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = SIGNATURE.length;
  let header = null;
  let palette = null;
  let transparency = null;
  const data = [];

  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const start = at + 8;
    // Body plus the four-byte CRC that follows it. A file cut short after the
    // body would otherwise pass as a whole chunk and decode to nonsense.
    if (start + length + 4 > bytes.length) break;
    if (type === "IHDR") {
      header = {
        width: view.getUint32(start),
        height: view.getUint32(start + 4),
        depth: bytes[start + 8],
        colour: bytes[start + 9],
        interlace: bytes[start + 12],
      };
    } else if (type === "PLTE") {
      palette = bytes.subarray(start, start + length);
    } else if (type === "tRNS") {
      transparency = bytes.subarray(start, start + length);
    } else if (type === "IDAT") {
      data.push(bytes.subarray(start, start + length));
    } else if (type === "IEND") {
      break;
    }
    at = start + length + 4;
  }

  if (!header) throw new Error("that PNG has no header in it");
  if (header.interlace) throw new Error("that PNG is interlaced, which this reader does not handle; save it again without interlacing");
  const channels = CHANNELS[header.colour];
  if (!channels) throw new Error(`that PNG uses a colour type this reader does not handle (${header.colour})`);
  if (header.colour === 3 && !palette) throw new Error("that PNG says it uses a palette but does not include one");

  const raw = inflateSync(concat(data));
  const lines = unfilter(raw, header, channels);
  return { width: header.width, height: header.height, gray: toGray(lines, header, channels, palette, transparency) };
}

function concat(parts) {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Undo the per-row filters.
 *
 * Every scanline of a PNG is stored as a difference from its neighbours —
 * the pixel to the left, the one above, or Paeth's pick of the two — which is
 * what makes it compress. Undoing it is the whole of the format.
 */
function unfilter(raw, header, channels) {
  const bitsPerPixel = header.depth * channels;
  const step = Math.max(1, bitsPerPixel >> 3);
  const stride = Math.ceil((header.width * bitsPerPixel) / 8);
  const out = new Uint8Array(stride * header.height);
  let at = 0;
  for (let y = 0; y < header.height; y++) {
    const filter = raw[at++];
    const row = y * stride;
    const above = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[at + x];
      const left = x >= step ? out[row + x - step] : 0;
      const up = y > 0 ? out[above + x] : 0;
      const upLeft = y > 0 && x >= step ? out[above + x - step] : 0;
      let restored;
      switch (filter) {
        case 0:
          restored = value;
          break;
        case 1:
          restored = value + left;
          break;
        case 2:
          restored = value + up;
          break;
        case 3:
          restored = value + ((left + up) >> 1);
          break;
        case 4:
          restored = value + paeth(left, up, upLeft);
          break;
        default:
          throw new Error(`that PNG uses a row filter this reader does not know (${filter})`);
      }
      out[row + x] = restored & 0xff;
    }
    at += stride;
  }
  return { bytes: out, stride };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** One sample out of a row, as it is stored. */
function rawSample(bytes, row, index, depth) {
  if (depth === 8) return bytes[row + index];
  if (depth === 16) return bytes[row + index * 2]; // the high byte is plenty
  const perByte = 8 / depth;
  const byte = bytes[row + Math.floor(index / perByte)];
  const shift = 8 - depth * ((index % perByte) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

/** ...and the same sample stretched to the usual 0-255. */
function sample(bytes, row, index, depth) {
  const value = rawSample(bytes, row, index, depth);
  if (depth === 8 || depth === 16) return value;
  return Math.round((value * 255) / ((1 << depth) - 1));
}

/** Luminance, with anything see-through counted as paper rather than ink. */
function toGray(lines, header, channels, palette, transparency) {
  const { bytes, stride } = lines;
  const { width, height, depth, colour } = header;
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    for (let x = 0; x < width; x++) {
      const at = x * channels;
      let r;
      let g;
      let b;
      let alpha = 255;
      if (colour === 3) {
        const index = rawSample(bytes, row, at, depth);
        r = palette[index * 3];
        g = palette[index * 3 + 1];
        b = palette[index * 3 + 2];
        if (transparency && index < transparency.length) alpha = transparency[index];
      } else if (colour === 0 || colour === 4) {
        r = g = b = sample(bytes, row, at, depth);
        if (colour === 4) alpha = sample(bytes, row, at + 1, depth);
      } else {
        r = sample(bytes, row, at, depth);
        g = sample(bytes, row, at + 1, depth);
        b = sample(bytes, row, at + 2, depth);
        if (colour === 6) alpha = sample(bytes, row, at + 3, depth);
      }
      const lum = (r * 77 + g * 150 + b * 29) >> 8;
      gray[y * width + x] = alpha === 255 ? lum : 255 - (((255 - lum) * alpha) / 255) | 0;
    }
  }
  return gray;
}

/**
 * Write a PNG. Only used by the tests, to make picture fixtures a person can
 * open and look at, and by --picture-out when a reading has to be checked.
 */
export function writePng({ width, height, gray }) {
  const stride = width + 1;
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // no filter: these are small and clarity beats bytes
    raw.set(gray.subarray(y * width, (y + 1) * width), y * stride + 1);
  }
  return chunks(width, height, deflateSync(raw));
}

function chunks(width, height, idat) {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  return concat([new Uint8Array(SIGNATURE), chunk("IHDR", header), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
}

function chunk(type, body) {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
