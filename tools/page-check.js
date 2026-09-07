// Paste this whole file into the CONSOLE OF A TAB PAGE (F12 on the page
// itself, not on the extension) and press Enter. It prints what tab2roll
// would see there, without needing the extension to be loaded at all.
//
// It only reads the page you already have open. It changes nothing and sends
// nothing anywhere.
//
// Copy the output back and it says which of these is happening:
//   chordLines / tabLines are 0  -> the page's text does not reach innerText
//                                   (the song is drawn some other way)
//   looksLikeChords is true      -> the page is readable; the extension is
//                                   running older code, so reload it
//   pre / stores are > 0         -> there is a better source to read from

(() => {
  const CHORD = /^([A-G])(#|b)?(maj|min|dim|aug|sus|add|m|M|\+|°)?(\d+)?(sus\d?|add\d+)?(?:\/([A-G])(#|b)?)?$/;
  const FILLER = /^(\||\|\||-|–|—|\/|x\d+|\(x\d+\)|\d+x|N\.?C\.?|\(N\.?C\.?\)|\.|,)$/i;
  const META = /(^\s*[A-Za-z][\w '-]{0,24}\s*:)|©|\bhttps?:\/\/|\bwww\./;
  const TABCH = "-|0123456789hpb/\\~x";

  const isChord = (l) => {
    const t = String(l).trim();
    if (!t || META.test(t)) return false;
    const toks = t.split(/\s+/);
    if (toks.length > 16) return false;
    let n = 0;
    for (const tok of toks) {
      if (CHORD.test(tok)) n++;
      else if (!FILLER.test(tok)) return false;
    }
    return n > 0;
  };
  const isTab = (l) => {
    const t = String(l);
    if (t.length < 12) return false;
    let c = 0;
    let d = 0;
    for (const ch of t) {
      if (ch === "-") d++;
      if (TABCH.indexOf(ch) !== -1) c++;
    }
    return c >= 8 && d >= 3;
  };

  const text = document.body ? document.body.innerText || "" : "";
  const lines = text.split(/\r\n|\r|\n/);
  const chordLines = lines.filter(isChord);
  const tabLines = lines.filter(isTab);

  const out = {
    url: location.hostname,
    title: document.title.slice(0, 80),
    chars: text.length,
    lines: lines.length,
    chordLines: chordLines.length,
    tabLines: tabLines.length,
    looksLikeChords: chordLines.length >= 3,
    looksLikeTab: tabLines.length >= 4,
    pre: document.querySelectorAll("pre").length,
    stores: document.querySelectorAll("[data-content]").length,
    sampleChords: chordLines.slice(0, 8),
    sampleTab: tabLines.slice(0, 4),
  };
  console.log("tab2roll page check:", out);
  console.log("first 40 lines of what the page reads as:\n" + lines.slice(0, 40).map((l, i) => String(i).padStart(3) + " | " + l).join("\n"));
  return out;
})();
