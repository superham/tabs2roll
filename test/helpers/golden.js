// Shape of a golden file: the handful of facts about a fixture that a human
// can check by eye (stave count, note count, first/last pitch, tuning) plus
// the per-track counts the arranger produces.

import { detect, parseText, ParseError } from "../../src/parse/index.js";
import { arrange } from "../../src/arrange/index.js";

export function goldenFor(text) {
  const d = detect(text);
  if (d.kind === "none") {
    return { kind: "none", staves: d.staves, noteCount: 0, firstMidi: null, lastMidi: null, tuning: null };
  }
  let ir;
  try {
    ir = arrange(parseText(text));
  } catch (err) {
    if (err instanceof ParseError) return { kind: d.kind, error: err.code, staves: d.staves, noteCount: 0, firstMidi: null, lastMidi: null, tuning: null };
    throw err;
  }
  const guitar = ir.tracks.find((t) => t.role === "guitar").notes;
  const tracks = {};
  for (const t of ir.tracks) tracks[t.role] = t.notes.length;
  return {
    kind: ir.kind,
    title: ir.title,
    artist: ir.artist,
    tempo: ir.tempo,
    timeSignature: ir.timeSignature,
    tuning: ir.tuning,
    tuningId: ir.info.tuningId,
    staves: ir.info.staves,
    chords: ir.info.chords,
    unit: ir.info.unit ?? null,
    totalBeats: ir.info.totalBeats,
    noteCount: guitar.length,
    firstMidi: guitar[0].midi,
    lastMidi: guitar[guitar.length - 1].midi,
    firstStart: guitar[0].start,
    lastStart: guitar[guitar.length - 1].start,
    techniques: countBy(guitar.map((n) => n.technique).filter(Boolean)),
    tracks,
  };
}

function countBy(list) {
  const out = {};
  for (const k of list) out[k] = (out[k] || 0) + 1;
  return out;
}
