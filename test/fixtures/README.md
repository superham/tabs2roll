# Test fixtures

Each `*.txt` file is a tab (or chord sheet) as it might be pasted from a web page; the
`*.expected.json` next to it is the golden file: the facts a person can check by eye
(stave count, note count, first/last pitch, tuning, timing) plus the per-track counts
the arranger produces.

The tabs here are written for the tests: public-domain melodies (Ode to Joy,
Greensleeves, House of the Rising Sun, Scarborough Fair, Wildwood Flower, Amazing
Grace) plus deliberately awkward shapes (no labels, low string on top, staves stuck
together, separators, Ultimate Guitar markup, techniques, seven strings, bass, capo,
alternate tunings, a chord sheet with an intro riff, and a page of prose).

The two `sections-*.txt` files pin `src/parse/sections.js`, which finds the callouts
that say where a song's parts begin. They are deliberately the cases a keyword list
cannot reach: `sections-unmarked.txt` heads its parts in Spanish with no brackets and no
colons, so only shape and position can find them, and `sections-decorated.txt` uses a
different dressing every time (`--- Intro ---`, `CHORUS:`, `** Guitar solo **`,
`[Outro] x4`). `sections-ug-layout.txt` is the Ultimate Guitar habit that brackets are
used for two different things: the part being played *and* the line of words about to be
sung, one right under the other, plus the qualifiers and asides tabbers hang off a
heading (`[Verse 2] (Rythm):`, `[Outro] THIS GRADUALLY SLOWS DOWN`). Its words are
made up, like the rest of the fixtures here. The `sections` field of every golden file
records what was found, so a change to the scoring shows up across all the fixtures at
once.

The `real-*.txt` files are different again, and are the only fixtures here that were
not written for the tests: they are five real tabs, copied off Ultimate Guitar and left
as they came, with the name of whoever typed each one out removed. They exist because
every one of them caught something the invented fixtures did not. `real-anything.txt`
brackets the words about to be sung as well as the part being played, one right under
the other, so brackets alone cannot tell a heading from a lyric. `real-games.txt` hangs
qualifiers off its headings (`[Verse 2] (Rythm):` and `[Verse 2] (Lead):` are two
different parts) and puts a `Strumming:Down` field between every heading and its stave.
`real-sasquatch.txt` prints its headings twice — once over the tab, then again over the
words with no tab under them — and has no title line at all. `real-souls-of-fire.txt`
has a single `[Intro]` and must therefore stay one track. `real-only-call-me.txt` is a
straightforward, well-marked bass tab: the case that has to keep working.

Their song words are the tabbers' own transcriptions and are kept only because they are
what the parser has to read past; nothing here is a distribution of the songs.

The two `page-*.txt` files are different: they are whole web pages as a person would
get them by selecting everything and copying, navigation and footer included. They
exist to pin the behaviour of `src/parse/region.js`, which cuts a page down to the
song. `page-ug-chords.txt` is an Ultimate Guitar chord sheet, chords aligned above the
words, wrapped in a chord-diagram legend and an A-Z artist index that both read as
chord lines. `page-guitartuna.txt` is the newer layout, one chord per line with the
alignment gone, plus a capo and a stated tempo. Do not tidy them up: the mess is the
test.

## Pictures

`pictures/` holds the other kind of fixture: `<name>.png` is a drawing of a tab and
`<name>.tab.txt` is the tab it was drawn from, which is the ground truth a person can read.
The test reads the PNG and checks it gets those notes back, on those strings, in that
order. Between them they cover every digit, two-digit frets, chords, dead notes, a bass
staff, two staves one after another, a light-on-dark player, and a staff sitting in the
middle of a page with navigation, rules and lyrics around it.

`player-page.png` is the one drawn the way a real tab player draws: the word TAB down the
front of the staff, a time signature, bar numbers, the H and P of hammer-ons and pull-offs
with their slurs, a vibrato squiggle, a note held over in brackets, the rhythm beamed
underneath with a triplet bracket, and the player's own cursor across it all. None of that
is music and none of it may become notes.

The digits in those pictures are a plain 5x7 terminal font — a 1 with a foot on it, a
flat-topped 3, a 4 open at the corner — and none of those are the letterforms
`src/read/digits.js` matches against. That is the point: a reader that only recognised its
own drawings would sail through a test drawn with them and fail on the first real
screenshot.

Redraw them with `npm run pictures` (or `node tools/make-pictures.js <name>`) after
changing `test/helpers/draw.js`, and look at the PNGs before committing.

## Adding a real tab

1. Save the text as `test/fixtures/<name>.txt`.
2. Run `node tools/convert.js test/fixtures/<name>.txt --notes` and check the notes by
   eye (and by ear: open the `.mid` it writes in your DAW).
3. Run `npm run goldens <name>` to write `<name>.expected.json`, review it, commit both.

`npm test` fails whenever the parser's output for a fixture drifts from its golden file,
so a change to the timing or tuning rules shows up as a reviewable diff.
