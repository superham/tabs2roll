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
 *   splitSections  true to cut every track into one track per part of the
 *                  song, using the tab's own callouts (default false)
 *   filenameSuffix e.g. the tuning label when the user re-did the conversion
 *
 * Returns { ir, bytes, filename, summary } where summary is what the UI
 * needs: { title, artist, kind, rhythmSource, tuningId, tuningNotes, tracks,
 * parts, sections, noteCount, staves, chords }.
 * Throws ParseError with code "no-tab" or "no-notes" when there is nothing
 * to convert.
 */
export function convertText(text, options = {}) {
  const parsed = parseText(text, options);
  const arranged = options.arrange === false ? parsed : arrange(parsed);
  // Splitting comes last so every track the arranger made is cut along the
  // same lines as the one it was made from.
  const ir = options.splitSections ? splitBySection(arranged) : arranged;
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
    splitSections: Boolean(options.splitSections) && (ir.sections || []).length > 1,
    noteCount: guitarNotes.length,
    staves: ir.info ? ir.info.staves : 0,
    chords: ir.info ? ir.info.chords : 0,
    tempo: ir.tempo,
    timeSignature: ir.timeSignature,
  };
  return { ir, bytes, filename, summary };
}
