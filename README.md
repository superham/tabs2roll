# tab2roll

A Firefox extension that turns the guitar tab on the page you are looking at into a
standard MIDI file you can drag into your DAW.

- One button: **Send to my DAW**. The file lands in your Downloads folder as
  `Artist - Song (tab).mid`.
- Works on Ultimate Guitar and on any page that shows tab as text. If a page can't be
  read, paste the tab text into the popup instead.
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

## License

GPL-3.0, see [LICENSE](LICENSE).
