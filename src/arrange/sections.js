// arrange/sections: one track per part of the song.
//
// A tab arrives as one long take. The callouts in it ("[Intro]", "Chorus:")
// say where the parts begin, so this cuts every track along those lines and
// hands the DAW an intro, a verse and a chorus it can loop, duplicate and
// rearrange — which is what people open a MIDI file to do.
//
// Notes keep their absolute beat positions. A section track is not a loop
// starting at zero: it sits where it plays, so the parts line up in the
// arrangement exactly as the tab reads.
//
// Pure ES module: no imports, no DOM, no browser APIs.

/** Beats of slack when deciding which side of a boundary a note falls on. */
const EPSILON = 1e-6;

/**
 * Which roles get cut up.
 *
 * Only the literal tab. Cutting every role multiplies tracks by parts — a
 * six-part song with a guitar and a lead arrives as twelve tracks, and with
 * the full arrangement as twenty-four, which is a worse thing to open than
 * the single track it replaced. The part you want to loop and move around is
 * the one that was actually tabbed; the chords, bass and lead the arranger
 * invented are accompaniment, and they read better as continuous tracks
 * underneath. The markers still label the parts across all of them.
 */
export const SPLIT_ROLES = ["guitar"];

/**
 * The beat range each section owns, as a half-open span [from, to).
 *
 * The first section reaches back to the start of time and the last one runs
 * to the end of it, so every note lands in exactly one section however the
 * callouts were placed. A stave the callouts never reached is played by the
 * part above it, which is what the tab looks like on the page.
 */
export function sectionRanges(sections) {
  return sections.map((section, i) => ({
    name: section.name,
    from: i === 0 ? -Infinity : section.start,
    to: i === sections.length - 1 ? Infinity : sections[i + 1].start,
  }));
}

/**
 * Split an IR's tabbed track along its sections, leaving the rest whole.
 *
 * Each output track keeps its `role` — so it keeps the instrument and channel
 * the encoder gives that role — and gains a `section` naming the part it
 * holds. Sections with nothing in them are left out rather than written as
 * empty tracks. Roles outside SPLIT_ROLES pass through untouched, in the
 * order they arrived.
 *
 * Returns a new IR; the input is not modified. An IR with fewer than two
 * sections comes back unchanged, because there is nothing to split.
 */
export function splitBySection(ir) {
  const sections = (ir && ir.sections) || [];
  const tracks = (ir && ir.tracks) || [];
  if (sections.length < 2 || !tracks.length) return { ...ir, tracks: tracks.slice() };

  const ranges = sectionRanges(sections);
  const out = [];
  let split = 0;
  for (const track of tracks) {
    const notes = track.notes || [];
    if (!notes.length) continue;
    if (!SPLIT_ROLES.includes(track.role)) {
      out.push({ ...track });
      continue;
    }
    for (const range of ranges) {
      const inRange = notes.filter((n) => n.start >= range.from - EPSILON && n.start < range.to - EPSILON);
      if (!inRange.length) continue;
      out.push({ ...track, section: range.name, notes: inRange });
      split++;
    }
  }
  // Nothing was actually cut up: hand back what came in rather than a
  // rearranged copy of it.
  return { ...ir, tracks: split ? out : tracks.slice() };
}
