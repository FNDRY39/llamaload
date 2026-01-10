const express = require("express");
const path = require("path");
const puppeteer = require("puppeteer");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Normalize user input into a valid URL
function normalizeUrl(input) {
  if (!input) return null;
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }
  return url;
}

// ---------- Puppeteer: reuse one browser for speed ----------

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

    // Higher-res viewport for sharper output in your mockup
    await page.setViewport({
      width: 1440,          // base frame width
      height: 810,          // 16:9
      deviceScaleFactor: 2, // retina-style; output is effectively 2880x1620
    });

    // Faster navigation: don't wait forever on ads/trackers
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });

    // Small pause to let above-the-fold layout settle
    await page.waitForTimeout(1000);

    const buffer = await page.screenshot({
      fullPage: false,
      type: "png",          // best visual quality for UI; switch to jpeg if you want smaller files
    });

    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error("Screenshot error for URL:", targetUrl);
    console.error(err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({ error: "Error taking screenshot: " + err.message });
    }
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        console.error("Error closing page:", e);
      }
    }
    // Do NOT close the browser here; we reuse it across requests
  }
}

// API route used by your frontend
app.post("/api/screenshot", handleScreenshot);

// Start server
app.listen(PORT, () => {
  console.log(`llamaload running on port ${PORT}`);
});
