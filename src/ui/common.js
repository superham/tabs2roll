// Small helpers shared by the popup, options, help and onboarding pages.
// These pages are ordinary isolated extension documents (plain JS modules).

import { STRINGS, str } from "../strings.js";

export const browser = globalThis.browser ?? globalThis.chrome;

/** Fill every element carrying data-str="dotted.key" with its string. */
export function fillStrings(root = document) {
  for (const el of root.querySelectorAll("[data-str]")) {
    const text = str(el.getAttribute("data-str"));
    if (el.hasAttribute("data-str-attr")) el.setAttribute(el.getAttribute("data-str-attr"), text);
    else el.textContent = text;
  }
  const title = document.querySelector("title[data-str]");
  if (title) document.title = str(title.getAttribute("data-str"));
}

// --------------------------------------------------------------------------
// Storage. localStorage is shared by every page of the extension (they all
// have the same moz-extension:// origin) and needs no extra permission.
// Every access is wrapped: a page must still work if storage is unavailable.
// --------------------------------------------------------------------------

const PREFIX = "tab2roll:";

export function readStore(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn("[tab2roll] could not save to storage", err);
    return false;
  }
}

/** Options with their defaults. The happy path never needs these changed. */
export const DEFAULT_OPTIONS = Object.freeze({ step: "1/8", arrange: true });

export function getOptions() {
  const stored = readStore("options", {});
  return { ...DEFAULT_OPTIONS, ...(stored && typeof stored === "object" ? stored : {}) };
}

export function setOptions(options) {
  return writeStore("options", { ...DEFAULT_OPTIONS, ...options });
}

/** The last successful conversion, so the popup can show it again. */
export const LAST_RESULT_TTL_MS = 5 * 60 * 1000;

export function getLastResult() {
  const last = readStore("lastResult", null);
  if (!last || typeof last !== "object" || typeof last.at !== "number") return null;
  if (Date.now() - last.at > LAST_RESULT_TTL_MS) return null;
  return last;
}

export function setLastResult(result) {
  return writeStore("lastResult", result ? { ...result, at: Date.now() } : null);
}

/**
 * The last tab read off a picture, so a second look at the same page can be
 * joined onto the first. A tab player only draws the bars that are on screen,
 * so reading a whole song means reading it a screenful at a time.
 */
export const PICTURE_READ_TTL_MS = 30 * 60 * 1000;

export function getPictureRead(url) {
  const read = readStore("pictureRead", null);
  if (!read || typeof read !== "object" || typeof read.at !== "number") return null;
  if (Date.now() - read.at > PICTURE_READ_TTL_MS) return null;
  if (url && read.url && read.url !== url) return null;
  return read;
}

export function setPictureRead(read) {
  return writeStore("pictureRead", read ? { ...read, at: Date.now() } : null);
}

/**
 * The installed version, straight from the manifest, so what the popup shows
 * can never drift from what is actually running. Useful when checking that a
 * reload of the add-on took effect.
 */
export function getVersion() {
  try {
    const manifest = browser.runtime.getManifest();
    return manifest && manifest.version ? String(manifest.version) : "";
  } catch (err) {
    console.warn("[tab2roll] could not read the version", err);
    return "";
  }
}

/** Open one of the bundled pages in a new tab. */
export async function openPage(path) {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL(path) });
  } catch (err) {
    console.error("[tab2roll] could not open page", path, err);
    window.open(path, "_blank");
  }
}

export { STRINGS, str };
