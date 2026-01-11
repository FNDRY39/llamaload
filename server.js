const express = require("express");
const path = require('path');
const fs = require('fs'); 
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- VIEWPORT / TIMING CONFIG ----------

// Desktop capture
const DESKTOP_VIEWPORT = {
  width: 1920,
  height: 1080,
  deviceScaleFactor: 3,
};

// Mobile-ish capture for vertical / phone previews
const MOBILE_VIEWPORT = {
  width: 430,
  height: 800,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

const NAVIGATION_TIMEOUT = 15000; // ms
const EXTRA_LAYOUT_WAIT = 600;    // ms


// Pretty URLs for the main pages (no .html in the URL)

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Generic handler: /mockup -> public/mockup.html, /snapshot -> public/snapshot.html, etc.
app.get('/:page', (req, res, next) => {
  const page = req.params.page;
  const filePath = path.join(__dirname, 'public', `${page}.html`);

  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }

  // If no matching HTML file, pass to the next route (like static files or 404)
  return next();
});

// ---------- EXPRESS MIDDLEWARE ----------

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------- HELPERS ----------

function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

// Reuse a single browser instance
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

// Version-safe wait helper (supports old/new Puppeteer)
async function waitForPage(page, ms) {
  if (page && typeof page.waitForTimeout === "function") {
    return page.waitForTimeout(ms);
  }
  if (page && typeof page.waitFor === "function") {
    return page.waitFor(ms);
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Core screenshot helper used by mockup + social + snapshot
async function captureScreenshot(rawUrl, options = {}) {
  const {
    fullPage = false,
    mobile = false, // true = mobile viewport
  } = options;

  const targetUrl = normalizeUrl(rawUrl);
  if (!targetUrl) {
    throw new Error("No URL provided.");
  }

  let browser;
  let page;

  try {
    browser = await getBrowser();
    page = await browser.newPage();

    // Timeouts
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT);

    // Keep things snappy: block fonts/media + trackers
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

    // Viewport / user agent
    if (mobile) {
      console.log("→ Using MOBILE viewport");
      await page.setViewport(MOBILE_VIEWPORT);
      const ua =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) " +
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 " +
        "Mobile/15E148 Safari/604.1";
      await page.setUserAgent(ua);
    } else {
      console.log("→ Using DESKTOP viewport");
      await page.setViewport(DESKTOP_VIEWPORT);
    }

    console.log(`Navigating to: ${targetUrl} mobile: ${mobile}`);

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    // Let above-the-fold layout settle
    await waitForPage(page, EXTRA_LAYOUT_WAIT);

    const buffer = await page.screenshot({
      fullPage,
      type: "png",
    });

    return buffer;
  } catch (err) {
    console.error("Screenshot error for URL:", targetUrl);
    console.error(err);
    throw err;
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

// ---------- ROUTE: /api/screenshot (mockup + social) ----------
//
// Used by:
// - mockup.html (no format → desktop top-of-page)
// - social.html  (sends `format` and possibly `mobile`)

async function handleScreenshot(req, res) {
  const rawUrl = req.body.url;
  const format = req.body.format || "(none)";

  // Normalise mobile flag from body
  const mobileFlag = (req.body.mobile || "").toString().toLowerCase();
  const explicitMobile =
    mobileFlag === "true" || mobileFlag === "1" || mobileFlag === "yes";

  // Infer "mobile" from card format if the frontend doesn’t send mobile
  const isVerticalFormat =
    format === "portrait" ||
    format === "vertical" ||
    format === "phone" ||
    format === "mobile";

  const useMobile = explicitMobile || isVerticalFormat;

  console.log("Screenshot request:", {
    url: rawUrl,
    format,
    mobile: useMobile,
  });

  if (!rawUrl) {
    return res.status(400).json({ error: "No URL provided." });
  }

  try {
    const buffer = await captureScreenshot(rawUrl, {
      fullPage: false,
      mobile: useMobile,
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader(
      "Content-Disposition",
      'inline; filename="llamaload-mockup.png"'
    );
    res.send(buffer);
  } catch (err) {
    console.error("Screenshot error for URL:", rawUrl);
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error taking screenshot: " + err.message,
      });
    }
  }
}

// ---------- ROUTE: /api/brand-snapshot / /api/snapshot ----------
//
// Used by snapshot.html (brand snapshot)

async function handleBrandSnapshot(req, res) {
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

    // Narrower viewport for brand snapshot
    await page.setViewport({
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
    });

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT,
    });

    await waitForPage(page, EXTRA_LAYOUT_WAIT);

    const screenshotBuffer = await page.screenshot({
      fullPage: false,
      type: "png",
    });

    const meta = await page.evaluate(() => {
      const getMeta = (name) =>
        document
          .querySelector(`meta[name="${name}"]`)
          ?.getAttribute("content") || "";

      const getOG = (property) =>
        document
          .querySelector(`meta[property="${property}"]`)
          ?.getAttribute("content") || "";

      const title =
        document.querySelector("title")?.innerText ||
        getOG("og:title") ||
        getMeta("twitter:title") ||
        "";

      const description =
        getMeta("description") ||
        getOG("og:description") ||
        getMeta("twitter:description") ||
        "";

      const linkEl =
        document.querySelector('link[rel="icon"]') ||
        document.querySelector('link[rel="shortcut icon"]') ||
        document.querySelector('link[rel="apple-touch-icon"]');

      const favicon = linkEl ? linkEl.href : "";

      const colorsSet = new Set();

      function addColor(c) {
        if (!c) return;
        const val = c.trim();
        if (!val) return;
        colorsSet.add(val);
      }

      try {
        const bodyStyle = window.getComputedStyle(document.body);
        addColor(bodyStyle.backgroundColor);
        addColor(bodyStyle.color);
      } catch (e) {}

      document.querySelectorAll("a, button, h1, h2, h3").forEach((el) => {
        try {
          const s = window.getComputedStyle(el);
          addColor(s.color);
          addColor(s.backgroundColor);
        } catch (e) {}
      });

      const fontSet = new Set();
      document.querySelectorAll("body, h1, h2, h3, p, a, button").forEach(
        (el) => {
          try {
            const s = window.getComputedStyle(el);
            if (s.fontFamily) {
              fontSet.add(s.fontFamily);
            }
          } catch (e) {}
        }
      );

      return {
        title,
        description,
        favicon,
        colors: Array.from(colorsSet).slice(0, 8),
        fonts: Array.from(fontSet).slice(0, 5),
      };
    });

    const screenshotBase64 = screenshotBuffer.toString("base64");

    res.json({
      url: targetUrl,
      screenshot: `data:image/png;base64,${screenshotBase64}`,
      title: meta.title,
      description: meta.description,
      favicon: meta.favicon,
      colors: meta.colors,
      fonts: meta.fonts,
    });
  } catch (err) {
    console.error("Brand snapshot error for URL:", targetUrl);
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error generating brand snapshot: " + err.message,
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
  }
}

// ---------- ROUTES ----------

app.post("/api/screenshot", handleScreenshot);
app.post("/api/brand-snapshot", handleBrandSnapshot);
app.post("/api/snapshot", handleBrandSnapshot);

// ---------- START SERVER ----------

app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});