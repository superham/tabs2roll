// Text clean-up shared by the detector and both parsers.
// Pure string work; no DOM, no browser APIs.

/**
 * Normalise a blob of tab text so the parsers only ever see plain ASCII-ish
 * lines:
 *  - any line ending becomes "\n"
 *  - Ultimate Guitar markup ([tab], [/tab], [ch]Am[/ch]) is removed
 *  - non-breaking spaces and zero-width characters become plain spaces / nothing
 *  - unicode dashes that tabbers sometimes paste in become "-"
 *  - literal TAB characters become 4 spaces so columns keep lining up
 */
export function cleanText(input) {
  if (input === null || input === undefined) return "";
  let text = String(input);
  text = text.replace(/\r\n|\r/g, "\n");
  text = text.replace(/\[\/?tab\]/gi, "");
  text = text.replace(/\[\/?ch\]/gi, "");
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, "");
  text = text.replace(/\u00A0/g, " ");
  text = text.replace(/[\u2010-\u2015\u2212]/g, "-");
  text = text.replace(/\t/g, "    ");
  return text;
}

export function splitLines(text) {
  return cleanText(text).split("\n");
}
