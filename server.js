const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- DESKTOP VIEWPORT (mockup, snapshot, social landscape) ----------
const DESKTOP_VIEWPORT_WIDTH = 1920;
const DESKTOP_VIEWPORT_HEIGHT = 1080; // 16:9
const DESKTOP_DEVICE_SCALE = 3;

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

// ---------- Core capture helper ----------
async function captureScreenshot(targetUrl, { mobile = false } = {}) {
  let browser;
  let page;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);

    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      const type = request.resourceType();

      if (type === "font" || type === "media") {
        return request.abort();
      }

      if (
        /google-analytics\.com|gtag\/js|doubleclick\.net|googletagmanager\.com|facebook\.com\/tr|hotjar\.com|mixpanel\.com|segment\.com/i.test(
          url
        )
      ) {
        return request.abort();
      }

      request.continue();
    });

    if (mobile) {
      // TRUE MOBILE VIEW
      const devices = puppeteer.devices || {};
      const iPhoneDevice =
        devices["iPhone 12"] ||
        devices["iPhone 13"] ||
        devices["iPhone X"] ||
        null;

      if (iPhoneDevice) {
        console.log("→ Using MOBILE emulation:", iPhoneDevice.name);
        await page.emulate(iPhoneDevice);
      } else {
        console.log("→ Using MOBILE viewport fallback");
        await page.setUserAgent(
          "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 " +
            "Mobile/15E148 Safari/604.1"
        );
        await page.setViewport({
          width: 430,
          height: 932,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
      }
    } else {
      console.log("→ Using DESKTOP viewport");
      await page.setViewport({
        width: DESKTOP_VIEWPORT_WIDTH,
        height: DESKTOP_VIEWPORT_HEIGHT,
        deviceScaleFactor: DESKTOP_DEVICE_SCALE,
      });
    }

    console.log("Navigating to:", targetUrl, "mobile:", mobile);
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    await page.waitForTimeout(EXTRA_LAYOUT_WAIT);

    const buffer = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    return buffer;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error("Error closing page:", e);
      }
    }
  }
}

// ---------- Single screenshot endpoint ----------
async function handleScreenshot(req, res) {
  const targetUrl = normalizeUrl(req.body.url);
  if (!targetUrl) {
    return res.status(400).json({ error: "No URL provided." });
  }

  const format = (req.body.format || "").toLowerCase();
  const mobile = format === "vertical"; // ONLY vertical social uses mobile
  console.log("Screenshot request:", {
    url: targetUrl,
    format: format || "(none)",
    mobile,
  });

  try {
    const buffer = await captureScreenshot(targetUrl, { mobile });
    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="llamaload-screenshot.png"'
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
  }
}

app.post("/api/screenshot", handleScreenshot);

app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});