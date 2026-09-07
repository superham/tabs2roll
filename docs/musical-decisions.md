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

## Chord sheets (`src/parse/chords.js`)

- One chord symbol = one bar (three beats in 3/4, four in 4/4), in reading order.
- The "as strummed" guitar voicing puts the root between G2 and F#3, stacks the chord
  tones above it and doubles the root an octave up (`voiceChord()`). A slash chord adds
  its bass note underneath.
- Recognised: major, minor, dim, aug, sus2/sus4, 6, 7, maj7, m7, dim7, 9 (as a 7th plus
  the 9th), add9, add11, power chords (`A5`), slash bass.

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

Format 1, 480 ticks per quarter note. Track 0 carries only tempo (default 120 unless
the page or tab states one) and time signature. Then, in this order and only when they
have notes: "Guitar (as tabbed)" (program 27, channel 0), "Chords" (89, ch 1),
"Bass" (39, ch 2), "Lead" (81, ch 3). Program numbers are zero-based General MIDI
values. At the same tick, note-offs are written before note-ons so a repeated pitch
re-triggers.
