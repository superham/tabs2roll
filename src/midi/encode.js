// Standard MIDI File encoder, written by hand. Format 1, 480 ticks per
// quarter note. Roughly 150 lines of byte packing; the format is documented
// at https://www.midi.org/specifications (SMF 1.0).
//
// Pure ES module: no imports, no DOM, no browser APIs.

/** Ticks per quarter note. The IR's beat floats are multiplied by this. */
export const PPQ = 480;

/**
 * Per-role track settings. Program numbers are General MIDI, zero-based:
 *   27 Electric Guitar (clean), 89 Pad 2 (warm), 39 Synth Bass 2, 81 Lead 2 (sawtooth).
 * Each role sits on its own channel so a DAW splits them cleanly.
 */
export const TRACK_SETTINGS = {
  guitar: { name: "Guitar (as tabbed)", program: 27, channel: 0 },
  chords: { name: "Chords", program: 89, channel: 1 },
  bass: { name: "Bass", program: 39, channel: 2 },
  lead: { name: "Lead", program: 81, channel: 3 },
};

/** Order tracks appear in the file, after the tempo track. */
export const TRACK_ORDER = ["guitar", "chords", "bass", "lead"];

/**
 * What joins a role's name to the part of the song a track holds:
 * "Guitar (as tabbed) - Chorus 2". A plain hyphen, because a track name is
 * read back by every DAW there is and some of them are old.
 */
export const SECTION_NAME_JOIN = " - ";

/** The name a DAW shows for a track: its role, and its part of the song. */
export function trackName(track) {
  const settings = TRACK_SETTINGS[track.role] || { name: track.role };
  return track.section ? settings.name + SECTION_NAME_JOIN + track.section : settings.name;
}

// --------------------------------------------------------------------------
// Byte helpers
// --------------------------------------------------------------------------

/** Variable-length quantity: 7 bits per byte, high bit set on all but the last. */
export function vlq(value) {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return bytes;
}

function u32(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u16(n) {
  return [(n >>> 8) & 0xff, n & 0xff];
}

function ascii(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out.push(code < 128 ? code : 0x3f); // "?" for anything outside ASCII
  }
  return out;
}

function chunk(tag, body) {
  return [...ascii(tag), ...u32(body.length), ...body];
}

function meta(type, data) {
  return [0xff, type, ...vlq(data.length), ...data];
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// --------------------------------------------------------------------------
// Track building
// --------------------------------------------------------------------------

/**
 * Track 0: tempo (FF 51 03), time signature (FF 58 04), and one marker
 * (FF 06) for each of the song's callouts.
 *
 * Markers are how "[Chorus]" survives the trip into a DAW: every one worth
 * using shows them along the ruler, so the parts of the song stay labelled
 * whether or not the tracks were split up.
 */
function tempoTrack(ir) {
  const bpm = clamp(Number(ir.tempo) || 120, 20, 400);
  const usPerQuarter = Math.round(60000000 / bpm);
  const [num, den] = ir.timeSignature || [4, 4];
  const denPow = Math.round(Math.log2(clamp(den, 1, 32)));
  const body = [
    ...vlq(0),
    ...meta(0x51, [(usPerQuarter >>> 16) & 0xff, (usPerQuarter >>> 8) & 0xff, usPerQuarter & 0xff]),
    ...vlq(0),
    // numerator, denominator as a power of two, MIDI clocks per metronome
    // click (24 = one quarter note), 32nd notes per quarter (8).
    ...meta(0x58, [clamp(num, 1, 255), denPow, 24, 8]),
  ];
  let lastTick = 0;
  for (const section of (ir.sections || []).filter((s) => s && s.name && Number.isFinite(s.start))) {
    const tick = Math.max(0, Math.round(section.start * PPQ));
    if (tick < lastTick) continue; // sections are in playing order; ignore any that are not
    body.push(...vlq(tick - lastTick), ...meta(0x06, ascii(section.name)));
    lastTick = tick;
  }
  body.push(...vlq(0), ...meta(0x2f, []));
  return chunk("MTrk", body);
}

/**
 * One note track. Events are sorted by tick; at equal ticks note-offs come
 * before note-ons so a repeated pitch re-triggers instead of being swallowed.
 */
function noteTrack(track) {
  const settings = TRACK_SETTINGS[track.role] || { name: track.role, program: 0, channel: 0 };
  const notes = track.notes;
  const ch = settings.channel & 0x0f;
  const events = [];
  for (const n of notes) {
    const midi = clamp(Math.round(n.midi), 0, 127);
    const start = Math.max(0, Math.round(n.start * PPQ));
    const length = Math.max(1, Math.round(n.length * PPQ));
    const velocity = clamp(Math.round((typeof n.velocity === "number" ? n.velocity : 0.8) * 127), 1, 127);
    events.push({ tick: start, order: 1, bytes: [0x90 | ch, midi, velocity] });
    events.push({ tick: start + length, order: 0, bytes: [0x80 | ch, midi, 0x40] });
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const body = [...vlq(0), ...meta(0x03, ascii(trackName(track))), ...vlq(0), 0xc0 | ch, settings.program & 0x7f];
  let lastTick = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - lastTick), ...e.bytes);
    lastTick = e.tick;
  }
  body.push(...vlq(0), ...meta(0x2f, []));
  return chunk("MTrk", body);
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Encode an IR into a Format 1 Standard MIDI File.
 * Tracks are written in TRACK_ORDER; roles with no notes are skipped;
 * unknown roles go last. A role split into sections keeps every one of its
 * tracks, in playing order, so a DAW shows the song's parts down the page in
 * the order they are played. Returns a Uint8Array.
 */
export function encodeMidi(ir) {
  if (!ir || !Array.isArray(ir.tracks)) throw new Error("encodeMidi: bad IR");
  const tracks = ir.tracks.filter((t) => t && Array.isArray(t.notes) && t.notes.length > 0);
  const ordered = [
    ...TRACK_ORDER.flatMap((role) => tracks.filter((t) => t.role === role)),
    ...tracks.filter((t) => !TRACK_ORDER.includes(t.role)),
  ];
  const chunks = [tempoTrack(ir), ...ordered.map((t) => noteTrack(t))];
  const header = chunk("MThd", [...u16(1), ...u16(chunks.length), ...u16(PPQ)]);
  const all = [...header];
  for (const c of chunks) for (const b of c) all.push(b);
  return Uint8Array.from(all);
}

/** Names of the tracks encodeMidi would write, in order (for UI summaries). */
export function trackNames(ir) {
  const tracks = (ir.tracks || []).filter((t) => t && t.notes && t.notes.length > 0);
  return [
    ...TRACK_ORDER.flatMap((role) => tracks.filter((t) => t.role === role)),
    ...tracks.filter((t) => !TRACK_ORDER.includes(t.role)),
  ].map(trackName);
}

/** The distinct roles encodeMidi would write, in order (for UI summaries). */
export function roleNames(ir) {
  const tracks = (ir.tracks || []).filter((t) => t && t.notes && t.notes.length > 0);
  const roles = [
    ...TRACK_ORDER.filter((role) => tracks.some((t) => t.role === role)),
    ...tracks.map((t) => t.role).filter((r) => !TRACK_ORDER.includes(r)),
  ];
  return [...new Set(roles)].map((role) => (TRACK_SETTINGS[role] || { name: role }).name);
}
