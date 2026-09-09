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

    // Reading a picture of the music (an interactive tab player, or a
    // screenshot someone dropped in). Every one of these says what was read
    // and what to do about it: a picture read is a good guess, never a
    // certainty, and pretending otherwise would be the wrong tone entirely.
    readingPicture: "Reading the sheet music on this page…",
    foundPicture: "Read the sheet music on this page:",
    pictureNotes: (notes) => `${notes} notes, read off the picture.`,
    pictureCheck: "Have a look at the numbers below before you send it — reading a picture is guesswork, and it is much quicker to fix here than in your DAW.",
    pictureUnsure: "Some of the marks were hard to make out. Check the numbers below and put right any that look wrong.",
    picturePartial: (percent) => `That's about ${percent}% of the song: the part that was on screen. Scroll the page down and open tab2roll again to read the next bit.`,
    pictureAdd: "Join this onto what I read before",
    pictureAdded: "Joined onto what you read before.",
    // Reading the rest of it. The page has to be scrolled to do this, which
    // is the only thing tab2roll ever changes about a page, so the button
    // says what it is going to do before it does it.
    wholeSong: "Read the whole song",
    wholeSongWorking: (n) => `Scrolling the page and reading it… screenful ${n}.`,
    wholeSongRead: (screenfuls) => `That's the whole song, ${screenfuls} screenfuls of it, joined up and the page put back.`,
    wholeSongNothing: "I scrolled through the page but couldn't read any more of it than what's below already.",
    pictureNoStaves: "This page draws its tab as a picture, and I couldn't make out the strings in it. Try making the page bigger (Ctrl and +) and clicking again.",
    pictureNotation: "This page is showing you notes on a stave rather than fret numbers on a tab. I can only read tab so far — look for the tab view, or one of the text tabs for this song.",
    pictureNothing: "I found the sheet music but couldn't read any fret numbers off it. Try making the page bigger (Ctrl and +) and clicking again.",
    dropPicture: "You can also drop a picture of some tab in here, or paste one.",
    dropReading: "Reading that picture…",
    dropFailed: "I couldn't find any tab in that picture. It needs to show the strings and the fret numbers, big enough to read.",

    notFound: "I couldn't find any tab on this page. Make sure you're on a tab page and that it's finished loading.",
    unsupported: "This tab is in a format I can't read yet. Try one of the text tabs for this song.",
    noNotes: "I found the tab but couldn't make sense of it. Try pasting the tab text in below and I'll have another go.",
    downloadFailed: "I made the file but Firefox couldn't save it. Check that downloads are allowed, then try again.",
    unknownError: "Something went wrong on my side. Try pasting the tab text in below and I'll have another go.",

    savedAs: (filename) => `Saved ${filename}`,
    inDownloads: "It's in your Downloads folder.",
    nextTitle: "What to do next:",
    nextSteps: "In FL Studio, choose File → Import → MIDI file and pick this file. Dragging it onto the playlist works too, when FL Studio lets you.",
    rhythmGuessed: "The timing is a best guess — you may need to nudge some notes.",
    rhythmExact: "The tab had timing in it, so the notes should already sit where they belong.",
    chordSheet: "This is a chord sheet, so I made the chords and a bassline.",
    tracksMade: (list) => `Tracks in the file: ${list}.`,
    showMeHow: "Show me how",
    dragDidNothing: "Dragged it in and nothing happened?",
    wrongTuning: "Wrong tuning? Re-do as:",
    redoing: "Making a new file…",
    convertAnother: "Convert another tab",
    recentHeading: "A moment ago you saved:",

    help: "Help",
    settings: "Settings",
    version: (number) => `Version ${number}`,
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
    how4: "In FL Studio, choose File → Import → MIDI file and pick it out of your Downloads folder. Dragging it onto the playlist works too, when FL Studio lets you.",
    privacyHeading: "Nothing leaves your computer",
    privacy: "tab2roll never sends anything anywhere. It reads the tab page you have open and saves a file to your Downloads folder. That's all it does.",
    helpLink: "Read the help page",
  },

  help: {
    title: "tab2roll help",
    intro: "tab2roll turns the guitar tab on a web page into a MIDI file you can drop into your DAW.",

    flHeading: "Getting the file into FL Studio",
    fl1: "Click \"Send to my DAW\" in tab2roll. The file is saved to your Downloads folder.",
    fl2: "Open FL Studio and choose File → Import → MIDI file from the menu at the top.",
    fl3: "Pick the file out of your Downloads folder. It is named like \"Artist - Song (tab).mid\".",
    fl4: "FL Studio asks how to bring it in. Accept what it offers, keeping \"one channel per track\" switched on.",
    fl5: "You get one channel per track — guitar, chords, bass and lead — with the notes sitting in the piano roll, ready to drop into the playlist.",
    flDragHeading: "Or drag it in",
    flDrag: "Dragging the file from your Downloads folder onto the playlist does the same job in one move. FL Studio does not always accept a dragged-in file, though, and when it refuses one it says nothing at all. If that happens, read on — the menu above always works.",
    flCaption: "Dragging the MIDI file from the Downloads folder onto the FL Studio playlist (illustration).",

    dragHeading: "Nothing happens when I drag the file in",
    drag1: "The file itself is fine — it is an ordinary MIDI file that every DAW can read. What you are seeing is FL Studio turning the drop down without a word. Watch the mouse pointer as you hold the file over the playlist: if it stays a plain rectangle, with no little arrow or plus beside it, FL Studio is not going to take the file however long you hover.",
    drag2: "FL Studio is running as an administrator (Windows). Windows will not let an ordinary file window hand files to a program with administrator rights, so the drop is blocked before FL Studio ever sees it. Right-click your FL Studio shortcut, choose Properties, open the Compatibility tab and switch off \"Run this program as an administrator\", then start FL Studio again.",
    drag3: "You have the Fruity Edition. That edition does not take files dropped onto the playlist at all. Nothing is wrong with your setup; use the File menu instead.",
    drag4: "The song name is very long. FL Studio refuses a dropped file once its name and folder together run past about 256 letters. Rename the file to something short and drag it again.",
    drag5: "In every one of those cases File → Import → MIDI file still brings the song in, whichever edition of FL Studio you have.",

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

    sheetHeading: "Tabs that are drawn, not written",
    sheet1: "Some tab pages don't have any tab text on them at all. The \"Official\" and \"Pro\" tabs on Ultimate Guitar, and interactive players like Songsterr, paint the music onto the page as a picture, the way a printed songbook does. There is nothing to copy: the notes are pixels.",
    sheet2: "Tab2roll reads those pictures. Click the toolbar button on one of those pages and it works out where the strings are, reads the fret numbers off them, and shows you the tab it made in the box under the button before anything is saved.",
    sheet3: "Check it before you send it. Reading a picture is guesswork and a number now and then comes out wrong; it is far quicker to fix a 7 that should be a 1 in that box than to hunt for it in your DAW afterwards. Tab2roll says how many marks it could not make out, and if it is unsure it says so.",
    sheet4: "A player only draws the bars that are on screen, so one click reads one screenful. \"Read the whole song\" walks the rest of it for you: it scrolls the page down a staff at a time, reads each screenful, joins them up, and puts the page back where it was. It is the only thing tab2roll ever changes about a page, and it only happens when you press that button. To do it by hand instead, scroll the page yourself, open tab2roll again, and click \"Join this onto what I read before\".",
    sheet5: "You can also drop a picture straight into the window, or paste one in: a screenshot of any tab player, a photo of a page from a songbook, a page of a PDF. The bigger and sharper the numbers are, the better it reads them — if a page comes out badly, zoom in (Ctrl and +) and try again.",
    sheet6: "It reads tablature — fret numbers on strings. Notes written on an ordinary five-line stave are a different problem and tab2roll leaves them alone rather than guessing; it will tell you that is what it found.",

    notFoundHeading: "It can't find the tab on the page",
    notFound1: "Make sure the page has finished loading. If the page shows the tab as a picture rather than as text, see \"Tabs that are drawn, not written\" above.",
    notFound2: "Some pages have neither: a video lesson, or a page that is still loading its player. Look for a plain text tab of the same song.",
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
