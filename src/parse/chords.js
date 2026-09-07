// Chord sheet parser: chord symbols written above lyrics -> block chords.
//
// MUSICAL DECISION: with no rhythm information, every chord symbol gets one
// whole bar (4 beats in 4/4). Chords are laid out one after another in the
// order they appear. A DAW user can then split or shorten bars by ear.
//
// Pure ES module: no DOM, no browser APIs.

import { splitLines } from "./text.js";
import { noteNameToPitchClass } from "./tuning.js";

/**
 * One chord symbol. Root, optional accidental, optional quality, optional
 * extension digits, optional sus/add tail, optional slash bass.
 *   C  Am  F#m7  Bb  Gsus4  Dmaj7  E7  Cadd9  D/F#  Bdim  Caug  A5
 */
export const CHORD_RE = /^([A-G])(#|b)?(maj|min|dim|aug|sus|add|m|M|\+|°)?(\d+)?(sus\d?|add\d+)?(?:\/([A-G])(#|b)?)?$/;

/** Tokens that may appear on a chord line without being chords. */
const FILLER_RE = /^(\||\|\||-|–|—|\/|x\d+|\(x\d+\)|\d+x|N\.?C\.?|\(N\.?C\.?\)|\.|,)$/i;

/** "[Verse 1]", "Chorus:", "Intro" — section markers we skip. */
const SECTION_RE = /^\s*(\[[^\]]+\]|\(?(intro|verse|chorus|bridge|outro|pre-chorus|prechorus|solo|interlude|refrain|ending|coda|riff|instrumental|break|hook|tag)\b[^:\n]*:?\)?)\s*$/i;

// Interval recipes in semitones above the root.
const QUALITY_INTERVALS = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  power: [0, 7],
};

/**
 * Parse one chord symbol into { name, rootPc, intervals, bassPc }.
 * Returns null if the token is not a chord.
 */
export function parseChordSymbol(token) {
  const m = CHORD_RE.exec(token);
  if (!m) return null;
  const [, root, acc, qualityRaw, digitsRaw, tail, bassRoot, bassAcc] = m;
  const rootPc = noteNameToPitchClass(root + (acc || ""));
  let quality = "major";
  let seventh = null; // semitones above root, or null
  const extras = [];
  const digits = digitsRaw ? parseInt(digitsRaw, 10) : null;

  switch (qualityRaw) {
    case "m":
    case "min":
      quality = "minor";
      break;
    case "dim":
    case "°":
      quality = "dim";
      break;
    case "aug":
    case "+":
      quality = "aug";
      break;
    case "sus":
      quality = digits === 2 ? "sus2" : "sus4";
      break;
    case "maj":
    case "M":
      quality = "major";
      if (digits && digits >= 7) seventh = 11; // maj7, maj9 ...
      break;
    case "add":
      quality = "major";
      break;
    default:
      break;
  }

  if (qualityRaw !== "sus" && qualityRaw !== "maj" && qualityRaw !== "M" && qualityRaw !== "add" && digits !== null) {
    if (digits === 5) quality = "power";
    else if (digits === 6) extras.push(9); // sixth chord
    else if (digits === 7 || digits === 9 || digits === 11 || digits === 13) {
      // Dominant / minor sevenths. Diminished sevenths get the bb7 (9 semitones).
      seventh = quality === "dim" ? 9 : 10;
      if (digits >= 9) extras.push(14); // the 9th, an octave above the 2nd
    }
  }
  if (qualityRaw === "add" && digits) {
    if (digits === 9 || digits === 2) extras.push(14);
    if (digits === 4 || digits === 11) extras.push(17);
  }
  if (tail) {
    if (/^sus2$/i.test(tail)) quality = "sus2";
    else if (/^sus/i.test(tail)) quality = "sus4";
    else if (/^add(9|2)$/i.test(tail)) extras.push(14);
    else if (/^add(4|11)$/i.test(tail)) extras.push(17);
  }

  const intervals = QUALITY_INTERVALS[quality].slice();
  if (seventh !== null) intervals.push(seventh);
  for (const e of extras) if (!intervals.includes(e)) intervals.push(e);
  const bassPc = bassRoot ? noteNameToPitchClass(bassRoot + (bassAcc || "")) : null;
  return { name: token, rootPc, intervals, bassPc };
}

/**
 * Is this line made only of chord symbols (plus fillers like "|" or "x2")?
 * Returns the chords on it, or null.
 */
export function chordLine(line) {
  let text = line.trim();
  if (!text || SECTION_RE.test(text)) return null;
  // "Intro: C G Am F"
  text = text.replace(/^[A-Za-z][A-Za-z0-9 '-]{0,20}:\s*/, "");
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const chords = [];
  for (const tok of tokens) {
    const chord = parseChordSymbol(tok);
    if (chord) chords.push(chord);
    else if (!FILLER_RE.test(tok)) return null;
  }
  return chords.length ? chords : null;
}

/** Count chord lines and total chord symbols in a text (for the detector). */
export function chordStats(lines) {
  let chordLines = 0;
  let chords = 0;
  for (const line of lines) {
    const c = chordLine(line);
    if (c) {
      chordLines++;
      chords += c.length;
    }
  }
  return { chordLines, chords };
}

// --------------------------------------------------------------------------
// Voicing
// --------------------------------------------------------------------------

/** Lowest allowed root for the "as strummed" guitar voicing: G2 (43). */
const GUITAR_ROOT_MIN = 43;

/**
 * Voice a chord the way a guitarist strums it: root low (G2..F#3), the
 * chord tones stacked above it, and the root doubled an octave up for body.
 * A slash chord puts its bass note underneath the root.
 *
 * MUSICAL DECISION: this voicing feeds the "Guitar (as tabbed)" track; the
 * arranger later reduces it to a clean pad voicing in 60..84 and a bass note.
 */
export function voiceChord(chord) {
  let root = GUITAR_ROOT_MIN + ((chord.rootPc - GUITAR_ROOT_MIN % 12 + 12) % 12);
  const notes = [];
  if (chord.bassPc !== null && chord.bassPc !== chord.rootPc) {
    let bass = root - ((root - chord.bassPc + 12) % 12 || 12);
    notes.push(bass);
  }
  for (const interval of chord.intervals) notes.push(root + interval);
  notes.push(root + 12);
  return [...new Set(notes)].sort((a, b) => a - b);
}

/**
 * Parse a chord sheet into notes. Each chord lasts one bar.
 * Returns { notes, chordCount, lineCount }.
 */
export function parseChordSheet(text, options = {}) {
  const lines = splitLines(text);
  const timeSignature = options.timeSignature || [4, 4];
  const beatsPerBar = timeSignature[0] * (4 / timeSignature[1]);
  const notes = [];
  let bar = 0;
  let chordCount = 0;
  let lineCount = 0;
  for (const line of lines) {
    const chords = chordLine(line);
    if (!chords) continue;
    lineCount++;
    for (const chord of chords) {
      const start = bar * beatsPerBar;
      for (const midi of voiceChord(chord)) {
        notes.push({ midi, start, length: beatsPerBar, velocity: 0.75, technique: null, chord: chord.name });
      }
      bar++;
      chordCount++;
    }
  }
  return { notes, chordCount, lineCount, totalBeats: bar * beatsPerBar };
}
