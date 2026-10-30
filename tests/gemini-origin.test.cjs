"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { classifyGuestURL } = require("../common/gemini-origin.cjs");

test("only the exact HTTPS Gemini origin receives the Gemini identity", () => {
  for (const value of [
    "https://gemini.google.com/",
    "https://GEMINI.GOOGLE.COM:443/app?q=x",
  ])
    assert.equal(classifyGuestURL(value).trusted, true);
  for (const value of [
    null,
    {},
    "",
    "not a URL",
    "http://gemini.google.com/",
    "https://gemini.google.com:444/",
    "https://gemini.google.com.example/",
    "https://gemini.google.com@evil.example/",
    "https://user:secret@gemini.google.com/",
    "https://gemini.google.com./",
    "https://gemini.google.com%2eevil.example/",
    "about:blank",
    "data:text/html,hello",
    "javascript:alert(1)",
    "file:///tmp/a",
    "blob:https://gemini.google.com/id",
    "https://gеmini.google.com/",
  ])
    assert.equal(classifyGuestURL(value).trusted, false, String(value));
});
test("identity contains no credentials, query, fragment, or page-controlled title", () => {
  assert.deepEqual(
    classifyGuestURL("https://accounts.google.com/signin?token=private#secret"),
    {
      trusted: false,
      label: "Google sign-in",
      origin: "https://accounts.google.com",
      title: "Google sign-in — https://accounts.google.com",
    },
  );
  assert.equal(
    classifyGuestURL("https://accounts.google.com.evil.test").label,
    "External website",
  );
  assert.equal(
    classifyGuestURL("https://sso.example/login?secret=1").title,
    "External website — https://sso.example",
  );
  assert.equal(classifyGuestURL("https://user:secret@sso.example").origin, "");
});
test("origin classifier works when serialized into an isolated renderer", () => {
  const result = vm.runInNewContext(
    `(${classifyGuestURL.toString()})("https://gemini.google.com/")`,
    { URL },
  );
  assert.equal(result.trusted, true);
});
