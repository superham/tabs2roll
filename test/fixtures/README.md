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

## Adding a real tab

1. Save the text as `test/fixtures/<name>.txt`.
2. Run `node tools/convert.js test/fixtures/<name>.txt --notes` and check the notes by
   eye (and by ear: open the `.mid` it writes in your DAW).
3. Run `npm run goldens <name>` to write `<name>.expected.json`, review it, commit both.

`npm test` fails whenever the parser's output for a fixture drifts from its golden file,
so a change to the timing or tuning rules shows up as a reviewable diff.
