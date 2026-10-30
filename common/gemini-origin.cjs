"use strict";

/** Classify only browser-parsed origins, never page titles or URL substrings.
 * This helper is also serialized into the native renderer; keep it closure-free.
 * @param {unknown} value
 */
function classifyGuestURL(value) {
  const unknown = {
    trusted: false,
    label: "Web page",
    origin: "",
    title: "Web page",
  };
  if (typeof value !== "string" || value.length > 32768) return unknown;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return unknown;
    if (url.origin === "https://gemini.google.com")
      return {
        trusted: true,
        label: "Google Gemini",
        origin: url.origin,
        title: "Google Gemini",
      };
    const label = [
      "https://accounts.google.com",
      "https://myaccount.google.com",
      "https://consent.google.com",
    ].includes(url.origin)
      ? "Google sign-in"
      : "External website";
    return {
      trusted: false,
      label,
      origin: url.origin,
      title: `${label} — ${url.origin}`,
    };
  } catch {
    return unknown;
  }
}

module.exports = { classifyGuestURL };
