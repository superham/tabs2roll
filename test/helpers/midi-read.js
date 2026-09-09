// Minimal Standard MIDI File reader used only by the tests to check what
// the encoder wrote. Not part of the extension.

export function readMidi(bytes) {
  let pos = 0;
  const u8 = () => bytes[pos++];
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => {
    let v = 0;
    for (;;) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
  };

  if (tag() !== "MThd") throw new Error("not a MIDI file");
  const headerLen = u32();
  const format = u16();
  const trackCount = u16();
  const division = u16();
  pos += headerLen - 6;

  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    if (tag() !== "MTrk") throw new Error("bad track chunk");
    const len = u32();
    const end = pos + len;
    const events = [];
    let tick = 0;
    let running = null;
    let name = null;
    const markers = [];
    let program = null;
    let tempo = null;
    let timeSignature = null;
    while (pos < end) {
      tick += vlq();
      let status = u8();
      if (status === 0xff) {
        const type = u8();
        const l = vlq();
        const data = Array.from(bytes.slice(pos, pos + l));
        pos += l;
        // Meta text is written as UTF-8, so read it back that way: decoding
        // it a byte at a time would turn a section named 前奏 into mojibake
        // and make a passing test look like a failing one.
        if (type === 0x03) name = new TextDecoder().decode(Uint8Array.from(data));
        if (type === 0x06) markers.push({ tick, text: new TextDecoder().decode(Uint8Array.from(data)) });
        if (type === 0x51) tempo = Math.round(60000000 / ((data[0] << 16) | (data[1] << 8) | data[2]));
        if (type === 0x58) timeSignature = [data[0], 2 ** data[1]];
        events.push({ tick, meta: type, data });
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        const l = vlq();
        pos += l;
        continue;
      }
      if (status < 0x80) {
        pos--;
        status = running;
      } else running = status;
      const kind = status & 0xf0;
      const channel = status & 0x0f;
      if (kind === 0xc0 || kind === 0xd0) {
        const v = u8();
        if (kind === 0xc0) program = v;
        events.push({ tick, kind, channel, data: [v] });
      } else {
        const a = u8();
        const b = u8();
        events.push({ tick, kind, channel, data: [a, b] });
      }
    }
    pos = end;
    const notes = [];
    const open = new Map();
    for (const e of events) {
      if (e.kind === 0x90 && e.data[1] > 0) {
        open.set(e.data[0], { midi: e.data[0], tick: e.tick, velocity: e.data[1] });
      } else if (e.kind === 0x80 || (e.kind === 0x90 && e.data[1] === 0)) {
        const n = open.get(e.data[0]);
        if (n) {
          notes.push({ ...n, length: e.tick - n.tick });
          open.delete(e.data[0]);
        }
      }
    }
    tracks.push({ name, markers, program, tempo, timeSignature, events, notes });
  }
  return { format, trackCount, division, tracks };
}
