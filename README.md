# tab2roll

A Firefox extension that turns the guitar tab on the page you are looking at into a
standard MIDI file you can drag into your DAW.

- One button: **Send to my DAW**. The file lands in your Downloads folder as
  `Artist - Song (tab).mid`.
- Works on Ultimate Guitar and on any page that shows tab or chords as text, including
  modern chord pages that print the chord names above (or on their own line before) the
  words. If a page can't be read, paste the text into the popup instead.
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
```

This is how the parser was developed and verified before any browser code existed; it
prints a summary (title, tuning, tracks, timing step) and with `--notes` every note.

## How it works

```
src/
  extract/      DOM  -> raw tab text        runs inside the page; site-specific
  parse/        text -> IR                  pure, no DOM, no browser APIs
    region.js   whole page -> just the song (see below)
  arrange/      IR   -> IR + chord/bass/lead pure
  midi/         IR   -> Uint8Array          pure, hand-written SMF encoder
  pipeline.js   the three above in one call (used by the CLI and the extension)
  background.js event page: runs the pipeline, saves the file, opens onboarding
  ui/           popup, onboarding, help and settings pages (plain HTML + JS)
  strings.js    every user-facing string
test/
  fixtures/     tab texts + golden files (see test/fixtures/README.md)
tools/
  convert.js    CLI
  build-injected.js  builds the one script that runs inside web pages
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

### When a real page does not work

Every click logs one line to the extension's console saying what the page
looked like: which extractor build is running, how much text was on the page,
and how many lines of it read as tab, chords or words. Open it from
`about:debugging#/runtime/this-firefox` with **Inspect** next to tab2roll.

```
[tab2roll] ran the extractor: { frames: 1, entries: [ { hasResult: true, error: null } ] }
[tab2roll] page: { ok: true, site: "ultimate-guitar", strategy: "pre",
                   build: "45a1e21d", chars: 8213, chordLines: 42 }
[tab2roll] read as: chords { staves: 0, chords: 57, ... }
```

`build` is a hash of the whole injected script, printed by `npm run build`,
and the popup footer shows the installed version. If either does not match,
the browser is running an older copy: reload the add-on.

`hasResult: false` on the first line means the browser ran the script but did
not hand its value back. Firefox does this for file injections, so the answer
is fetched with a second, function-based injection instead; the next console
line reports whether that worked.

To check a page without the extension at all, paste the contents of
[tools/page-check.js](tools/page-check.js) into the console of the tab page
itself. It reports the same numbers plus the first 40 lines as the page reads
them, which is the quickest way to tell "the page is unreadable" from "the
extension is stale".

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

## License

GPL-3.0, see [LICENSE](LICENSE).
