// The whole conversion in one call: text -> IR -> arranged IR -> MIDI bytes.
// Used by the CLI (tools/convert.js) and by the extension's background page.
// This module may import from every pure module; the pure modules never
// import from here.

import { parseText, ParseError } from "./parse/index.js";
import { arrange } from "./arrange/index.js";
import { splitBySection } from "./arrange/sections.js";
import { encodeMidi, trackNames, roleNames, buildFilename } from "./midi/index.js";
import { tuningById, identifyTuning } from "./parse/tuning.js";

export { ParseError };

/**
 * Convert tab text into a MIDI file.
 *
 * options (all optional):
 *   source, title, artist, tempo, capo   what the page told us
 *   tuningId       force a named tuning (dropdown choice)
 *   step           "1/4" | "1/8" | "1/16"
 *   arrange        false to skip the chords/bass/lead tracks (default true)
 *   splitSections  false to keep the tabbed track whole instead of cutting
 *                  it into one track per part of the song (default true)
 *   filenameSuffix e.g. the tuning label when the user re-did the conversion
 *
 * Returns { ir, bytes, filename, summary } where summary is what the UI
 * needs: { title, artist, kind, rhythmSource, tuningId, tuningNotes, tracks,
 * trackNames, sections, splitSections, noteCount, staves, chords, tempo,
 * timeSignature }.
 *   tracks         one name per role, however many tracks each role holds
 *   trackNames     one name per track actually written to the file, in order
 *   sections       the names of the song's parts, or [] when it has none
 *   splitSections  whether the file really was split (asking for it on a tab
 *                  with nothing to split leaves the tracks whole)
 * Throws ParseError with code "no-tab" or "no-notes" when there is nothing
 * to convert.
 */
export function convertText(text, options = {}) {
  const parsed = parseText(text, options);
  const arranged = options.arrange === false ? parsed : arrange(parsed);
  // Splitting comes last, so it cuts the tabbed track after the arranger has
  // read it whole — the chords and bassline are derived from the whole
  // performance, not from one part at a time. Only the tab is cut; see
  // SPLIT_ROLES.
  const ir = options.splitSections === false ? arranged : splitBySection(arranged);
  const bytes = encodeMidi(ir);
  const filename = buildFilename(ir, options.filenameSuffix || "");
  const guitarNotes = ir.tracks.filter((t) => t.role === "guitar").flatMap((t) => t.notes);
  const known = identifyTuning(ir.tuning);
  const summary = {
    title: ir.title,
    artist: ir.artist,
    kind: ir.kind,
    rhythmSource: ir.rhythmSource,
    tuningId: options.tuningId && tuningById(options.tuningId) ? options.tuningId : known ? known.id : null,
    tuningNotes: ir.tuning,
    tracks: roleNames(ir),
    trackNames: trackNames(ir),
    sections: (ir.sections || []).map((s) => s.name),
    // Read off the result, not off the request: asking to split a tab that
    // has nothing to split leaves the tracks whole, and the summary should
    // say so. A track carries `section` only if it was actually cut.
    splitSections: ir.tracks.some((t) => t.section),
    noteCount: guitarNotes.length,
    staves: ir.info ? ir.info.staves : 0,
    chords: ir.info ? ir.info.chords : 0,
    tempo: ir.tempo,
    timeSignature: ir.timeSignature,
  };
  return { ir, bytes, filename, summary };
}
