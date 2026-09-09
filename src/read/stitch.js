// Reading a score that does not fit on the screen.
//
// A tab player draws the bars that are on screen and no more, so one look at
// one is one screenful of a four-minute song. Reading the whole thing means
// looking, scrolling, looking again — and then joining what came back without
// reading the same bars twice or losing the ones that fell across the fold.
//
// This file is the arithmetic of that, kept well away from the browser so it
// can be tested: which staves in a picture are certainly whole, how far to
// scroll so the next look starts just past them, and how the screenfuls join.
// The scrolling itself is in the popup, which is the only place allowed to
// touch the page.
//
// Pure ES module: no DOM, no browser APIs.

import { toAsciiTab } from "./ascii.js";
import { confidenceOf } from "./score.js";

/**
 * A staff whose last line sits nearer than this to the bottom edge, measured
 * in its own line spacing, may have more lines below the fold.
 *
 * One spacing exactly, and the number is not a guess. A staff's lines are
 * evenly spaced, so if there is a whole spacing of picture below the last
 * line found and no line in it, the staff really did end there. If there is
 * not, the next line could be sitting just off the bottom of the screen and
 * there is no way to tell from this picture alone.
 */
export const EDGE_MARGIN = 1;

/**
 * The staves in a picture that are certainly whole.
 *
 * Only the bottom edge is trimmed, and the asymmetry is the whole point. A
 * staff running off the bottom of the screen is the dangerous case: six lines
 * cut down to four still group as a staff — a bass, to look at it — and would
 * come back as music nobody played, on strings the guitar does not have.
 * Dropping it costs nothing, because the next look down the page shows it in
 * full.
 *
 * The top edge is left alone on purpose. The scroll is worked out so the next
 * look begins just below the last whole staff, which puts the staff after it
 * hard against the top of the picture. Trimming there would throw away the
 * very bars the scroll was made to reach, every time, all the way down.
 */
export function wholeSystems(systems, height) {
  const list = Array.isArray(systems) ? systems : [];
  if (!height) return list.slice();
  return list.filter((system) => {
    const margin = (system.spacing || 0) * EDGE_MARGIN;
    return system.bottom + margin <= height;
  });
}

/**
 * How far down the picture this reading can be trusted, in picture pixels.
 *
 * That is the bottom of the last whole staff plus enough clearance to leave
 * its own lines behind. Null when nothing in the picture was whole, which is
 * the caller's cue to scroll by a plain screenful instead and hope for better.
 */
export function readTo(systems, height) {
  const whole = wholeSystems(systems, height);
  if (!whole.length) return null;
  const last = whole[whole.length - 1];
  // Never past the bottom of the picture: a staff is only kept when this much
  // clear picture was found below it, which is the same sum.
  return last.bottom + (last.spacing || 0) * EDGE_MARGIN;
}

/**
 * One screenful, cut down to the staves that were certainly whole.
 *
 * Returns a reading of the same shape src/read/ hands back, so the popup can
 * treat a trimmed screenful and a whole picture alike. Null when there was
 * nothing whole in it to keep.
 *
 * Every count in it — notes, bars, marks given up on, and how sure the reader
 * is — is worked out again from the staves that were kept. Carrying the whole
 * picture's confidence across would be the reader saying how well it read
 * something it then threw away: a screenful whose only bad staff was the one
 * running off the bottom would come back looking far worse than the tab under
 * it, and one whose good staff was the cut one, far better.
 */
export function wholeReading(reading, options = {}) {
  if (!reading || !reading.ok || !Array.isArray(reading.systems)) return null;
  const whole = wholeSystems(reading.systems, reading.height);
  const tabs = whole.filter((system) => system.kind === "tab");
  if (!tabs.length) return null;
  const text = toAsciiTab(whole, options);
  if (!text.trim()) return null;
  const notes = tabs.reduce((n, s) => n + s.events.length, 0);
  const unreadable = tabs.reduce((n, s) => n + s.unreadable, 0);
  return {
    ok: true,
    text,
    reason: null,
    staves: tabs.length,
    strings: tabs[0].strings,
    notes,
    bars: tabs.reduce((n, s) => n + s.bars.length, 0),
    unreadable,
    confidence: confidenceOf(tabs, unreadable, notes),
    systems: whole,
    scroll: reading.scroll || null,
  };
}

/**
 * Every screenful, joined into one reading.
 *
 * A screenful that read as nothing is dropped, and so is one that came back
 * word for word the same as the one before it: that is a page that did not
 * move under us, not a song that repeats itself. A real repeat is engraved
 * again further down and arrives with different bars either side of it.
 *
 * The counts are summed over what was kept rather than over what was read, so
 * "412 notes" is a count of the notes in the tab underneath it and not of the
 * work it took to get them. Confidence is the mean weighted by notes: a
 * screenful holding two notes read badly should not drag down forty read well.
 */
export function stitchReads(reads) {
  const kept = [];
  for (const read of reads || []) {
    if (!read || !read.ok) continue;
    const text = String(read.text || "").trim();
    if (!text) continue;
    if (kept.length && kept[kept.length - 1].text === text) continue;
    kept.push({ ...read, text });
  }
  if (!kept.length) return { ok: false, text: "", reason: "no-notes", staves: 0, strings: 0, notes: 0, bars: 0, unreadable: 0, confidence: 0, screenfuls: 0, scroll: null };
  const notes = kept.reduce((n, r) => n + (r.notes || 0), 0);
  const weighted = kept.reduce((n, r) => n + (r.confidence || 0) * (r.notes || 0), 0);
  return {
    ok: true,
    text: kept.map((r) => r.text).join("\n\n"),
    reason: null,
    staves: kept.reduce((n, r) => n + (r.staves || 0), 0),
    strings: kept[0].strings || 0,
    notes,
    bars: kept.reduce((n, r) => n + (r.bars || 0), 0),
    unreadable: kept.reduce((n, r) => n + (r.unreadable || 0), 0),
    confidence: notes ? weighted / notes : 0,
    screenfuls: kept.length,
    // The whole song was read, so there is no longer a share of it to report.
    scroll: null,
  };
}
