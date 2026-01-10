const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- QUALITY / SPEED TUNING ----------

// High-res but not insane
const VIEWPORT_WIDTH = 1440;
const VIEWPORT_HEIGHT = 810;    // 16:9
const DEVICE_SCALE = 2;         // effective 2880x1620

// Timeouts (in ms)
const NAVIGATION_TIMEOUT = 15000;
const EXTRA_LAYOUT_WAIT = 600;  // small pause after DOM ready

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

    // Block heavy / non-essential resources to speed things up
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const type = request.resourceType();

      // Block fonts and media (big, not critical for layout)
      if (type === "font" || type === "media") {
        return request.abort();
      }

      // Block common analytics / ad trackers
      if (
        /google-analytics\.com|gtag\/js|doubleclick\.net|googletagmanager\.com|facebook\.com\/tr|hotjar\.com|mixpanel\.com|segment\.com/i.test(
          url
        )
      ) {
        return request.abort();
      }

      // Otherwise, let it load
      request.continue();
    });

    // High-res viewport
    await page.setViewport({
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      deviceScaleFactor: DEVICE_SCALE,
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded", // don't wait for every tiny request
      timeout: NAVIGATION_TIMEOUT,
    });

    // Let above-the-fold layout settle
    await page.waitForTimeout(EXTRA_LAYOUT_WAIT);

    const buffer = await page.screenshot({
      fullPage: false,
      type: "png", // best for UI/text
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
    // Do NOT close the browser; we reuse it across requests
  }
}

// API route used by your frontend
app.post("/api/screenshot", handleScreenshot);

// Start server
app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});
