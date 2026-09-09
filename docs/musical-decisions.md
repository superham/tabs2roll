# Musical decisions

Plain-text tab tells you *which* notes to play and, roughly, in *what order*. It does not
tell you how long anything lasts. Everything below is a guess tab2roll makes so that the
MIDI file sounds sensible on the first drag into a DAW. Each one is a named constant or
a short function so it can be changed without understanding the rest of the code.

The reference pitches are fixed and not up for tuning: standard guitar is
E2 A2 D3 G3 B3 E4 = MIDI `40 45 50 55 59 64`, and `midi = openString + fret`.
Middle C is MIDI 60. (FL Studio *displays* it as C5. Nothing corrects for that.)

## Timing (`src/parse/tab.js`)

| What | Where | Current value | Why |
|---|---|---|---|
| Timing step | `STEP_BEATS`, `DEFAULT_STEP` | one gap = an eighth note (`"1/8"`) | Most web tabs space notes as eighths. The user can pick `1/4` or `1/16` in Settings. |
| How many columns make one step | `estimateUnit()` | the most common gap between neighbouring note columns in the whole tab; `DEFAULT_UNIT = 3` when there is nothing to measure | Tabbers are consistent within a tab (`--5--7--` = 3 columns per note). Measuring it beats assuming it. |
| Gap rounding | `stepsForGap()`, `HALF_STEP_BELOW_UNITS = 0.6` | a gap is rounded to whole steps; a gap shorter than 0.6 of a unit becomes half a step | Keeps evenly spaced notes on the grid even when spacing wobbles by a column. A squeezed pair like `5h7` in a 3-column tab still reads as two even eighths; in a 4-column tab it reads as a quick sixteenth into a longer note. |
| Leading padding | `layoutStave()` | padding before the first note in a bar shorter than one unit is ignored; longer padding becomes a rest of that many steps | `|--3--` means "on the downbeat"; `|------3--` means "after a rest". |
| Bar lines | `layoutStave()` | bar lines shared by at least half the lines split the stave; each bar is snapped to the nearest whole number of bars (minimum one); a note that would fall past the end pushes the bar out rather than being squeezed | The DAW grid and the tab's bars should agree. A stave with no bar lines is one long segment, rounded to whole bars at the end. |
| Note length | `MAX_SUSTAIN_BARS = 1`, `assignLengths()` | a note lasts until the next note on the same string, capped at one bar; mutes last one grid step | A plucked string rings until it is played again. The cap stops a string played once from droning through the whole song. |
| Collisions | `assignLengths()` | two notes on the same string that land on the same beat are nudged one grid step apart | Mostly happens with hammer-on runs after rounding. |

## Dynamics (`src/parse/tab.js`)

| Note | Constant | Value |
|---|---|---|
| picked note | `VELOCITY_NORMAL` | 0.8 |
| hammer-on, pull-off, bend target, release | `VELOCITY_LEGATO` | 0.65 |
| ghost note `(5)` | `VELOCITY_GHOST` | 0.5 |
| muted `x` | `VELOCITY_MUTE` | 0.3 |

Velocities are 0..1 in the IR and become 1..127 in `src/midi/encode.js`.

## Techniques (`scanLine()` in `src/parse/tab.js`)

Every technique becomes a plain note with a `technique` label and no pitch change
(no pitch bend is attempted):

- `5h7` hammer-on, `7p5` pull-off: both notes kept, second is softer.
- `5/7`, `7\5`, `5s7` slide: both notes kept.
- `7b9` bend: the 7 is labelled `bend`, the 9 `bend-target`; `r7` release adds the 7 again.
- `~` or `v` vibrato: labels the note before it.
- `(5)` ghost note, `<12>` / `[12]` harmonic: kept, labelled, quieter for ghosts.
- `x` mute: a short quiet note at the open-string pitch, so strumming patterns keep their
  rhythm. Only counts when it sits next to a dash or digit; `x2` after a bar line is a
  repeat marker and is skipped.
- `t` tap: labelled.

Two-digit frets: a run of digits is read two at a time when it starts with 1 or 2 and
stays within `MAX_FRET = 24`; the first digit's column is the note's position.

## Tuning (`src/parse/tuning.js`)

Order of trust: the user's "Wrong tuning? Re-do as:" choice, then a tuning named in the
tab header (`Tuning: Drop D`, `half step down`, `E A D G B E`), then the note-name labels
at the start of each line, then a default by string count (6 = guitar, 4 = bass,
5 = five-string bass, 7 and 8 = extended-range guitar).

Labels also decide which way up the stave is: `e B G D A E` is the normal high-string-on-top
layout; `E A D G B e` is read as low string on top. When labels are not a known tuning,
each string is given the pitch with that name nearest to standard tuning
(`nearestNotesToReference()`), which is how `D A D G A D` becomes `38 45 50 55 57 62`.

A capo raises every string by its fret number so the file sounds at real pitch.

## Finding the song on a page (`src/parse/region.js`)

Before anything is parsed, a whole web page is cut down to the song. This is not a
musical decision so much as a survival one: read as plain text, the chord-diagram
legend at the top of a page (`E / C#m / G#m / B / A`, one chord per line) and the A-Z
artist index at the bottom (`A / B / C / D / E / F / G`) are perfect chord lines, and
they used to become eighteen bars of nonsense wrapped around a real song.

Every line is classified (`tab`, `section`, `chord`, `lyric`, `metadata`, `other`) and
scored, and the highest-scoring contiguous stretch wins. The rule that does the real
work: **a run of chord lines counts as music only when words, a section marker or a
stave sit immediately before or after it.** A legend and an index have neither, and a
run longer than `MAX_CHORD_RUN` (8) with no words inside it is a list, not a song.

Two safety rails: nothing is cut when the best stretch scores zero or less, and nothing
is cut when it would drop more than half the song's chord and tab lines.

| What | Constant | Value |
|---|---|---|
| a stave line | `SCORES.tab` | +4 |
| a section marker | `SCORES.section` | +4 |
| a chord line beside words | `SCORES.chordSupported` | +3 |
| a chord line with no words near it | `SCORES.chordAlone` | -3 |
| words beside chords | `SCORES.lyricNearChords` | +2 |
| prose with no chords near it | `SCORES.lyricAlone` | -1 |
| `Tuning: ...`, `© 2026`, a URL | `SCORES.metadata` | -1 |
| navigation, counts, stray words | `SCORES.other` | -2 |

Song metadata is still read from the **whole** page, because `Tuning: Drop D`,
`Capo: Fret 1`, `BPM: 95` and `Covet Chords by Basement` all live outside the song.

## Chord sheets (`src/parse/chords.js`)

- One chord symbol = one bar (three beats in 3/4, four in 4/4), in reading order.
- The "as strummed" guitar voicing puts the root between G2 and F#3, stacks the chord
  tones above it and doubles the root an octave up (`voiceChord()`). A slash chord adds
  its bass note underneath.
- Recognised: major, minor, dim, aug, sus2/sus4, 6, 7, maj7, m7, dim7, 9 (as a 7th plus
  the 9th), add9, add11, power chords (`A5`), slash bass.
- **A capo raises every note by its fret number**, exactly as it does for tab. A chord
  sheet names the *shape* the player holds, not the pitch that comes out: with a capo on
  fret 1, a written G sounds as Ab. GuitarTuna's "Perfect" page states both
  "Capo: Fret 1" and "Key: Ab major", which is the same thing said twice.
- Chord sheets come in two layouts, and only one of them carries rhythm:

  **Aligned** (Ultimate Guitar) puts the chords above the words, so the column spacing
  says something about how long each chord lasts:

  ```
          E    C#m   G#m
  When I'm with you,
  ```

  **Stacked** (GuitarTuna and most newer pages) gives every chord its own line, so the
  alignment is gone entirely and only the order survives:

  ```
  G
  Em
  I found a love for me
  ```

  Today both get one bar per chord, which is right for the stacked layout and only
  approximately right for the aligned one. Using column positions to proportion the bar
  in the aligned case is the obvious next improvement; the layouts are told apart by
  whether any line holds two or more chords.

## Reading sheet music (`src/read/`)

A tab drawn as a picture — an "Official" or "Pro" page, a screenshot of a player, a photo
of a songbook — is turned into ASCII tab and then handed to the parser above. Everything
here is measured in **staff spacings**, never in pixels, so one set of rules covers a phone
screenshot and a print-resolution scan.

| What | Constant | Value | Why |
|---|---|---|---|
| Staff line | `MIN_RUN_SHARE`, `MIN_COVERAGE` | a run at least a quarter as long as the longest in the picture, of which at least 45% is ink | Bridging the holes rubbed out behind fret numbers is what makes a tab line readable at all; the coverage test is what stops the bridging believing in a "line" through the middles of eight numbers, which sits at exactly a staff's spacing because the numbers sit on the strings. |
| ...same length as its neighbours | `RUN_RATIO` | 0.55x to 1.6x the staff's own lines | The lines of a staff are always drawn to the same length as each other. Nothing else on the page is. Two slurs arching over one bar sit at the same height and read as one more line above the staff — and a six-string staff that comes back with seven puts every note on the wrong string, without a word. |
| Line thickness | `MAX_LINE_THICKNESS` | at most 6px, or 2% of the picture | A staff line is a hairline. A navigation bar read as one puts a phantom string through the staff. |
| Staff size | 4-8 lines, even spacing | 6 = guitar, 4 = bass, 7 = extended range | Five is the ambiguous one: a notation stave, or a five-string bass. There the numbers decide. |
| Fret number | `MIN_GLYPH_HEIGHT` 0.34, `MAX_GLYPH_HEIGHT` 1.45 spacings | | Rules out staccato dots and slur tips below, time signatures and brackets above. |
| ...and not furniture | `MAX_SIZE_ABOVE_TYPICAL` 1.35 x the staff's own fret numbers | the size is taken from the marks that **read as numbers**, and only after reading them | Guitar Pro writes "TAB" down the front of the staff in letters about half again as tall as a fret number: close enough that no classifier tells that B from an 8, and far enough that this does. Reading before measuring is what makes it hold — a bar of muted strums is mostly dead notes, which are drawn smaller on purpose, and measuring every mark together would make the two real numbers among them look oversized and throw them away. |
| ...and not a slur | `MAX_GLYPH_WIDTH` 2 x its own height | | The arc joining two hammered notes is drawn a whisker above the string, near enough to read as sitting on it, and is five or ten times as wide as it is tall. |
| Held notes | `BRACKET_JOIN` 0.9 of a digit height | `(7)` becomes a ghost note | A note tied over from the bar before is written in brackets. Unrecognised, each bracket reads as some narrow mark of its own — most often a 1 — so a held 7 came back as three notes, or as the 17th fret. Written tab means the same thing by brackets, so it passes straight through. |
| On a string | `ON_STRING` | within 0.42 spacings of a line | A fret number sits on its string. "P.M.", "let ring" and section names do not. |
| Two-digit frets | `DIGIT_JOIN` 0.6 of a digit height, first digit 1 or 2, result ≤ 24 | | A two-digit fret is set almost solid where two notes are a beat apart; and nobody writes "04", so most of the ways two close notes could run together are ruled out. |
| A chord | `SAME_COLUMN` | numbers whose middles are within 0.45 spacings | Generous enough to hold a chord where a 24 is drawn wider than a 4 and so does not have its middle in quite the same place. |
| Bar line | `BAR_MAX_WIDTH` 0.3 spacings wide, `BAR_MIN_HEIGHT` 0.76 of the staff | | Spans the staff; a rhythm stem below it does not. |
| Timing | `CHARS_PER_GAP` = 3 | the gap between two numbers on the page becomes dashes in proportion, the smallest gap being three | Engraved music is laid out along the page roughly in proportion to time, so the spacing really does carry the rhythm — and three characters is what `parse/tab.js` assumes a step is when nothing else says. Stems, flags and beams are **not** read. |

Which digit a mark is comes from four measurements, weighted (`src/read/digits.js`):

| Measurement | Weight | What it is |
|---|---|---|
| Shape | 0.40 | How far the mark's strokes are from a drawn letterform's, and the letterform's from the mark's, both ways. Mostly the **worst-fitting tenth** rather than the average: a 5 laid over a 3 agrees everywhere except the stem down its left, and an average buries exactly the thing that names it. |
| Strokes | 0.30 | On each of eight bands down the mark, how many strokes cross it and how far left and right they reach. Survives blurring and small sizes. |
| Holes | 0.12 | None in a 1, one in a 0, two in an 8 — and where the hole sits, which is the whole difference between a 0, a 6 and a 9. |
| Width for height | 0.18 | A range per character, not a number: it rules shapes out rather than picking the winner. |

A mark is compared **stretched** to a square, not scaled: how wide a digit is drawn is
already measured on its own, and leaving it in the shape as well makes a condensed 5 fit a
3 better than it fits a 5.

Below `MIN_CONFIDENCE` (0.6), or with a shape score under `MIN_SHAPE` (0.5), the mark is
reported as unreadable rather than guessed at — and so is a mark that reads as a letter,
because an 8 and a B are the same shape with the corners squared off and a note quietly
dropped as furniture is worse than one the user is told to check. The letterforms the
reader knows are deliberately few (T and A, for the word written down the front of a tab
staff): a letter earns its place there only when it cannot be mistaken for a digit.

### Reading past the bottom of the screen (`src/read/stitch.js`)

A player draws the bars that are on screen and no more, so a whole song is read a screenful
at a time and joined up. Two numbers decide how.

| What | Constant | Value | Why |
|---|---|---|---|
| A staff is whole | `EDGE_MARGIN` | a whole line spacing of clear picture below its last line | Staff lines are evenly spaced, so a clear spacing with no line in it means the staff really ended there; less than one means the next line could be sitting just off the bottom of the screen. Six lines cut down to four still group as a staff — a bass, to look at it — and would come back as music nobody played, on strings the guitar does not have. |
| ...at the top of the picture | — | never trimmed | The scroll is worked out to land the next staff hard against the top of the next picture. Trimming there would throw away the bars the scroll was made to reach, every time, all the way down. The asymmetry is the point. |
| How far to scroll | `readTo()` | just past the bottom of the last whole staff | Nothing is read twice and nothing on the fold is lost, so the screenfuls join by concatenation with no overlap to reconcile. Picture pixels become the page's own through the scale each reading carries: a canvas knows it from where it sits on screen against how big its buffer is, which on an ordinary laptop is two buffer pixels for each of the page's. |
| When to stop | `MAX_SCREENFULS` = 40 | or the scroller says it is at the end, or it will not move | A long song is a dozen screenfuls. Anything near forty means the page is not moving the way we think it is, and grinding on would not make it. |

A screenful that comes back word for word the same as the one before it is dropped as a
page that did not move, rather than kept as a song that repeats itself: a real repeat is
engraved again further down and arrives with different bars either side of it.

## The parts of the song (`src/parse/sections.js`, `src/arrange/sections.js`)

Tabs mark where their parts begin, and no two mark it the same way: `[Intro/Verse]`,
`Chorus:`, `-- Guitar solo --`, `CHORUS`, `Estribillo`, `前奏`. A keyword list cannot be
the mechanism, so it is only one signal among several. Each candidate line is scored and
has to reach `CALLOUT_THRESHOLD` (3).

| Signal | Constant | Value | Why |
|---|---|---|---|
| Wrapped | `bracketed` | +3 | `[Chorus]`, `(Intro)`, `{Solo}`: someone marked it as a heading on purpose, in any language. |
| Drawn as a rule | `decorated` | +3 | `-- Chorus --`, `*** Intro ***`. Fenced on both sides, or one run of `MIN_ONE_SIDED_RULE` (3) characters — one stray dash is not a rule. |
| Names a part | `keyword` | +3 | A word from `SECTION_WORDS`, matched past its accents and its ending, so one entry covers "Refrão" and "refrões". A bonus, never a requirement. |
| Ends in a colon | `colon` | +2 | `Chorus:` with nothing after it. |
| Shouted / title case | `shouted`, `titleCased` | +1 | How a heading is written in a cased script. |
| Numbered | `numbered` | +1 | `Verse 2`, `Parte II`. Parts get counted; lyrics do not. |
| Brief | `brief` | +1 | 24 characters or fewer: a label, not a sentence. |
| Music underneath | `aboveMusic` | +1 | The next thing in the text is a stave or a chord line. |
| Alone | `isolated` | +1 | A blank line above it, or the top of the text. |
| Said again | `recurring` | +1 | The same label heads music more than once: songs repeat their parts. |
| Ends in a full stop | `stopped` | -2 | `Everything.` is the end of a sentence, not the name of a part. |

Two caps are applied before any of that, as hard rejects rather than penalties: a label
longer than `MAX_LABEL_LENGTH` (48 characters) or of more than `MAX_LABEL_WORDS` (5)
words is not a heading at all. The word cap is what tells `[Chorus]` from
`[You know i always try to settle ya']`, the line of words an Ultimate Guitar tabber
brackets just as readily as the part being played; no other signal separates them,
since both are bracketed, both sit on their own line and both have music underneath.

Three more rules sit outside the scoring because they are absolute:

- **A sung-looking line needs an explicit mark.** In a chord sheet every lyric is short,
  capitalised and sitting on top of music, so shape and position carry no information
  there. A line `isLyricLine` accepts is out unless it is bracketed, ruled, colon-ended,
  or made of nothing but section words and who plays them (`isHeadingPhrase`: "Guitar
  solo", "Riff 2").
- **A heading with no music left below it heads nothing** — that is the page talking
  ("Comments", "Related tabs").
- **A bracket that closes early is a heading with a note after it.** The note joins the
  name when the result still fits both caps above — `[Verse 2] (Rythm):` and
  `[Verse 2] (Lead):` are two different parts and each needs its qualifier — and is
  dropped when it is a sentence, leaving `[Verse] THIS GRADUALLY SLOWS DOWN` as `Verse`.

Sections are then the beats between one callout and the next, named after it; a repeated
label is numbered ("Chorus", "Chorus 2") so every part has a name of its own. Music
before the first callout becomes `DEFAULT_SECTION_NAME` ("Start"). Fewer than two parts
means there is nothing to tell apart, and no sections are reported at all.

`splitBySection()` then cuts the tabbed track at those boundaries, and only that one:
`SPLIT_ROLES` is `["guitar"]`. Cutting every role multiplies tracks by parts, so a
six-part song with the full arrangement arrives as twenty-four tracks — worse to open
than the single track it replaced — and the part anyone actually wants to loop is the
one that was tabbed. A section track keeps its
**absolute** beats rather than being rebased to zero, so the parts line up on import
exactly as the tab reads, and the first and last sections reach to -∞ and +∞ so no note
can fall between two of them and be lost.

## Arranging (`src/arrange/index.js`)

| What | Constant | Value | Why |
|---|---|---|---|
| Chord group size | `MIN_CHORD_NOTES` | 3 notes, **or** 2 notes a fifth (or fourth) apart | Rock tabs are full of two-note power chords; a pad holding root + fifth under them sounds right. Other two-note groups (thirds, sixths) are treated as melody. |
| Root finding | `analyzeChord()` | scores each pitch class as a candidate root: fifth above it +3, third +2, seventh +1, being the lowest note +1.5, diminished triad +1.5 | Guitarists usually put the root lowest, but inversions like C/E still come out as C. |
| Pad voicing | `voicePad()`, `CHORD_LOW = 60`, `CHORD_HIGH = 84` | root in C4..B4, third/fifth/seventh stacked closely above, no doubled octaves | Clean, close voicing in the range where pads sit well. |
| Bass | `buildBassTrack()`, `BASS_LOW = 36`, `BASS_HIGH = 48` | the lowest note of every group of two or more notes, moved by octaves into C2..C3 | Follows the guitarist's lowest note rather than the analysed root, so slash chords and inversions keep their bass movement. Muted strokes never drive the bass. |
| Lead | `MIN_LEAD_RUN = 4` | runs of single notes longer than four events, copied as they are | Melodies and solos; chords break a run. |
| Loudness | `CHORD_VELOCITY = 0.7`, `BASS_VELOCITY = 0.75` | | Slightly under the guitar so it stays the lead voice. |

Empty tracks are never written.

## MIDI (`src/midi/encode.js`)

Format 1, 480 ticks per quarter note. Track 0 carries tempo (default 120 unless
the page or tab states one), time signature, and one marker (`FF 06`) for each of the
song's callouts — that is where `[Chorus]` ends up visible along a DAW's ruler. Then, in
this order and only when they have notes: "Guitar (as tabbed)" (program 27, channel 0),
"Chords" (89, ch 1), "Bass" (39, ch 2), "Lead" (81, ch 3). Program numbers are
zero-based General MIDI values. At the same tick, note-offs are written before note-ons
so a repeated pitch re-triggers.

When the tracks are split by section, the tabbed role keeps its program and channel and
every one of its parts is written as its own track, in playing order, named for the
part and then the instrument —
"Chorus 2 - Guitar"; the arranger's tracks follow it whole. Both are on by
default — a song with parts arrives in parts, because someone who wants a track per
section should not have to find a setting first — and `splitSections: false` gives back
the one long track. Markers are written either way.
