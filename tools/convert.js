#!/usr/bin/env node
// CLI: node tools/convert.js <tab.txt> [out.mid] [options]
//
// Options:
//   --tuning <id>     standard | drop-d | eb-standard | d-standard | dadgad | open-g | open-d
//   --step <s>        1/4 | 1/8 | 1/16      (timing step, default 1/8)
//   --tempo <bpm>     override the tempo
//   --no-arrange      only the literal guitar track
//   --title <t>  --artist <a>
//   --notes           print every note of the guitar track
//   --json            print the IR as JSON instead of a summary
//
// With no output path the file is written next to the input, named after
// the tab ("Artist - Song (tab).mid").

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { convertText, ParseError } from "../src/pipeline.js";
import { midiToNoteName } from "../src/parse/tuning.js";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-arrange") args.arrange = false;
    else if (a === "--notes") args.notes = true;
    else if (a === "--json") args.json = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args._.length) {
  console.error("usage: node tools/convert.js <tab.txt> [out.mid] [--tuning id] [--step 1/8] [--tempo bpm] [--no-arrange] [--notes] [--json]");
  process.exit(2);
}

const input = args._[0];
const text = readFileSync(input, "utf8");
let result;
try {
  result = convertText(text, {
    source: "paste",
    tuningId: args.tuning,
    step: args.step,
    tempo: args.tempo ? parseInt(args.tempo, 10) : undefined,
    title: args.title,
    artist: args.artist,
    arrange: args.arrange,
  });
} catch (err) {
  if (err instanceof ParseError) {
    console.error(`No luck: ${err.code === "no-tab" ? "nothing tab-shaped in that file" : "tab found, but it produced no notes"}.`);
    process.exit(1);
  }
  throw err;
}

const out = args._[1] || join(dirname(input), result.filename);
writeFileSync(out, result.bytes);

if (args.json) {
  console.log(JSON.stringify(result.ir, null, 2));
} else {
  const s = result.summary;
  console.log(`Wrote ${out} (${result.bytes.length} bytes)`);
  console.log(`  title:   ${s.title || "(none)"}${s.artist ? "  artist: " + s.artist : ""}`);
  console.log(`  kind:    ${s.kind}${s.kind === "tab" ? `, ${s.staves} stave(s)` : `, ${s.chords} chord(s)`}`);
  console.log(`  tempo:   ${s.tempo} bpm, ${s.timeSignature.join("/")}`);
  console.log(`  tuning:  ${s.tuningId || "custom"} (${s.tuningNotes.map(midiToNoteName).join(" ")})`);
  console.log(`  notes:   ${s.noteCount} on the guitar track`);
  console.log(`  tracks:  ${s.tracks.join(", ")}`);
  console.log(`  timing:  ${s.rhythmSource} (step ${result.ir.info.step}, ${result.ir.info.unit || "?"} columns per step)`);
}

if (args.notes) {
  const guitar = result.ir.tracks.find((t) => t.role === "guitar");
  console.log("\n  beat   len  midi note  str fret technique");
  for (const n of guitar.notes) {
    console.log(
      `${n.start.toFixed(2).padStart(6)} ${n.length.toFixed(2).padStart(5)}  ${String(n.midi).padStart(3)} ${midiToNoteName(n.midi).padEnd(3)}  ${String(n.string ?? "").padStart(3)} ${String(n.fret ?? "").padStart(4)} ${n.technique || ""}`,
    );
  }
}
