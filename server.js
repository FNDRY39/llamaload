const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- TUNABLE QUALITY SETTINGS ----------
// "Base" viewport in CSS pixels
const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080; // 16:9
// How many device pixels per CSS pixel (2 = "retina", 3 = ultra)
const DEVICE_SCALE = 2; // effective output: 3840x2160

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

// ---------- Puppeteer: reuse a single browser ----------

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });
  }
  return browserPromise;
}

// ---------- Screenshot handler ----------

async function handleScreenshot(req, res) {
  const rawUrl = req.body.url;
  const targetUrl = normalizeUrl(rawUrl);

  if (!targetUrl) {
    return res.status(400).json({ error: "No URL provided." });
  }

  let browser;
  let page;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // High-res viewport
    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: DEVICE_SCALE,
    });

    await page.goto(targetUrl, {
      // Faster than networkidle2; still gets full layout
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    // Let above-the-fold layout & fonts settle
    await page.waitForTimeout(1200);

    const buffer = await page.screenshot({
      fullPage: false,
      type: "png", // lossless, best for UI/text
      // omitBackground: false, // leave as default
    });

    res.setHeader("Content-Type", "image/png");
    // Optional: suggest a filename for downloads
    res.setHeader("Content-Disposition", 'inline; filename="llamaload-mockup.png"');

    res.send(buffer);
  } catch (err) {
    console.error("Screenshot error for URL:", targetUrl);
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error taking screenshot: " + err.message,
      });
    }
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error("Error closing page:", e);
      }
    }
    // We intentionally do NOT close the browser; we reuse it
  }
}

// API route used by your frontend
app.post("/api/screenshot", handleScreenshot);

// Start server
app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});
