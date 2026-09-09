#!/usr/bin/env node
// CLI: node tools/check-midi.js <file.mid> [--events]
//
// Answers one question: is this file a well-formed Standard MIDI File, or is
// the DAW right to reject it? A DAW that refuses a dropped file usually says
// nothing at all, so "nothing happened" has to be told apart from a bad file
// somehow, and guessing from the DAW's silence is not it.
//
// Deliberately strict and deliberately standalone: it re-reads the bytes
// without any of the encoder's assumptions, so it can catch the encoder being
// wrong. Every chunk length must be consumed exactly, every track must end
// with an end-of-track event, and a running status with nothing before it is
// an error rather than something to muddle through.
//
// Exit code 0 when the file is sound, 1 when it is not, 2 for bad usage.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2).filter((a) => a !== "--events");
const showEvents = process.argv.includes("--events");
if (args.length !== 1) {
  console.error("usage: node tools/check-midi.js <file.mid> [--events]");
  process.exit(2);
}

const bytes = readFileSync(args[0]);
const problems = [];
let pos = 0;

const u8 = () => {
  if (pos >= bytes.length) throw new Error("the file stops in the middle of an event");
  return bytes[pos++];
};
const u16 = () => (u8() << 8) | u8();
const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
/**
 * Meta text as characters.
 *
 * Spreading the bytes into String.fromCharCode blows the call stack on a long
 * one, and a long one is legal: the length is a variable-quantity number, so a
 * track name may be as big as the file. Only the bytes the report can show are
 * decoded, one more than that so the ellipsis knows whether it is needed, so a
 * name the size of the file costs no more than a short one. Decoded byte for
 * byte rather than as UTF-8, because a text meta event is bytes and this tool
 * reports what is in the file rather than guessing at an encoding for it.
 */
const MAX_TEXT = 120;
const textOf = (data) => {
  const text = data.toString("latin1", 0, MAX_TEXT + 1);
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + "…" : text;
};

const vlq = () => {
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const b = u8();
    v = (v << 7) | (b & 0x7f);
    if (!(b & 0x80)) return v;
  }
  throw new Error("a delta time runs longer than four bytes");
};

function readTrack(index) {
  const chunk = tag();
  const length = u32();
  const start = pos;
  const end = start + length;
  if (chunk !== "MTrk") problems.push(`track ${index}: chunk is "${chunk}", not MTrk`);
  if (end > bytes.length) {
    problems.push(`track ${index}: says it is ${length} bytes but only ${bytes.length - start} are left`);
    pos = bytes.length;
    return null;
  }
  const track = { name: null, channels: new Set(), notes: 0, hanging: 0, endTick: 0, ended: false, events: 0 };
  const open = new Map();
  let tick = 0;
  let running = null;
  // Set when parsing gives up part way through the track. Whatever is left
  // unread after that is a consequence of the fault already reported, so
  // saying the track has no end or has notes still held open would be noise
  // on top of the one message that names what actually went wrong.
  let stopped = false;
  while (pos < end) {
    tick += vlq();
    let status = bytes[pos];
    if (status < 0x80) {
      if (running === null) {
        problems.push(`track ${index}: an event at ${tick} carries no status byte and none came before it`);
        stopped = true;
        break;
      }
      status = running;
    } else pos++;

    if (status === 0xff) {
      const type = u8();
      const length2 = vlq();
      // A length that runs past the chunk would otherwise read the next
      // track's bytes as though they belonged to this one — its name, its
      // end-of-track event and all — and report that muddle instead of this.
      if (length2 > end - pos) {
        problems.push(`track ${index}: a meta event at ${tick} claims ${length2} bytes, with only ${end - pos} left in the track`);
        stopped = true;
        break;
      }
      const data = bytes.subarray(pos, pos + length2);
      pos += length2;
      if (type === 0x03 && track.name === null) track.name = textOf(data);
      if (type === 0x2f) {
        track.ended = true;
        track.endTick = tick;
        if (pos !== end) problems.push(`track ${index}: ${end - pos} bytes come after the end-of-track event`);
      }
      if (showEvents) console.log(`  track ${index} @${tick} meta ${type.toString(16).padStart(2, "0")} (${length2} bytes)`);
      running = null;
    } else if (status === 0xf0 || status === 0xf7) {
      const length2 = vlq();
      if (length2 > end - pos) {
        problems.push(`track ${index}: a system-exclusive event at ${tick} claims ${length2} bytes, with only ${end - pos} left in the track`);
        stopped = true;
        break;
      }
      pos += length2;
      running = null;
    } else {
      running = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      track.channels.add(channel);
      const a = u8();
      const b = kind === 0xc0 || kind === 0xd0 ? null : u8();
      if (a > 127 || (b !== null && b > 127)) problems.push(`track ${index}: an event at ${tick} has a data byte above 127`);
      if (kind === 0x90 && b > 0) {
        open.set(a, tick);
        track.notes++;
      } else if (kind === 0x80 || (kind === 0x90 && b === 0)) {
        if (open.has(a) && tick === open.get(a)) problems.push(`track ${index}: the note at ${tick} has no length`);
        open.delete(a);
      }
      if (showEvents) console.log(`  track ${index} @${tick} ${kind.toString(16)} ch${channel} ${a}${b === null ? "" : " " + b}`);
    }
    track.events++;
    if (tick > track.endTick) track.endTick = tick;
  }
  track.hanging = open.size;
  if (stopped) {
    pos = end;
    return track;
  }
  if (pos !== end) {
    problems.push(`track ${index}: read ${pos - start} bytes of the ${length} it claims`);
    pos = end;
  }
  if (!track.ended) problems.push(`track ${index}: has no end-of-track event`);
  if (track.hanging) problems.push(`track ${index}: ${track.hanging} note(s) are never switched off`);
  return track;
}

let header;
try {
  const chunk = tag();
  const length = u32();
  const headerStart = pos;
  if (chunk !== "MThd") problems.push(`the file does not start with MThd (it starts with "${chunk}")`);
  if (length < 6) problems.push(`the header claims ${length} bytes; it needs at least 6`);
  if (length > bytes.length - pos) problems.push(`the header claims ${length} bytes, with only ${bytes.length - pos} left in the file`);
  header = { format: u16(), trackCount: u16(), division: u16() };
  // Where the header says it ends, but never off the end of the file and
  // never behind where it started: a length under six would otherwise wind
  // the reader backwards into bytes it has already read.
  pos = Math.min(headerStart + Math.max(length, 6), bytes.length);
  if (header.format > 2) problems.push(`unknown file format ${header.format}`);
  if (header.division === 0) problems.push("the header gives no timing");
  if (header.division & 0x8000) problems.push("the file is timed in frames per second, which most DAWs will not import");

  const tracks = [];
  while (pos < bytes.length) tracks.push(readTrack(tracks.length));
  if (tracks.length !== header.trackCount) problems.push(`the header promises ${header.trackCount} tracks; the file has ${tracks.length}`);
  if (header.format === 0 && tracks.length > 1) problems.push("a format 0 file may hold only one track");

  console.log(`${args[0]}`);
  console.log(`  format ${header.format}, ${header.division} ticks per beat, ${tracks.length} track(s), ${bytes.length} bytes`);
  for (const [i, track] of tracks.entries()) {
    if (!track) continue;
    const channels = [...track.channels].sort((a, b) => a - b).join(", ");
    console.log(`  ${i}: ${JSON.stringify(track.name ?? "")} — ${track.notes} note(s), ${track.events} event(s)${channels ? `, channel ${channels}` : ""}, ends at beat ${(track.endTick / header.division).toFixed(2)}`);
  }
} catch (err) {
  problems.push(err.message);
}

if (problems.length) {
  console.log("");
  for (const p of problems) console.log(`  ✗ ${p}`);
  console.log("\nThis file is not a sound MIDI file. A DAW refusing it is right to.");
  process.exit(1);
}
console.log("\n  ✓ Sound MIDI file. A DAW that ignores it is refusing the file, not reading it.");
