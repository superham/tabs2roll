// Filename for the saved MIDI file: "Artist - Song (tab).mid".
// Pure ES module: no imports.

export const FALLBACK_FILENAME = "guitar-tab";
export const MAX_STEM_LENGTH = 120;

/** Windows reserved device names cannot be used as a filename stem. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Make a string safe as a filename on Windows, macOS and Linux:
 * strips path separators and characters Windows forbids, control characters,
 * leading/trailing dots and spaces, and collapses whitespace.
 */
export function sanitizeFilePart(text) {
  let s = String(text || "");
  s = s.replace(/[\\/:*?"<>|]/g, " ");
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, "");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^[. ]+/, ""); // no hidden files; a trailing dot is fine before " (tab).mid"
  if (RESERVED.test(s)) s = s + "_";
  return s;
}

/**
 * Build the file name from the IR's artist and title.
 *   { artist: "Trad.", title: "Greensleeves" } -> "Trad. - Greensleeves (tab).mid"
 *   { title: "Greensleeves" }                  -> "Greensleeves (tab).mid"
 *   nothing usable                             -> "guitar-tab.mid"
 * `suffix` is added inside the parentheses, e.g. "Drop D" -> "(tab, Drop D)".
 */
export function buildFilename({ artist, title } = {}, suffix = "") {
  const a = sanitizeFilePart(artist);
  const t = sanitizeFilePart(title);
  let stem = a && t ? `${a} - ${t}` : t || a;
  if (stem.length > MAX_STEM_LENGTH) stem = stem.slice(0, MAX_STEM_LENGTH).trim();
  const tag = suffix ? `(tab, ${sanitizeFilePart(suffix)})` : "(tab)";
  if (!stem) return `${FALLBACK_FILENAME}.mid`;
  return `${stem} ${tag}.mid`;
}
