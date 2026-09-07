// arrange/: IR -> IR with extra tracks (chords, bass, lead) derived from the
// literal guitar track. This is the feature that makes the output usable in
// a DAW straight away, so every musical choice is spelled out below.
//
// Pure ES module: no imports, no DOM, no browser APIs.

// --------------------------------------------------------------------------
// Tunable musical constants
// --------------------------------------------------------------------------

/**
 * MUSICAL DECISION: a group of notes struck at the same moment counts as a
 * chord when it has at least this many notes. Two-note groups only count
 * when they form a power chord (root + fifth), because rock tabs are full of
 * them and a pad holding root + fifth sounds right underneath.
 */
export const MIN_CHORD_NOTES = 3;

/** Pad voicing range: the root goes in 60..71, everything stacks up to 84. */
export const CHORD_LOW = 60;
export const CHORD_HIGH = 84;

/** Bass range: 36 (C2) to 48 (C3), a comfortable synth-bass register. */
export const BASS_LOW = 36;
export const BASS_HIGH = 48;

/** A run of single notes has to be longer than this to become the lead track. */
export const MIN_LEAD_RUN = 4;

/** Loudness of the generated parts, 0..1. */
export const CHORD_VELOCITY = 0.7;
export const BASS_VELOCITY = 0.75;

// --------------------------------------------------------------------------
// Grouping
// --------------------------------------------------------------------------

/** Notes that start at the same beat form one group; groups come back in time order. */
export function groupByStart(notes) {
  const map = new Map();
  for (const n of notes) {
    const key = Math.round(n.start * 1000);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group.slice().sort((a, b) => a.midi - b.midi));
}

// --------------------------------------------------------------------------
// Chord analysis
// --------------------------------------------------------------------------

const pc = (midi) => ((midi % 12) + 12) % 12;

/**
 * Find the most plausible root of a set of pitch classes.
 *
 * MUSICAL DECISION: each candidate root is scored by which chord tones sit
 * above it — a perfect fifth is the strongest clue, a third next, a seventh
 * after that. The lowest sounding note gets a small bonus because guitarists
 * usually put the root at the bottom. Ties go to the lowest note.
 */
export function analyzeChord(midis) {
  const pcs = [...new Set(midis.map(pc))];
  const lowestPc = pc(Math.min(...midis));
  let best = null;
  for (const root of pcs) {
    const has = (interval) => pcs.includes((root + interval) % 12);
    const major3 = has(4);
    const minor3 = has(3);
    const fifth = has(7);
    const dim5 = has(6);
    const aug5 = has(8);
    const sus4 = has(5);
    const sus2 = has(2);
    const min7 = has(10);
    const maj7 = has(11);
    let score = 0;
    if (fifth) score += 3;
    if (major3 || minor3) score += 2;
    if (min7 || maj7) score += 1;
    if (minor3 && dim5) score += 1.5; // diminished triad
    if (!fifth && (dim5 || aug5)) score += 1;
    if (!major3 && !minor3 && (sus4 || sus2)) score += 0.5;
    if (root === lowestPc) score += 1.5;
    if (!best || score > best.score) {
      best = { score, root, major3, minor3, fifth, dim5, aug5, sus4, sus2, min7, maj7 };
    }
  }
  if (!best) return null;
  // Intervals to keep: root, one third-ish tone, one fifth-ish tone, one seventh.
  const intervals = [0];
  if (best.major3 && !best.minor3) intervals.push(4);
  else if (best.minor3) intervals.push(3);
  else if (best.sus4) intervals.push(5);
  else if (best.sus2) intervals.push(2);
  if (best.fifth) intervals.push(7);
  else if (best.dim5) intervals.push(6);
  else if (best.aug5) intervals.push(8);
  if (best.maj7) intervals.push(11);
  else if (best.min7) intervals.push(10);
  return { root: best.root, intervals };
}

/**
 * Voice a chord for the pad: root in CHORD_LOW..CHORD_LOW+11, other tones
 * stacked closely above it, all inside CHORD_LOW..CHORD_HIGH.
 * Doubled octaves are dropped by construction (one note per interval).
 */
export function voicePad({ root, intervals }) {
  const rootMidi = CHORD_LOW + ((root - (CHORD_LOW % 12) + 12) % 12);
  const out = intervals.map((i) => rootMidi + i);
  return out.filter((m) => m >= CHORD_LOW && m <= CHORD_HIGH);
}

/** Move a note by octaves until it sits inside BASS_LOW..BASS_HIGH. */
export function toBassRange(midi) {
  let m = midi;
  while (m < BASS_LOW) m += 12;
  while (m > BASS_HIGH) m -= 12;
  return m;
}

// --------------------------------------------------------------------------
// Track builders
// --------------------------------------------------------------------------

/** Chord groups: >= MIN_CHORD_NOTES notes, or a two-note power chord. */
function isChordGroup(group) {
  if (group.length >= MIN_CHORD_NOTES) return true;
  if (group.length === 2) {
    const interval = (group[1].midi - group[0].midi) % 12;
    return interval === 7 || interval === 5; // fifth, or fifth inverted (a fourth)
  }
  return false;
}

export function buildChordTrack(groups) {
  const notes = [];
  for (const group of groups) {
    if (!isChordGroup(group)) continue;
    const chord = analyzeChord(group.map((n) => n.midi));
    if (!chord || chord.intervals.length < 2) continue;
    const length = Math.max(...group.map((n) => n.length));
    const start = group[0].start;
    for (const midi of voicePad(chord)) {
      notes.push({ midi, start, length, velocity: CHORD_VELOCITY, technique: null });
    }
  }
  return notes;
}

/**
 * Bass: the lowest note of every chord group, moved into the bass register.
 * MUSICAL DECISION: it follows the guitarist's lowest note rather than the
 * analysed root, so slash chords and inversions keep their bass movement.
 */
export function buildBassTrack(groups) {
  const notes = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    const lowest = group[0];
    if (lowest.technique === "mute") continue;
    notes.push({ midi: toBassRange(lowest.midi), start: lowest.start, length: Math.max(...group.map((n) => n.length)), velocity: BASS_VELOCITY, technique: null });
  }
  return notes;
}

/** Lead: contiguous runs of single-note events longer than MIN_LEAD_RUN. */
export function buildLeadTrack(groups) {
  const notes = [];
  let run = [];
  const flush = () => {
    if (run.length > MIN_LEAD_RUN) {
      for (const n of run) notes.push({ midi: n.midi, start: n.start, length: n.length, velocity: n.velocity, technique: n.technique });
    }
    run = [];
  };
  for (const group of groups) {
    if (group.length === 1 && group[0].technique !== "mute") run.push(group[0]);
    else flush();
  }
  flush();
  return notes;
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/**
 * Add chords / bass / lead tracks to an IR. Returns a new IR; the input is
 * not modified. Tracks that would be empty are not added.
 */
export function arrange(ir) {
  const guitar = (ir.tracks || []).find((t) => t.role === "guitar");
  if (!guitar || !guitar.notes.length) return { ...ir, tracks: (ir.tracks || []).slice() };
  const groups = groupByStart(guitar.notes);
  const extra = [
    { role: "chords", notes: buildChordTrack(groups) },
    { role: "bass", notes: buildBassTrack(groups) },
    { role: "lead", notes: buildLeadTrack(groups) },
  ].filter((t) => t.notes.length > 0);
  const tracks = [...ir.tracks.filter((t) => !["chords", "bass", "lead"].includes(t.role)), ...extra];
  return { ...ir, tracks };
}
