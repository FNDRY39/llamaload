const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- 4K-STYLE QUALITY / SPEED TUNING ----------
//
// CSS viewport: 1920x1080 -> "normal 1080p desktop browser"
// Device scale: 2          -> effective 3840x2160 (4K-ish)
//
// This gives you:
// - Same zoom / layout as a typical full HD display
// - 4K-level pixel density for a very sharp screenshot

const VIEWPORT_WIDTH = 1920;
const VIEWPORT_HEIGHT = 1080;   // 16:9
const DEVICE_SCALE = 3;

// Timeouts (in ms)
const NAVIGATION_TIMEOUT = 15000;
const EXTRA_LAYOUT_WAIT = 600;

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

    // Set timeouts
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);

    // Optional: block heavy / non-essential resources to keep it faster
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const type = request.resourceType();

      // Block fonts and media (big, not needed for layout)
      if (type === "font" || type === "media") {
        return request.abort();
      }

      // Block common analytics / ad / tracking
      if (
        /google-analytics\.com|gtag\/js|doubleclick\.net|googletagmanager\.com|facebook\.com\/tr|hotjar\.com|mixpanel\.com|segment\.com/i.test(
          url
        )
      ) {
        return request.abort();
      }

      request.continue();
    });

    // 4K-style viewport: 1920x1080 CSS, 2x pixel density -> 3840x2160 output
    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: DEVICE_SCALE,
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded", // faster than networkidle2
      timeout: NAVIGATION_TIMEOUT,
    });

    // Let above-the-fold layout settle
    await page.waitForTimeout(EXTRA_LAYOUT_WAIT);

    const buffer = await page.screenshot({
      fullPage: false,
      type: "png", // lossless, best for UI/text
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="llamaload-mockup.png"'
    );
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
    // Do NOT close the browser; we reuse it
  }
}

// API route used by your frontend
app.post("/api/screenshot", handleScreenshot);

// Start server
app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});
