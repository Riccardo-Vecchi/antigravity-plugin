/* Shared browser-side validation; also exercised by the Node regression suite. */
((root) => {
  "use strict";
  function origin(value) {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw Error("Open a regular web page to share it.");
    return url.origin;
  }
  function editable(node) {
    const attrs = Object.fromEntries(
      (node.attributes || []).reduce((a, v, i, all) => {
        if (i % 2 === 0) a.push([v.toLowerCase(), all[i + 1]]);
        return a;
      }, []),
    );
    const tag = node.nodeName?.toUpperCase();
    if (
      /(?:^|\s)(?:current-password|new-password|one-time-code)(?:$|\s)/i.test(
        attrs.autocomplete || "",
      )
    )
      throw Error(
        "This field is excluded. Enter passwords directly in your browser.",
      );
    if (
      tag === "INPUT" &&
      !["text", "search", "email", "tel", "url", "number", ""].includes(
        (attrs.type || "").toLowerCase(),
      )
    )
      throw Error(
        "This field is excluded. Enter passwords directly in your browser.",
      );
    if (
      !["INPUT", "TEXTAREA"].includes(tag) &&
      attrs.contenteditable !== "true" &&
      attrs.contenteditable !== ""
    )
      throw Error("Choose an editable field.");
    if (Object.hasOwn(attrs, "disabled") || Object.hasOwn(attrs, "readonly"))
      throw Error("This field cannot be edited.");
    return true;
  }
  const api = { origin, editable };
  if (typeof module !== "undefined") module.exports = api;
  else root.AGPApolicy = api;
})(globalThis);
