# tab2roll

A Firefox extension that turns the guitar tab on the page you are looking at into a
standard MIDI file you can open in your DAW.

- One button: **Send to my DAW**. The file lands in your Downloads folder as
  `Artist - Song (tab).mid`.
- Works on Ultimate Guitar and on any page that shows tab or chords as text, including
  modern chord pages that print the chord names above (or on their own line before) the
  words. If a page can't be read, paste the text into the popup instead.
- **Reads tab that is drawn rather than written.** The "Official" and "Pro" tabs and the
  interactive players paint the music onto a canvas — there is no tab text on those pages
  at all — so tab2roll reads the picture: it finds the strings, reads the fret numbers off
  them and shows you the tab it made before saving anything. Drop or paste a screenshot or
  a photo of a page and it does the same.
- Reads the song out of the page and leaves the rest behind: navigation, the
  chord-diagram legend, comments and the A-Z artist index never become bars of music.
- Makes up to four tracks: the guitar exactly as tabbed, plus chords, bass and lead
  worked out from it.
- Zero network requests, no accounts, no telemetry. It reads the page you clicked on and
  writes one file. That's all.

![The popup after finding a tab](docs/screenshots/popup-found.png)
![The popup after saving](docs/screenshots/popup-success.png)

## Try it (development)

```sh
npm test            # unit tests + golden files + popup smoke test (Node 20+)
npm run dev         # web-ext run: opens Firefox with the extension loaded
npm run lint        # web-ext lint
npm run build       # regenerate src/extract/injected.js (see below)
```

`npm run dev` and `npm run lint` use `npx web-ext`, which is fetched on demand; nothing
in this repository has runtime dependencies and the tests need only Node.

To load it by hand: open `about:debugging#/runtime/this-firefox`, choose **Load
Temporary Add-on…** and pick `src/manifest.json`. The onboarding page opens on first
install and shows how to pin the toolbar button.

### Convert a tab file from the command line

```sh
node tools/convert.js test/fixtures/ode-to-joy.txt out.mid
node tools/convert.js my-tab.txt --tuning drop-d --step 1/16 --notes
node tools/convert.js screenshot.png out.mid --show-tab
```

This is how the parser was developed and verified before any browser code existed; it
prints a summary (title, tuning, tracks, timing step) and with `--notes` every note.

Hand it a PNG and it reads the sheet music off it first, exactly as the extension does,
reporting how sure it is; `--show-tab` prints the tab it made of the picture.

## How it works

```
src/
  extract/      DOM  -> raw tab text        runs inside the page; site-specific
                DOM  -> pixels              score-canvas.js, for pages that draw it
  read/         picture -> ASCII tab text   pure, no DOM (see below)
  parse/        text -> IR                  pure, no DOM, no browser APIs
    region.js   whole page -> just the song (see below)
  arrange/      IR   -> IR + chord/bass/lead pure
  midi/         IR   -> Uint8Array          pure, hand-written SMF encoder
  pipeline.js   the three above in one call (used by the CLI and the extension)
  background.js event page: runs the pipeline, saves the file, opens onboarding
  ui/           popup, onboarding, help and settings pages (plain HTML + JS)
    picture.js  the popup's side of reading a picture
  strings.js    every user-facing string
test/
  fixtures/     tab texts + golden files (see test/fixtures/README.md)
    pictures/   PNGs of tab + the tab each was drawn from
  helpers/draw.js  draws tablature, in a digit face the reader has never seen
tools/
  convert.js    CLI (text or PNG in, MIDI out)
  png.js        a PNG reader, so the CLI can be pointed at a screenshot
  build-injected.js  builds the one script that runs inside web pages
  make-pictures.js   draws the picture fixtures
  update-goldens.js  regenerates the golden files
```

`parse/`, `arrange/` and `midi/` are plain ES modules with no dependencies, so they run
under Node and in the browser unchanged. Timing in ASCII tab is always a guess; the
guesses and how to tune them are written up in [docs/musical-decisions.md](docs/musical-decisions.md).

### The one script that runs inside a web page

Clicking the toolbar button grants `activeTab`; the popup then injects
`src/extract/injected.js` into the page with `scripting.executeScript`. That file is
**generated** by `npm run build` from `src/parse/tabshape.js` (the shared tab-shape
heuristic) and `src/extract/sites/*.js`, so the same functions can be unit tested as
ES modules while the injected script stays a single self-contained, import-free
function. It reads the DOM and returns plain data; it injects no UI, keeps no state and
never touches the network. The generated file is committed so a checkout loads without
a build; `npm test` fails if it is stale.

### Reading sheet music

An "Official" or "Pro" tab page has no tab text on it anywhere — not in the DOM, not in a
script tag, not in an attribute. The music is painted onto a `<canvas>`, so the notes exist
only as pixels. `src/read/` reads them:

```
picture -> ink            image.js   grey, then black and white, either way up
        -> staves         staff.js   the long even lines, and how they group
        -> marks          glyphs.js  lines rubbed out, what is left picked up
        -> digits         digits.js  which mark is which
        -> notes and bars score.js   which string, which fret, played together?
        -> tab text       ascii.js
```

The last step is the point of the design: the reader's job ends when the picture has become
the same ASCII tab a person would have pasted in. Everything downstream — the timing
guesses, the tunings, the arranger, the MIDI encoder — is the code that was already there
and already tested. It is also what the user sees, because a picture read slightly wrong is
a mystery until you can look at it, and a 7 that should be a 1 takes five seconds to fix in
a box of dashes.

Three decisions worth knowing about:

- **Tablature only.** Fret numbers on strings, four to seven of them. An ordinary five-line
  stave is recognised as notation and reported as such rather than guessed at: pitches from
  noteheads, clefs, key signatures and accidentals is a different problem, and a wrong
  answer would be worse than an honest "I can't read this".
- **No machine learning, no dependencies.** A printed digit is one of the most constrained
  shapes there is: ten possibilities, upright, at a known size. Four measurements settle it
  — how far the strokes sit from a drawn letterform in `digits.js`, where the strokes fall
  band by band, how many holes it has, and how wide it is for its height. `npm test` reads
  every digit at eight sizes and three widths in a face those letterforms deliberately do
  not match.
- **What it will not do.** It never says a note it is unsure of. Marks it cannot make out
  are counted and reported, both in the popup and by `--show-tab`; the timing still comes
  from the spacing along the page, which is the same guess ASCII tab forces anyway.

A canvas holds the bars that are on screen and no more, so one click reads one screenful of
a four-minute song. The popup says how much of the score that was and offers to join the
next screenful onto it.

### When a real page does not work

Every click logs one line to the extension's console saying what the page
looked like: which extractor build is running, how much text was on the page,
and how many lines of it read as tab, chords or words. Open it from
`about:debugging#/runtime/this-firefox` with **Inspect** next to tab2roll.

```
[tab2roll] reading tab 7 https://tabs.ultimate-guitar.com/tab/...
[tab2roll] ran the extractor: frames: 1, { hasResult: true, error: none }
[tab2roll] page: { ok: true, site: "ultimate-guitar", strategy: "pre",
                   build: "45a1e21d", chars: 8213, chordLines: 42 }
[tab2roll] read as: chords { staves: 0, chords: 57, ... }
```

`build` is a hash of the whole injected script, printed by `npm run build`,
and the popup footer shows the installed version. If either does not match,
the browser is running an older copy: reload the add-on.

The first line names the tab being read. If it is not the tab page you are
looking at, that is the whole problem: the popup reads whichever tab is
active, so an extension page or a newly opened tab in front of it will be
read instead. Extension and `about:` pages are skipped without injecting,
because Firefox blocks content scripts there and reports it as an entry
carrying an error rather than as a failure.

`hasResult: false` means the browser ran the script but did not hand its
value back. Firefox does this for file injections, so the answer is fetched
with a second, function-based injection instead; the next console line
reports whether that worked.

To check a page without the extension at all, paste the contents of
[tools/page-check.js](tools/page-check.js) into the console of the tab page
itself. It reports the same numbers plus the first 40 lines as the page reads
them, which is the quickest way to tell "the page is unreadable" from "the
extension is stale".

### When FL Studio ignores the file

A dropped file that FL Studio refuses looks exactly like a broken file: nothing appears,
and no message is shown. It is worth checking the file itself before believing that,
because the answer is usually the drop and not the bytes:

```sh
node tools/check-midi.js out.mid            # or: npm run check-midi -- <file>
```

It re-reads the bytes strictly and without any of the encoder's assumptions — every chunk
length has to be consumed exactly, every track has to end with an end-of-track event, no
note may be left switched on — and prints the tracks, notes and channels it found. A file
that passes is one every DAW can open, and the report says so in as many words, because
the point of running it is to stop suspecting the file.

FL Studio then turns a dropped file down silently in three known cases, none of which
have anything to do with the file:

- It is running as an administrator on Windows. Windows will not let an ordinary file
  window hand files to an elevated program, so the drop never reaches FL Studio
  ([Image-Line knowledge base](https://support.image-line.com/action/knowledgebase/?ans=571)).
- It is the Fruity Edition, which does not accept files dropped on the playlist at all.
- The file's full name and folder run past about 256 characters
  ([Image-Line forum](https://forum.image-line.com/viewtopic.php?t=196376)).

`File > Import > MIDI file` works in every edition and is unaffected by all three, so
that is the route the popup and the help page lead with; dragging is offered as the
shortcut it is. The help page's "Nothing happens when I drag the file in" section
(`ui/help.html#drag-does-nothing`, linked straight from the confirmation in the popup)
says the same thing to users.

### Permissions

`downloads`, `activeTab`, `scripting`. No host permissions: the install prompt does not
warn about reading data on websites, because the extension can only read the page the
user clicked the button on. Settings and the "you just saved…" reminder use the
extension's own `localStorage`, which needs no permission.

## Submitting to AMO

- Set a real add-on id in `src/manifest.json` (`browser_specific_settings.gecko.id`);
  it is `tab2roll@placeholder.invalid` until then.
- The only generated file is `src/extract/injected.js`. When uploading, include the
  repository as source and point reviewers at `npm run build`; the tests check that the
  committed file matches the build.
- Package with `npx web-ext build --source-dir src`.

## Decisions worth knowing about

- **No framework, no bundler** for the popup and pages: plain HTML and JS modules, so
  the review surface is the source itself.
- **Chords, bass and lead** are always generated (unless turned off in Settings). Two-note
  power chords count as chords for the pad; see the musical-decisions doc.
- **Capo** raises every string so the file sounds at the real pitch of the recording.
- **Muted `x` strokes** become short, quiet notes at the open-string pitch, so strumming
  patterns keep their rhythm.
- **Timing**: the most common gap between notes in a tab is one step (an eighth note by
  default); bar lines snap to whole bars. Files always say the timing was guessed.
- **Trimming the page down to the song** happens on TEXT, in `parse/region.js`, not in
  the DOM extractor. That is deliberate: a real user faced with a page the extractor
  cannot read will select the whole page and paste it, so the paste box needs exactly
  the same clean-up as the button. Read as text, a page's chord-diagram legend
  (`E / C#m / G#m / B / A`, one per line) and its A-Z artist index (`A / B / C / D / E /
  F / G`) are indistinguishable from chord lines; both used to become bars of music.
  The trimmer scores every line and keeps the best-scoring stretch, and it refuses to
  cut when that would throw away most of the song.
- **A capo transposes chord sheets too**, not just tabs. Chord sheets name the shape the
  player holds, so a capo on fret 1 means a written G sounds as Ab, and the file should
  match the record rather than the shapes.
- **A picture becomes text, not notes.** Reading sheet music stops at ASCII tab and hands it
  to the parser that was already there. It costs a little accuracy — the text cannot hold
  anything the parser could not have been told anyway — and it buys the whole existing
  pipeline, a golden-file test for every picture, and a user who can see and correct what
  was read.

## License

GPL-3.0, see [LICENSE](LICENSE).
