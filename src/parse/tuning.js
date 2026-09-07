// Tunings: reference tables, header-text parsing, and inference from the
// note-name labels at the start of tab lines.
//
// Every tuning is an array of MIDI note numbers, LOW string to HIGH string.
// Standard guitar: low E = 40, A = 45, D = 50, G = 55, B = 59, high e = 64.
// `midi = openString + fret` everywhere. Middle C is MIDI 60.

export const STANDARD_GUITAR = [40, 45, 50, 55, 59, 64];

/**
 * Named tunings the UI can offer. `id` is the stable key used by options and
 * the "Wrong tuning?" dropdown; the display label lives in src/strings.js.
 * `aliases` are lower-case phrases that identify the tuning in tab headers.
 */
export const KNOWN_TUNINGS = [
  { id: "standard", notes: [40, 45, 50, 55, 59, 64], aliases: ["standard", "e standard", "standard tuning", "eadgbe", "e a d g b e"] },
  { id: "drop-d", notes: [38, 45, 50, 55, 59, 64], aliases: ["drop d", "dropped d", "dadgbe", "d a d g b e"] },
  // Eb standard: every string one semitone lower than standard.
  { id: "eb-standard", notes: [39, 44, 49, 54, 58, 63], aliases: ["eb standard", "e flat standard", "e♭ standard", "eb tuning", "half step down", "half-step down", "1/2 step down", "half a step down", "ebabdbgbbbeb", "eb ab db gb bb eb", "d# standard", "d#g#c#f#a#d#"] },
  // D standard: every string a whole step (two semitones) lower.
  { id: "d-standard", notes: [38, 43, 48, 53, 57, 62], aliases: ["d standard", "whole step down", "whole-step down", "full step down", "1 step down", "one step down", "dgcfad", "d g c f a d"] },
  // DADGAD: the outer strings and the 5th string stay put relative to Drop D;
  // the B string drops to A and the high e drops to d.
  { id: "dadgad", notes: [38, 45, 50, 55, 57, 62], aliases: ["dadgad", "d a d g a d"] },
  // Open G: strum the open strings and you get a G major chord (D G D G B D).
  { id: "open-g", notes: [38, 43, 50, 55, 59, 62], aliases: ["open g", "dgdgbd", "d g d g b d"] },
  // Open D: open strings give D major (D A D F# A D).
  { id: "open-d", notes: [38, 45, 50, 54, 57, 62], aliases: ["open d", "dadf#ad", "d a d f# a d"] },
  { id: "open-e", notes: [40, 47, 52, 56, 59, 64], aliases: ["open e", "ebeg#be", "e b e g# b e"] },
  { id: "open-a", notes: [40, 45, 52, 57, 61, 64], aliases: ["open a", "eaeac#e", "e a e a c# e"] },
  { id: "drop-c", notes: [36, 43, 48, 53, 57, 62], aliases: ["drop c", "dropped c", "cgcfad", "c g c f a d"] },
  { id: "drop-c#", notes: [37, 44, 49, 54, 58, 63], aliases: ["drop c#", "drop db", "dropped c#", "c#g#c#f#a#d#"] },
  { id: "c-standard", notes: [36, 41, 46, 51, 55, 60], aliases: ["c standard", "two steps down", "2 steps down", "cfa#d#gc", "c f bb eb g c"] },
];

/** Tunings offered in the "Wrong tuning? Re-do as:" dropdown, in order. */
export const SELECTABLE_TUNING_IDS = ["standard", "drop-d", "eb-standard", "d-standard", "dadgad", "open-g", "open-d"];

/**
 * Default tuning by number of strings in a stave, low to high.
 * 4 lines is almost always a bass tab; 5 a five-string bass; 7/8 extended
 * range guitars that add a low B (35) and low F# (30) below standard.
 */
export const DEFAULT_TUNING_BY_STRING_COUNT = {
  3: [40, 45, 50], // arbitrary: the three low strings of a guitar
  4: [28, 33, 38, 43], // bass: E1 A1 D2 G2
  5: [23, 28, 33, 38, 43], // five-string bass with a low B0
  6: STANDARD_GUITAR,
  7: [35, 40, 45, 50, 55, 59, 64],
  8: [30, 35, 40, 45, 50, 55, 59, 64],
};

/** Other instruments recognised purely from their string labels (high to low as written on the page). */
const LABEL_INSTRUMENTS = [
  { id: "ukulele", labelsTopToBottom: ["a", "e", "c", "g"], notes: [67, 60, 64, 69] },
  { id: "bass", labelsTopToBottom: ["g", "d", "a", "e"], notes: [28, 33, 38, 43] },
  { id: "bass-5", labelsTopToBottom: ["g", "d", "a", "e", "b"], notes: [23, 28, 33, 38, 43] },
];

const PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** "F#" -> 6, "Bb" -> 10, "e" -> 4. Returns null for anything else. */
export function noteNameToPitchClass(name) {
  if (typeof name !== "string") return null;
  const m = /^([A-Ga-g])([#♯]|[b♭])?$/.exec(name.trim());
  if (!m) return null;
  let pc = PITCH_CLASS[m[1].toLowerCase()];
  if (m[2] === "#" || m[2] === "♯") pc += 1;
  if (m[2] === "b" || m[2] === "♭") pc -= 1;
  return (pc + 12) % 12;
}

export function midiToNoteName(midi) {
  return NOTE_NAMES_SHARP[((midi % 12) + 12) % 12];
}

export function tuningById(id) {
  return KNOWN_TUNINGS.find((t) => t.id === id) || null;
}

/** Find a known tuning whose notes equal the given list, or null. */
export function identifyTuning(notes) {
  if (!Array.isArray(notes)) return null;
  for (const t of KNOWN_TUNINGS) {
    if (t.notes.length === notes.length && t.notes.every((n, i) => n === notes[i])) return t;
  }
  return null;
}

/** Human readable fallback like "D A D G A D" for tunings that have no name. */
export function describeTuning(notes) {
  const known = identifyTuning(notes);
  if (known) return known.id;
  return notes.map(midiToNoteName).join(" ");
}

/**
 * Given pitch classes low-to-high and a reference tuning of the same length,
 * pick for each string the MIDI note with that pitch class nearest to the
 * reference string. This is how "D A D G A D" becomes 38 45 50 55 57 62:
 * each string moves the shortest distance from standard.
 */
export function nearestNotesToReference(pitchClasses, reference) {
  return pitchClasses.map((pc, i) => {
    const ref = reference[Math.min(i, reference.length - 1)];
    // Candidate in the same octave region as the reference, then the ones
    // an octave either side; keep whichever is closest.
    const base = ref - (((ref % 12) - pc + 12) % 12);
    const candidates = [base, base + 12, base - 12];
    let best = candidates[0];
    for (const c of candidates) if (Math.abs(c - ref) < Math.abs(best - ref)) best = c;
    return best;
  });
}

/**
 * Parse the text after "Tuning:" (or a whole header line) into a tuning.
 * Returns { notes, id } for absolute tunings, { shift } for relative ones
 * like "half step down" that should be applied to whatever the string count
 * implies, or null when nothing recognisable is present.
 */
export function parseTuningText(raw) {
  if (typeof raw !== "string") return null;
  const text = raw.toLowerCase().replace(/[()[\]]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Named tunings first (longest alias first so "drop c#" beats "drop c").
  const aliases = [];
  for (const t of KNOWN_TUNINGS) for (const a of t.aliases) aliases.push({ alias: a, tuning: t });
  aliases.sort((x, y) => y.alias.length - x.alias.length);
  for (const { alias, tuning } of aliases) {
    const idx = text.indexOf(alias);
    if (idx === -1) continue;
    // Require word-ish boundaries so "drop d" does not match "drop dead".
    const before = idx === 0 ? " " : text[idx - 1];
    const after = idx + alias.length >= text.length ? " " : text[idx + alias.length];
    if (/[a-z0-9#]/.test(before) || /[a-z0-9#]/.test(after)) continue;
    return { notes: tuning.notes.slice(), id: tuning.id };
  }

  // Relative shifts: "tuned down 1 step", "1 and a half steps down".
  const amount = "(\\d+(?:\\.5)?|half|whole|one|two|three|1\\/2|1 1\\/2)\\s*(?:and a half\\s*)?(?:-|\\s)*(?:half\\s*)?steps?";
  const down = new RegExp(amount + "\\s*(?:down|lower|flat)").exec(text) || new RegExp("(?:down|lower)\\s+" + amount).exec(text);
  if (down) {
    const word = down[1];
    let steps = { half: 0.5, whole: 1, one: 1, two: 2, three: 3, "1/2": 0.5, "1 1/2": 1.5 }[word];
    if (steps === undefined) steps = parseFloat(word);
    if (/and a half/.test(down[0])) steps += 0.5;
    if (steps > 0 && steps <= 4) return { shift: -Math.round(steps * 2) };
  }

  // Explicit note lists: "E A D G B E", "D-A-D-G-A-D", "EADGBe", "Eb Ab Db Gb Bb Eb".
  const compact = text.replace(/[\s,\-–—/]+/g, "");
  const noteRun = /^([a-g][#b]?){3,8}$/i.exec(compact) ? compact.match(/[a-g][#b]?/gi) : null;
  if (noteRun && noteRun.length >= 3 && noteRun.length <= 8) {
    const pcs = noteRun.map(noteNameToPitchClass);
    if (pcs.every((p) => p !== null)) {
      const reference = DEFAULT_TUNING_BY_STRING_COUNT[pcs.length] || STANDARD_GUITAR;
      const notes = nearestNotesToReference(pcs, reference);
      const known = identifyTuning(notes);
      return { notes, id: known ? known.id : null };
    }
  }
  return null;
}

/**
 * Work out string order and tuning from the labels a stave puts in front of
 * its lines, listed TOP to BOTTOM as they appear on the page.
 *
 * Convention is high string on top ("e B G D A E"), but some tabs are written
 * low string on top ("E A D G B e"). We try both readings against the known
 * tunings, then fall back to "which reading gives strings that mostly ascend
 * in pitch from low to high", and finally default to high-on-top.
 *
 * Returns { notes, reversed, id } where `reversed` is true when the TOP line
 * is the LOWEST string. Returns null if the labels are not usable.
 */
export function tuningFromLabels(labelsTopToBottom, fallbackNotes) {
  if (!Array.isArray(labelsTopToBottom) || labelsTopToBottom.length < 3) return null;
  const pcs = labelsTopToBottom.map((l) => noteNameToPitchClass(l));
  if (pcs.some((p) => p === null)) return null;
  const count = pcs.length;
  const lower = labelsTopToBottom.map((l) => l.toLowerCase());

  // Special instruments identified purely by labels (ukulele, bass).
  for (const inst of LABEL_INSTRUMENTS) {
    if (inst.labelsTopToBottom.length !== count) continue;
    if (inst.labelsTopToBottom.every((l, i) => l === lower[i])) return { notes: inst.notes.slice(), reversed: false, id: inst.id };
    const rev = inst.labelsTopToBottom.slice().reverse();
    if (rev.every((l, i) => l === lower[i])) return { notes: inst.notes.slice(), reversed: true, id: inst.id };
  }

  const reference = fallbackNotes && fallbackNotes.length === count ? fallbackNotes : DEFAULT_TUNING_BY_STRING_COUNT[count] || STANDARD_GUITAR;
  const asHighOnTop = pcs.slice().reverse(); // low to high
  const asLowOnTop = pcs.slice(); // already low to high

  const matchKnown = (lowToHigh) => KNOWN_TUNINGS.find((t) => t.notes.length === count && t.notes.every((n, i) => ((n % 12) + 12) % 12 === lowToHigh[i]));
  const knownNormal = matchKnown(asHighOnTop);
  const knownReversed = matchKnown(asLowOnTop);

  // Lower-case `e` at the top is the strongest hint of the high-on-top layout,
  // and "E ... e" with the small e at the bottom is the reverse.
  const first = labelsTopToBottom[0];
  const last = labelsTopToBottom[count - 1];
  const smallOnTop = first === "e" && last === "E";
  const smallOnBottom = first === "E" && last === "e";

  if (knownNormal && !(knownReversed && smallOnBottom)) return { notes: knownNormal.notes.slice(), reversed: false, id: knownNormal.id };
  if (knownReversed) return { notes: knownReversed.notes.slice(), reversed: true, id: knownReversed.id };

  const normalNotes = nearestNotesToReference(asHighOnTop, reference);
  const reversedNotes = nearestNotesToReference(asLowOnTop, reference);
  const ascending = (notes) => notes.reduce((score, n, i) => (i > 0 && n > notes[i - 1] ? score + 1 : score), 0);
  let reversed = false;
  if (smallOnBottom) reversed = true;
  else if (!smallOnTop && ascending(reversedNotes) > ascending(normalNotes)) reversed = true;
  const notes = reversed ? reversedNotes : normalNotes;
  const known = identifyTuning(notes);
  return { notes, reversed, id: known ? known.id : null };
}

/**
 * Combine everything we know into the tuning for one stave.
 *   header  - result of parseTuningText for the tab's header, or null
 *   labels  - the stave's string labels top-to-bottom, or null
 *   count   - number of lines in the stave
 *   capo    - capo fret (0 when none); raises every string
 *   override- notes forced by the user ("Wrong tuning? Re-do as:"), or null
 */
export function resolveTuning({ header, labels, count, capo = 0, override = null }) {
  let notes = null;
  let reversed = false;
  let id = null;
  let from = "default";

  const labelInfo = tuningFromLabels(labels, null);
  if (labelInfo) {
    reversed = labelInfo.reversed;
  }

  if (override && override.length === count) {
    notes = override.slice();
    from = "override";
  } else if (header && header.notes && header.notes.length === count) {
    notes = header.notes.slice();
    id = header.id;
    from = "header";
  } else if (labelInfo && labelInfo.notes.length === count) {
    notes = labelInfo.notes.slice();
    id = labelInfo.id;
    from = "labels";
  } else {
    notes = (DEFAULT_TUNING_BY_STRING_COUNT[count] || STANDARD_GUITAR.slice(0, count)).slice();
    if (header && typeof header.shift === "number") {
      notes = notes.map((n) => n + header.shift);
      from = "header";
    }
  }

  // A capo clamps every string N frets up, so every open string sounds N
  // semitones higher. Tab written "relative to the capo" then produces the
  // real sounding pitch when we add the capo here.
  if (capo > 0) notes = notes.map((n) => n + capo);

  const known = identifyTuning(notes);
  return { notes, reversed, id: id || (known ? known.id : null), from };
}
