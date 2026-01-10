const { join } = require("path");

/** @type {import("puppeteer").Configuration} */
module.exports = {
  // Store Chromium inside the project so Render bundles it
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
};
