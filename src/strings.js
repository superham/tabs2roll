// Every user-facing string in the extension lives here so the tone can be
// reviewed in one place. UI code never contains string literals shown to
// the user.
//
// House rules for this file (checked by test/strings.test.js):
//   - Plain language for guitarists. Say "tab", "notes", "timing", "file",
//     "Downloads folder", "DAW", "FL Studio".
//   - Never say: parse, parser, IR, JSON, schema, tick, PPQ, serialize,
//     export, validate, null, undefined, config.
//   - Every failure message says what happened AND what to do next.

export const STRINGS = {
  appName: "tab2roll",
  tagline: "Turns the guitar tab on this page into a MIDI file for your DAW.",

  popup: {
    checking: "Looking for tab on this page…",
    foundTab: "Found a tab:",
    foundChords: "Found a chord sheet:",
    foundUntitled: "this page",
    mainButton: "Send to my DAW",
    mainSubtext: "Downloads a MIDI file.",
    mainSubtextPaste: "Uses the tab you pasted below.",
    working: "Saving…",

    pasteLabel: "Or paste tab text here.",
    pastePlaceholder: "Paste the whole tab, including the lines of dashes.",
    pasteLooksLikeTab: "That looks like a tab. Ready when you are.",
    pasteLooksLikeChords: "That looks like a chord sheet. Ready when you are.",
    pasteNotYet: "I can't see any tab in that yet. Paste the whole thing, including the lines of dashes.",

    notFound: "I couldn't find any tab on this page. Make sure you're on a tab page and that it's finished loading.",
    unsupported: "This tab is in a format I can't read yet. Try one of the text tabs for this song.",
    noNotes: "I found the tab but couldn't make sense of it. Try pasting the tab text in below and I'll have another go.",
    downloadFailed: "I made the file but Firefox couldn't save it. Check that downloads are allowed, then try again.",
    unknownError: "Something went wrong on my side. Try pasting the tab text in below and I'll have another go.",

    savedAs: (filename) => `Saved ${filename}`,
    inDownloads: "It's in your Downloads folder.",
    nextTitle: "What to do next:",
    nextSteps: "Open FL Studio, then drag this file from your Downloads folder onto the playlist.",
    rhythmGuessed: "The timing is a best guess — you may need to nudge some notes.",
    rhythmExact: "The tab had timing in it, so the notes should already sit where they belong.",
    chordSheet: "This is a chord sheet, so I made the chords and a bassline.",
    tracksMade: (list) => `Tracks in the file: ${list}.`,
    showMeHow: "Show me how",
    wrongTuning: "Wrong tuning? Re-do as:",
    redoing: "Making a new file…",
    convertAnother: "Convert another tab",
    recentHeading: "A moment ago you saved:",

    help: "Help",
    settings: "Settings",
  },

  tunings: {
    standard: "Standard (E A D G B E)",
    "drop-d": "Drop D",
    "eb-standard": "Eb standard (half step down)",
    "d-standard": "D standard (whole step down)",
    dadgad: "DADGAD",
    "open-g": "Open G",
    "open-d": "Open D",
    custom: "As written in the tab",
  },

  onboarding: {
    title: "tab2roll is ready",
    intro: "One quick thing so you can actually find it in Firefox:",
    pinHeading: "Pin tab2roll to your toolbar",
    step1: "Click the puzzle-piece Extensions button at the top right of Firefox.",
    step2: "Find tab2roll in the list and click the gear next to it.",
    step3: "Choose \"Pin to Toolbar\". The tab2roll icon now stays in your toolbar.",
    figureCaption: "Where the Extensions button and the pin option live (illustration).",
    howHeading: "How to use it",
    how1: "Open a guitar tab page, for example on Ultimate Guitar.",
    how2: "Click the tab2roll icon in your toolbar.",
    how3: "Click \"Send to my DAW\". A MIDI file lands in your Downloads folder.",
    how4: "Open FL Studio and drag the file from your Downloads folder onto the playlist.",
    privacyHeading: "Nothing leaves your computer",
    privacy: "tab2roll never sends anything anywhere. It reads the tab page you have open and saves a file to your Downloads folder. That's all it does.",
    helpLink: "Read the help page",
  },

  help: {
    title: "tab2roll help",
    intro: "tab2roll turns the guitar tab on a web page into a MIDI file you can drop into your DAW.",

    flHeading: "Getting the file into FL Studio",
    fl1: "Click \"Send to my DAW\" in tab2roll. The file is saved to your Downloads folder.",
    fl2: "Open FL Studio and open the playlist (F5).",
    fl3: "Open your Downloads folder in a file window.",
    fl4: "Drag the file, named like \"Artist - Song (tab).mid\", onto the playlist.",
    fl5: "FL Studio asks how to import it. Accept the defaults and you get one pattern per track: guitar, chords, bass and lead.",
    flCaption: "Dragging the MIDI file from the Downloads folder onto the FL Studio playlist (illustration).",

    otherDawHeading: "Other DAWs",
    otherDaw: "Every DAW can open a standard MIDI file. Look for \"Import MIDI\" in the File menu, or drag the file from your Downloads folder into an empty spot of the arrangement.",

    whereHeading: "Where's my file?",
    where: "In your Downloads folder. It is named after the song, for example \"Artist - Song (tab).mid\". If tab2roll couldn't tell the song's name it is called \"guitar-tab.mid\".",

    tracksHeading: "What's in the file?",
    tracksIntro: "Up to four tracks:",
    tracksGuitar: "Guitar (as tabbed): every note from the tab, exactly as written.",
    tracksChords: "Chords: a clean pad voicing of every chord the tab strums.",
    tracksBass: "Bass: the lowest note of every chord, in a bass register.",
    tracksLead: "Lead: the single-note melodies and solos.",
    tracksEmpty: "A track is left out when the tab has nothing for it.",

    timingHeading: "The timing sounds off",
    timing1: "Plain-text tab has no timing in it, so tab2roll makes a best guess: evenly spaced notes become evenly spaced eighth notes, and bar lines line up with bars.",
    timing2: "If everything sounds twice as fast or twice as slow, open Settings and change the timing step, then send the tab again.",
    timing3: "Anything else you can nudge in the piano roll, which is usually quicker than fighting with the tab.",

    tuningHeading: "The notes are wrong",
    tuning1: "Most often the tab is in a different tuning than tab2roll guessed. Right after a conversion the window shows \"Wrong tuning? Re-do as:\" — pick the right one and a new file is saved.",
    tuning2: "Tab2roll reads tuning hints in the tab (\"Tuning: Drop D\", \"half step down\", the letters at the start of each line) and the capo, if the tab mentions one.",

    notFoundHeading: "It can't find the tab on the page",
    notFound1: "Make sure the page has finished loading and that it shows the tab as text, not as a picture or an interactive player.",
    notFound2: "Some tab pages (\"Official\", \"Pro\", \"Guitar Pro\" tabs) are not text and can't be read. Look for a plain text tab of the same song.",
    notFound3: "You can always select the tab text on the page, copy it, and paste it into the box under the button. That works on any site, forum, or PDF.",

    pasteHeading: "Pasting a tab",
    paste1: "Click \"Or paste tab text here.\" under the main button, paste the whole tab including the lines of dashes, and click \"Send to my DAW\".",
    paste2: "Chord sheets work too: paste the chords-and-lyrics text and you get the chords and a bassline.",

    privacyHeading: "Privacy",
    privacy: "tab2roll makes no network requests, has no account, and collects nothing. It reads the page you clicked it on and writes one file to your Downloads folder.",

    backToTop: "Back to top",
  },

  options: {
    title: "tab2roll settings",
    intro: "You don't have to change anything here. tab2roll works out of the box.",
    stepHeading: "Timing",
    stepLabel: "How long is one step in the tab?",
    stepEighth: "An eighth note (works for most tabs)",
    stepQuarter: "A quarter note (slow, sparse tabs)",
    stepSixteenth: "A sixteenth note (fast riffs and solos)",
    stepHint: "Tab2roll treats the usual gap between notes in a tab as one step. Change this if every file comes out too fast or too slow.",
    tracksHeading: "Extra tracks",
    arrangeLabel: "Also make chords, bass and lead tracks",
    arrangeHint: "Turn this off to get only the guitar track, exactly as tabbed.",
    saved: "Saved.",
    resetButton: "Back to defaults",
  },
};

/** Look up a dotted key like "popup.mainButton". Returns "" for unknown keys. */
export function str(key) {
  const value = key.split(".").reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), STRINGS);
  return typeof value === "string" ? value : "";
}
