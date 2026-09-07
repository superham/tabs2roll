// Header metadata: title, artist, tempo, capo, tuning, time signature.
// Works on the non-tab lines of a text. Pure string work.

import { parseTuningText } from "./tuning.js";

const TEMPO_MIN = 40;
const TEMPO_MAX = 300;

function inRange(n, lo, hi) {
  return Number.isFinite(n) && n >= lo && n <= hi;
}

/** "Tempo: 120", "120 BPM", "bpm = 96", "♩ = 88", "Tempo = 110 bpm". */
export function findTempo(lines) {
  const patterns = [
    /\btempo\s*[:=\-]?\s*(?:♩|q)?\s*=?\s*(\d{2,3})\b/i,
    /\b(\d{2,3})\s*bpm\b/i,
    /\bbpm\s*[:=\-]?\s*(\d{2,3})\b/i,
    /♩\s*=\s*(\d{2,3})\b/,
  ];
  for (const line of lines) {
    for (const re of patterns) {
      const m = re.exec(line);
      if (m) {
        const n = parseInt(m[1], 10);
        if (inRange(n, TEMPO_MIN, TEMPO_MAX)) return n;
      }
    }
  }
  return null;
}

/** "Capo: 2", "Capo 3rd fret", "capo on 5", "Capo: none" -> 0. */
export function findCapo(lines) {
  for (const line of lines) {
    if (/\bcapo\b/i.test(line)) {
      if (/\bcapo\s*[:=\-]?\s*(?:no|none|off|without|-|0)\b/i.test(line)) return 0;
      // "Capo: 2", "Capo on the 3rd fret", "Capo: Fret 1" (GuitarTuna).
      const m = /\bcapo\s*[:=\-]?\s*(?:on\s*|at\s*)?(?:the\s*)?(?:fret\s*)?(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(line);
      if (m) {
        const n = parseInt(m[1], 10);
        if (inRange(n, 0, 12)) return n;
      }
      const m2 = /(\d{1,2})(?:st|nd|rd|th)?\s*fret\s*capo/i.exec(line);
      if (m2) {
        const n = parseInt(m2[1], 10);
        if (inRange(n, 0, 12)) return n;
      }
    }
  }
  return 0;
}

/**
 * Look for a tuning in the header. An explicit "Tuning: ..." line wins;
 * otherwise any line that mentions a known tuning phrase ("Drop D",
 * "half step down") counts.
 */
export function findTuningHeader(lines) {
  for (const line of lines) {
    const m = /\btun(?:ing|ed)\s*[:=\-]?\s*(.+)$/i.exec(line);
    if (m) {
      const parsed = parseTuningText(m[1]);
      if (parsed) return parsed;
    }
  }
  for (const line of lines) {
    // Only trust bare mentions when the line is short — a header line, not a lyric.
    if (line.trim().length > 60) continue;
    const parsed = parseTuningText(line);
    if (!parsed) continue;
    // "Standard" is the default anyway; only trust a bare mention of it when
    // the line is actually about tuning.
    if (parsed.id === "standard" && !/tun/i.test(line)) continue;
    return parsed;
  }
  return null;
}

/** "Time: 3/4", "3/4 time", "Time signature: 6/8". Returns [num, den] or null. */
export function findTimeSignature(lines) {
  for (const line of lines) {
    let m = /\btime\s*(?:sig(?:nature)?)?\s*[:=\-]?\s*(\d{1,2})\s*\/\s*(\d{1,2})\b/i.exec(line);
    if (!m) m = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*time\b/i.exec(line);
    if (m) {
      const num = parseInt(m[1], 10);
      const den = parseInt(m[2], 10);
      if (inRange(num, 1, 32) && [1, 2, 4, 8, 16].includes(den)) return [num, den];
    }
  }
  return null;
}

/**
 * Title and artist from the text itself. This is only a fallback for pasted
 * tabs — the page extractor normally knows both. Recognises:
 *   Title: X / Song: X / Artist: X / Band: X / by X
 *   a first non-empty line "X - Y" (kept whole as the title)
 * Returns { title, artist } with "" for unknowns.
 */
export function findTitleAndArtist(lines) {
  let title = "";
  let artist = "";
  const head = lines.slice(0, 40);

  // "Covet Chords by Basement", "Perfect chords by Ed Sheeran",
  // "GREENSLEEVES TAB by Traditional". Chord pages put this line near the top
  // and it is far more reliable than guessing from the first short line,
  // which on a real page is a navigation item ("Tabs", "Skip to content").
  for (const line of head) {
    const m = /^(.{1,80}?)\s+(?:easy\s+)?(?:guitar\s+|bass\s+|ukulele\s+)?(?:chords|chord chart|tabs?|tablature)\s+by\s+(.{1,60}?)\s*$/i.exec(line.trim());
    if (m && !/^\s*(?:more|related|other)\b/i.test(m[1])) {
      return { title: cleanupName(m[1]), artist: cleanupName(m[2]) };
    }
  }

  for (const line of head) {
    const t = line.trim();
    let m;
    if (!title && (m = /^(?:song\s*title|title|song|name)\s*[:\-]\s*(.+)$/i.exec(t))) title = m[1].trim();
    else if (!artist && (m = /^(?:artist|band|by|performed by|written by)\s*[:\-]\s*(.+)$/i.exec(t))) artist = m[1].trim();
    else if (!artist && (m = /^by\s+(.+)$/i.exec(t)) && !/\bcapo\b/i.test(t)) artist = m[1].trim();
  }
  if (!title) {
    // Fall back to the first short line that is not tab, a section marker,
    // a chord line, or a header field. That is where tabbers put the title.
    for (const line of head) {
      const t = line.trim().replace(/^[-=*_#\s]+|[-=*_#\s]+$/g, "");
      if (!t || t.length > 60 || !/[A-Za-z]/.test(t)) continue;
      if (/\b(tuning|tuned|capo|tempo|bpm|tabbed|tab by|standard|http|www\.)\b/i.test(t)) continue;
      if (/^(intro|verse|chorus|bridge|outro|solo|riff|pre-?chorus|interlude|instrumental)\b[\s\d:.-]*$/i.test(t)) continue;
      if (/^[-=*_#\s|]+$/.test(t) || /^\[.*\]$/.test(t) || /^[A-Ga-g][#b]?\s*\|/.test(t)) continue;
      if (looksLikeChordLine(t) || looksLikeTabLine(t)) continue;
      title = t;
      break;
    }
  }
  return { title: cleanupName(title), artist: cleanupName(artist) };
}

function looksLikeTabLine(t) {
  return (t.match(/-/g) || []).length >= 3;
}

function looksLikeChordLine(t) {
  const tokens = t.split(/\s+/);
  return tokens.length > 0 && tokens.every((tok) => /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?\d*(\/[A-G](#|b)?)?$/.test(tok));
}

function cleanupName(s) {
  return String(s || "").replace(/\s+/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
}

/** Every piece of header metadata in one call. */
export function findMeta(lines) {
  return {
    tempo: findTempo(lines),
    capo: findCapo(lines),
    tuning: findTuningHeader(lines),
    timeSignature: findTimeSignature(lines),
    ...findTitleAndArtist(lines),
  };
}
