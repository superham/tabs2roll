#!/usr/bin/env node
// Regenerate test/fixtures/*.expected.json from the current parser output.
//
//   node tools/update-goldens.js            # rewrite every golden file
//   node tools/update-goldens.js ode-to-joy # just one fixture
//
// Review the diff before committing: a golden file is only as right as the
// eyes that checked it.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goldenFor } from "../test/helpers/golden.js";

const dir = new URL("../test/fixtures/", import.meta.url).pathname;
const only = process.argv.slice(2);
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".txt"))
  .map((f) => f.replace(/\.txt$/, ""))
  .filter((n) => !only.length || only.includes(n));

for (const name of names) {
  const text = readFileSync(join(dir, name + ".txt"), "utf8");
  const golden = goldenFor(text);
  writeFileSync(join(dir, name + ".expected.json"), JSON.stringify(golden, null, 2) + "\n");
  console.log(`${name.padEnd(28)} ${golden.kind.padEnd(6)} staves=${golden.staves} notes=${golden.noteCount} first=${golden.firstMidi} last=${golden.lastMidi}`);
}
