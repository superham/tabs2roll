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
 * Split every track of an IR along its sections.
 *
 * Each output track keeps its `role` — so it keeps the instrument and channel
 * the encoder gives that role — and gains a `section` naming the part it
 * holds. Sections with nothing in them for a given role are left out rather
 * than written as empty tracks.
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
  for (const track of tracks) {
    const notes = track.notes || [];
    if (!notes.length) continue;
    for (const range of ranges) {
      const inRange = notes.filter((n) => n.start >= range.from - EPSILON && n.start < range.to - EPSILON);
      if (!inRange.length) continue;
      out.push({ ...track, section: range.name, notes: inRange });
    }
  }
  return { ...ir, tracks: out.length ? out : tracks.slice() };
}
