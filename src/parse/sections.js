// Section callouts: the "[Intro]", "Chorus:", "Estribillo" lines that tell
// you which part of the song the staves underneath belong to.
//
// Finding them is what lets one tab come out as several patterns instead of
// one long take. The hard part is that a callout has no agreed spelling. The
// same idea is written
//
//   [Chorus]      Chorus:      CHORUS      -- Chorus --      * Chorus 2 *
//   Estribillo    Refrain      Refrão      Zwrotka 2         前奏
//
// and plenty of tabbers write a word nobody has a keyword list for. So the
// keyword list here is a bonus, never a requirement: what actually carries
// this module is SHAPE and POSITION — a short line, on its own, with music
// starting right underneath it. Those hold in any language and any layout.
//
// Nothing is ever a callout on one weak signal alone. Every candidate is
// scored (the weights below are the whole musical/typographic argument) and
// only lines clearing CALLOUT_THRESHOLD introduce a section. When that leaves
// fewer than two sections there is nothing to split, and buildSections says
// so by returning an empty list.
//
// Pure ES module: no DOM, no browser APIs, no imports outside parse/.

import { isTabShapedLine, isChordOnlyLine, isMetadataLine, isLyricLine, isSectionLine } from "./tabshape.js";

// --------------------------------------------------------------------------
// Tunable weights
// --------------------------------------------------------------------------

/**
 * How much each signal argues for "this line names a part of the song".
 * A line becomes a callout when its total reaches CALLOUT_THRESHOLD.
 *
 * The three 3s are the ways a tabber deliberately marks a line as a heading,
 * and any one of them is enough on its own. Everything else is circumstantial
 * and has to add up.
 */
export const CALLOUT_SCORES = {
  bracketed: 3, // "[Chorus]", "(Intro)", "{Solo}" — wrapped on purpose
  decorated: 3, // "-- Chorus --", "*** Intro ***" — same idea, drawn by hand
  keyword: 3, // a word from SECTION_WORDS, in any of the languages listed
  colon: 2, // "Chorus:" with nothing after the colon
  shouted: 1, // "CHORUS" — letters, no lower case
  titleCased: 1, // "Estribillo" — a heading's capital in a Latin script
  numbered: 1, // "Verse 2", "Parte II" — sections get counted, lyrics do not
  brief: 1, // short enough to be a label rather than a sentence
  stopped: -2, // ends in a full stop, so it is a sentence after all
  aboveMusic: 1, // the next thing in the text is a stave or a chord line
  isolated: 1, // a blank line above it, or the top of the text
  recurring: 1, // the same label heads music more than once in the song
};

/** Total a line needs before it counts as a callout. */
export const CALLOUT_THRESHOLD = 3;

/** A label longer than this is a sentence, not the name of a part. */
export const MAX_LABEL_LENGTH = 48;

/**
 * ...and so is one with more words than this. A hard limit, not a penalty:
 * Ultimate Guitar tabbers bracket the line they are about to play as well as
 * the part they are playing — "[You know i always try to settle ya']" sits
 * between "[Verse]" and its stave — and brackets alone cannot tell the two
 * apart. Length can: a heading is a label, and a label is short.
 */
export const MAX_LABEL_WORDS = 5;

/** "brief" — short enough that the label reads as a heading at a glance. */
export const BRIEF_LABEL_LENGTH = 24;

/** How far below a callout the music may start (blank/decorative lines between). */
export const MUSIC_WITHIN_LINES = 4;

/** What a section is called when the music starts before any callout does. */
export const DEFAULT_SECTION_NAME = "Start";

// --------------------------------------------------------------------------
// Words that name a part of a song
// --------------------------------------------------------------------------

/**
 * Section words in the languages tabs actually get written in. This list is
 * a shortcut, not the mechanism: a callout in a language missing from here
 * still gets found by shape and position, which is the whole point of the
 * scoring above. Add to it freely; nothing depends on it being complete.
 *
 * Matching is on the accent-stripped lower-case stem, so one entry covers
 * "Refrão", "refrao" and "Refrões".
 */
export const SECTION_WORDS = new Set([
  // English
  "intro", "introduction", "verse", "chorus", "prechorus", "refrain", "bridge",
  "outro", "ending", "end", "solo", "interlude", "instrumental", "break",
  "breakdown", "coda", "riff", "lick", "fill", "hook", "tag", "part", "section",
  "theme", "main", "pattern", "vamp", "turnaround", "reprise", "finale",
  // Spanish
  "introduccion", "estrofa", "estribillo", "coro", "puente", "parte", "final",
  // Portuguese
  "introducao", "refrao", "ponte", "solo", "parte",
  // French
  "couplet", "pont", "partie", "fin",
  // German
  "strophe", "kehrreim", "brucke", "uberleitung", "teil", "schluss", "zwischenspiel",
  // Italian
  "strofa", "ritornello", "finale",
  // Dutch
  "refrein", "brug",
  // Polish. "most" (bridge) is deliberately left out: it collides with the
  // English word, and a lyric is far more likely to say "most" than a Polish
  // tab is to head a section with it.
  "zwrotka", "refren", "zakonczenie",
  // Nordic
  "vers", "refrang", "omkved", "brygga",
  // Indonesian / Malay
  "bait", "reff", "reffrain", "lagu",
  // Russian / Ukrainian (Cyrillic keeps its accents; no stripping needed)
  "куплет", "припев", "вступление", "проигрыш", "кода", "бридж", "соло",
  "приспів", "вступ",
  // CJK
  "前奏", "间奏", "尾奏", "主歌", "副歌", "间奏部分",
]);

/**
 * Lines that sit above a stave and look like a heading but are playing
 * instructions. Left alone they would each start a spurious section.
 */
export const NOT_A_CALLOUT_RE =
  /^(?:x\s*\d+|\d+\s*x|\d+\s*(?:times?|beats?|bars?)|repeat(?:\s*(?:\d+\s*x?|x\s*\d+))?|let\s+ring|ring\s+out|p\.?\s*m\.?|palm\s+mut(?:e|ing)|n\.?\s*c\.?|simile|tacet|ad\s+lib\.?|slowly|fast|slow|w\/\s*\w+)$/i;

/**
 * Sentence-final punctuation. A heading is a label, not a statement, so a
 * label that ends this way is one word of a lyric ("Everything.") far more
 * often than it is the name of a part.
 */
export const SENTENCE_END_RE = /[.!?…。！？]$/;

/** A repeat count written after the label: "[Verse] x4", "Chorus 4x". */
export const REPEAT_TAIL_RE = /\s*(?:[x×]\s*(\d+)|(\d+)\s*[x×])\s*$/i;

// --------------------------------------------------------------------------
// Reading one line
// --------------------------------------------------------------------------

const WRAPPERS = { "[": "]", "(": ")", "{": "}", "<": ">", "«": "»", "【": "】", "（": "）" };
/**
 * Characters tabbers draw a rule out of. A full stop is deliberately not one
 * of them: "Is on your outside." is a sentence, and reading its full stop as
 * decoration turned every lyric in a chord sheet into a section of its own.
 */
const DECOR_CHARS = "-=~*#_+|\\/•·–—";
const DECOR_HEAD = new RegExp("^[" + DECOR_CHARS + "]+\\s*");
const DECOR_TAIL = new RegExp("\\s*[" + DECOR_CHARS + "]+$");

/**
 * ...and one stray dash is not a rule either. A hand-drawn heading is either
 * fenced on both sides ("-- Chorus --") or led by a run you cannot miss
 * ("*** Chorus"), so that is what counts.
 */
export const MIN_ONE_SIDED_RULE = 3;

/**
 * Peel the decoration off a candidate heading and say what was peeled.
 * "*** [Verse 2] *** x4" -> { label: "Verse 2", bracketed: true, ... }
 *
 * Returns { label, bracketed, decorated, colon, repeat }.
 */
export function stripDecoration(line) {
  let s = String(line || "").trim();
  let bracketed = false;
  let decorated = false;
  let colon = false;
  let repeat = 0;

  const tail = REPEAT_TAIL_RE.exec(s);
  if (tail) {
    repeat = parseInt(tail[1] || tail[2], 10);
    s = s.slice(0, tail.index).trim();
  }

  // Peel wrappers and rules alternately: tabbers nest them ("-- [Solo] --").
  for (let pass = 0; pass < 4 && s; pass++) {
    const close = WRAPPERS[s[0]];
    if (close && s.length > 2 && s.endsWith(close) && s.indexOf(close) === s.length - 1) {
      s = s.slice(1, -1).trim();
      bracketed = true;
      continue;
    }
    // A bracket that closes early is a heading with a note after it:
    // "[Verse 2] (Rythm)", "[Verse] THIS GRADUALLY SLOWS DOWN". Keep the note
    // when it still reads as part of the name, drop it when it is a sentence.
    const at = close ? s.indexOf(close) : -1;
    if (at > 1) {
      const inside = s.slice(1, at).trim();
      const after = s.slice(at + 1).trim();
      const together = after ? inside + " " + after : inside;
      s = together.length <= MAX_LABEL_LENGTH && wordCount(together) <= MAX_LABEL_WORDS ? together : inside;
      bracketed = true;
      continue;
    }
    const head = DECOR_HEAD.exec(s);
    const tail = DECOR_TAIL.exec(s);
    if (!head && !tail) break;
    const peeled = s.replace(DECOR_HEAD, "").replace(DECOR_TAIL, "").trim();
    if (!peeled) break;
    // Both sides fenced, or one side led by a run long enough to be a rule.
    const bothSides = Boolean(head && tail);
    const longRun = Math.max(head ? head[0].trim().length : 0, tail ? tail[0].trim().length : 0) >= MIN_ONE_SIDED_RULE;
    if (bothSides || longRun) decorated = true;
    s = peeled;
  }

  if (s.endsWith(":") || s.endsWith("：")) {
    s = s.slice(0, -1).trim();
    colon = true;
  }
  return { label: s, bracketed, decorated, colon, repeat };
}

/** Lower case, accents removed, so one keyword covers "Refrão" and "refrao". */
function fold(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** True when any word of the label names a part of a song. */
export function hasSectionWord(label) {
  const folded = fold(label);
  if (SECTION_WORDS.has(folded.replace(/[\s'-]/g, ""))) return true;
  for (const token of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (!token) continue;
    if (SECTION_WORDS.has(token)) return true;
    // "choruses", "versos", "strophen": a keyword the label grew a tail on.
    for (const word of SECTION_WORDS) {
      if (word.length >= 4 && token.startsWith(word)) return true;
    }
  }
  return false;
}

/**
 * Words that may stand beside a section word without weakening the heading:
 * who plays it, and which one it is. "Guitar solo" and "Riff 2" are headings;
 * "The end" is a sentence that happens to contain one.
 */
export const HEADING_FILLER = new Set([
  "guitar", "guitars", "bass", "drum", "drums", "piano", "keys", "keyboard",
  "vocal", "vocals", "harmonica", "banjo", "violin", "acoustic", "electric",
  "rhythm", "clean", "distorted", "slow", "half", "double", "first", "second",
  "third", "final", "gtr", "gtr1", "gtr2",
]);

/**
 * True when the label is made of nothing but section words, the fillers
 * above, and numbers — "Chorus", "Guitar solo", "Riff 2", "Verse III".
 * This is what lets an unmarked heading through even though it reads, to
 * isLyricLine, like words someone sings.
 */
export function isHeadingPhrase(label) {
  const tokens = fold(label).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!tokens.length || tokens.length > 3) return false;
  let sectionWords = 0;
  for (const token of tokens) {
    if (/^\d+$/.test(token) || /^[ivx]{1,4}$/.test(token) || HEADING_FILLER.has(token)) continue;
    if (SECTION_WORDS.has(token)) {
      sectionWords++;
      continue;
    }
    return false;
  }
  return sectionWords > 0;
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function letterCount(text) {
  return (text.match(/\p{L}/gu) || []).length;
}

/**
 * Could this line be a heading at all? Anything that is plainly music,
 * plainly a header field, or plainly a playing instruction is out before
 * scoring begins, so those can never be talked into a section by position.
 *
 * Returns the stripDecoration result, or null.
 */
export function calloutCandidate(line) {
  const text = String(line || "").trim();
  if (!text) return null;
  if (isTabShapedLine(text)) return null;
  if (isChordOnlyLine(text)) return null;
  // "Tuning: Drop D" is a field, but "Chorus:" is a heading, and both match
  // the metadata rule — so a bracketed or keyword line is let through.
  if (isMetadataLine(text) && !isSectionLine(text)) return null;
  const parsed = stripDecoration(text);
  const { label } = parsed;
  if (!label || label.length > MAX_LABEL_LENGTH) return null;
  if (wordCount(label) > MAX_LABEL_WORDS) return null;
  if (letterCount(label) < 2) return null;
  if (NOT_A_CALLOUT_RE.test(label)) return null;
  return parsed;
}

// --------------------------------------------------------------------------
// Scoring
// --------------------------------------------------------------------------

/**
 * Score one candidate line. `context` says what is around it:
 *   isolated   nothing but blank lines above it
 *   aboveMusic the next non-blank line, within MUSIC_WITHIN_LINES, is music
 *   recurring  the same label heads music somewhere else in the song too
 */
export function scoreCallout(parsed, line, context = {}) {
  const { label, bracketed, decorated, colon } = parsed;
  const S = CALLOUT_SCORES;
  // A line that reads like something someone sings is not a heading, however
  // well the rest of the signals line up: in a chord sheet EVERY lyric line is
  // short, capitalised and sitting right on top of music, so shape and
  // position say nothing there. Only an explicit mark — brackets, a rule, a
  // colon — or a label made of nothing but the name of a part gets one in.
  if (isLyricLine(line) && !bracketed && !decorated && !colon && !isHeadingPhrase(label)) return 0;
  let score = 0;
  if (bracketed) score += S.bracketed;
  if (decorated) score += S.decorated;
  if (hasSectionWord(label)) score += S.keyword;
  if (colon) score += S.colon;
  if (/\p{L}/u.test(label) && label === label.toUpperCase() && label !== label.toLowerCase()) score += S.shouted;
  else if (/^\p{Lu}/u.test(label)) score += S.titleCased;
  if (/(?:\d+|\b[IVX]{1,4})\s*$/.test(label)) score += S.numbered;
  if (label.length <= BRIEF_LABEL_LENGTH) score += S.brief;
  if (SENTENCE_END_RE.test(label)) score += S.stopped;
  if (context.aboveMusic) score += S.aboveMusic;
  if (context.isolated) score += S.isolated;
  if (context.recurring) score += S.recurring;
  return score;
}

// --------------------------------------------------------------------------
// Finding them in a text
// --------------------------------------------------------------------------

/**
 * Find the callout lines of a text.
 *
 * `musicLines` is the set of line indices that turned into notes — staves for
 * a tab, chord lines for a chord sheet. A heading is only a heading when
 * there is music under it, which is what keeps a page's navigation, its
 * credits and the song title itself from becoming sections.
 *
 * Returns [{ line, label, repeat, score }] in line order.
 */
export function findCallouts(lines, musicLines) {
  const music = musicLines instanceof Set ? musicLines : new Set(musicLines || []);
  const blank = lines.map((l) => !String(l || "").trim());

  // Only blank lines and other unmistakable headings may sit between a
  // heading and its music. Tabbers do stack them ("[Verse]" then "w/ capo"),
  // but a line of prose in the gap means the heading was talking about
  // something else, so anything unmarked breaks the link.
  const stackable = (line) => {
    const parsed = calloutCandidate(line);
    return Boolean(parsed && (parsed.bracketed || parsed.decorated || parsed.colon));
  };
  const nextIsMusic = (i) => {
    for (let j = i + 1; j < lines.length && j <= i + MUSIC_WITHIN_LINES; j++) {
      if (music.has(j)) return true;
      if (blank[j]) continue;
      if (!stackable(lines[j])) return false;
    }
    return false;
  };

  // First pass: every line that could be a heading, so "recurring" can be
  // worked out before anything is decided.
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    if (music.has(i)) continue;
    const parsed = calloutCandidate(lines[i]);
    if (!parsed) continue;
    candidates.push({ line: i, parsed, aboveMusic: nextIsMusic(i), isolated: i === 0 || blank[i - 1] });
  }
  const seen = new Map();
  for (const c of candidates) {
    if (!c.aboveMusic) continue;
    const key = fold(c.parsed.label);
    seen.set(key, (seen.get(key) || 0) + 1);
  }

  // A heading names what comes after it, so one with no music left below it
  // heads nothing: it is the page talking ("Comments", "Related tabs").
  const lastMusic = Math.max(-1, ...music);

  const out = [];
  for (const c of candidates) {
    if (c.line >= lastMusic) continue;
    const recurring = (seen.get(fold(c.parsed.label)) || 0) > 1;
    const score = scoreCallout(c.parsed, lines[c.line], { ...c, recurring });
    if (score < CALLOUT_THRESHOLD) continue;
    out.push({ line: c.line, label: c.parsed.label, repeat: c.parsed.repeat, score });
  }
  return out;
}

// --------------------------------------------------------------------------
// Sections
// --------------------------------------------------------------------------

/**
 * Turn callouts plus placed music into sections.
 *
 * `placements` is where each piece of music came from and when it plays:
 *   [{ firstLine, lastLine, start, length }]   (a stave, or one chord's bar)
 *
 * Every placement belongs to the nearest callout above it. Music that starts
 * before the first callout becomes DEFAULT_SECTION_NAME. Repeated labels are
 * numbered ("Chorus", "Chorus 2") so every section has a name of its own —
 * a DAW shows track and marker names, and two called the same are no use.
 *
 * Returns [{ name, label, line, start, end, repeat }], in playing order, or
 * an empty list when the song has fewer than two parts to tell apart.
 * `repeat` is what the callout said ("[Verse] x4"), recorded for whoever
 * wants it; nothing downstream plays a part more than once.
 */
export function buildSections(lines, placements) {
  const places = (placements || []).filter((p) => p && Number.isFinite(p.start)).slice().sort((a, b) => a.start - b.start);
  if (!places.length) return [];

  const musicLines = new Set();
  for (const p of places) {
    const from = Number.isFinite(p.firstLine) ? p.firstLine : 0;
    const to = Number.isFinite(p.lastLine) ? p.lastLine : from;
    for (let i = from; i <= to; i++) musicLines.add(i);
  }

  const callouts = findCallouts(lines, musicLines);
  if (!callouts.length) return [];

  const groups = [];
  for (const place of places) {
    const at = Number.isFinite(place.firstLine) ? place.firstLine : -1;
    let owner = null;
    for (const callout of callouts) {
      if (callout.line < at) owner = callout;
      else break;
    }
    const last = groups[groups.length - 1];
    if (last && last.owner === owner) {
      last.start = Math.min(last.start, place.start);
      last.end = Math.max(last.end, place.start + (place.length || 0));
    } else {
      groups.push({ owner, start: place.start, end: place.start + (place.length || 0) });
    }
  }
  if (groups.length < 2) return [];

  const used = new Map();
  return groups.map((g) => {
    const label = g.owner ? g.owner.label : DEFAULT_SECTION_NAME;
    const seen = (used.get(label) || 0) + 1;
    used.set(label, seen);
    return {
      name: seen > 1 ? `${label} ${seen}` : label,
      label,
      line: g.owner ? g.owner.line : -1,
      start: round3(g.start),
      end: round3(g.end),
      repeat: g.owner ? g.owner.repeat : 0,
    };
  });
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}
