"use strict";
const fs = require("node:fs/promises");

/** Load once on demand, sharing concurrent reads and retrying after failure.
 * @param {string} file
 * @param {(file: string, encoding: 'utf8') => Promise<string>} read
 */
function createViewerBundleLoader(
  file,
  read = (file, encoding) => fs.readFile(file, encoding),
) {
  /** @type {Promise<string> | undefined} */
  let cached;
  return () => {
    if (!cached) {
      cached = Promise.resolve()
        .then(() => read(file, "utf8"))
        .catch((error) => {
          cached = undefined;
          throw error;
        });
    }
    return cached;
  };
}
module.exports = { createViewerBundleLoader };
