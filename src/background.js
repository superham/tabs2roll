// Background event page (Firefox MV3: non-persistent, plain script).
//
// Jobs:
//   1. On first install, open the onboarding page that shows how to pin the
//      toolbar button — the mitigation that makes a popup-only design work.
//   2. Turn tab text into a MIDI file and save it to the Downloads folder.
//      The popup asks for this by message, because a popup closes as soon
//      as it loses focus and a download started from a popup's blob URL can
//      die with it. This page lives long enough to finish the job.
//
// This file is a classic script (not a module) so it loads on every Firefox
// that supports MV3; the pure conversion modules are pulled in with a
// dynamic import() the first time they are needed.
//
// Zero network requests, by design. Nothing in here fetches anything.

/* global globalThis */
const browser = globalThis.browser ?? globalThis.chrome;

const ONBOARDING_PAGE = "ui/onboarding.html";
const DOWNLOAD_TIMEOUT_MS = 30000;

browser.runtime.onInstalled.addListener((details) => {
  if (details && details.reason === "install") {
    browser.tabs.create({ url: browser.runtime.getURL(ONBOARDING_PAGE) }).catch((err) => console.error("[tab2roll] could not open onboarding page", err));
  }
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (!message || typeof message !== "object") return undefined;
  if (sender && sender.id && browser.runtime.id && sender.id !== browser.runtime.id) return undefined;
  if (message.type === "tab2roll:convert") return handleConvert(message);
  return undefined;
});

/**
 * message: { type, text, meta: { source, title, artist, tempo, capo }, options: { tuningId, step, arrange, filenameSuffix } }
 * reply:   { ok: true, filename, ...summary } or { ok: false, code }
 * Codes: "no-tab", "no-notes", "download-failed", "unknown". The popup maps
 * every code to plain language; nothing raw ever reaches the user.
 */
async function handleConvert(message) {
  let pipeline;
  try {
    pipeline = await import("./pipeline.js");
  } catch (err) {
    console.error("[tab2roll] could not load the conversion code", err);
    return { ok: false, code: "unknown" };
  }
  let result;
  try {
    const meta = message.meta || {};
    const options = message.options || {};
    result = pipeline.convertText(String(message.text || ""), {
      source: meta.source || "paste",
      title: meta.title || undefined,
      artist: meta.artist || undefined,
      tempo: meta.tempo || undefined,
      capo: typeof meta.capo === "number" ? meta.capo : undefined,
      tuningText: typeof meta.tuning === "string" ? meta.tuning : undefined,
      tuningId: options.tuningId || undefined,
      step: options.step || undefined,
      arrange: options.arrange !== false,
      filenameSuffix: options.filenameSuffix || "",
    });
  } catch (err) {
    if (err && err.name === "ParseError") {
      console.warn("[tab2roll] nothing to convert:", err.code);
      return { ok: false, code: err.code };
    }
    console.error("[tab2roll] conversion failed", err);
    return { ok: false, code: "unknown" };
  }
  try {
    const savedAs = await saveToDownloads(result.bytes, result.filename);
    return { ok: true, filename: savedAs || result.filename, ...result.summary };
  } catch (err) {
    console.error("[tab2roll] download failed", err);
    return { ok: false, code: "download-failed" };
  }
}

/** Save bytes to the Downloads folder. Resolves with the final file name. */
async function saveToDownloads(bytes, filename) {
  const blob = new Blob([bytes], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  try {
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        browser.downloads.onChanged.removeListener(onChanged);
        resolve(null); // small file; assume it made it
      }, DOWNLOAD_TIMEOUT_MS);
      let watchedId = null;
      function onChanged(delta) {
        if (watchedId === null || delta.id !== watchedId || !delta.state) return;
        if (delta.state.current === "complete") {
          clearTimeout(timer);
          browser.downloads.onChanged.removeListener(onChanged);
          resolve(watchedId);
        } else if (delta.state.current === "interrupted") {
          clearTimeout(timer);
          browser.downloads.onChanged.removeListener(onChanged);
          reject(new Error("download interrupted"));
        }
      }
      browser.downloads.onChanged.addListener(onChanged);
      browser.downloads
        .download({ url, filename, conflictAction: "uniquify", saveAs: false })
        .then(async (id) => {
          watchedId = id;
          // It may already be done (tiny file) before the listener saw it.
          const [item] = await browser.downloads.search({ id });
          if (item && item.state === "complete") {
            clearTimeout(timer);
            browser.downloads.onChanged.removeListener(onChanged);
            resolve(id);
          } else if (item && item.state === "interrupted") {
            clearTimeout(timer);
            browser.downloads.onChanged.removeListener(onChanged);
            reject(new Error("download interrupted"));
          }
        })
        .catch((err) => {
          clearTimeout(timer);
          browser.downloads.onChanged.removeListener(onChanged);
          reject(err);
        });
    });
    const id = await finished;
    if (id === null) return null;
    const [item] = await browser.downloads.search({ id });
    return item && item.filename ? basename(item.filename) : null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function basename(path) {
  const parts = String(path).split(/[\\/]/);
  return parts[parts.length - 1] || null;
}
