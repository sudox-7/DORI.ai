import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";

async function clickIfVisible(locator, timeout = 800) {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
    await locator.first().click({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitAdsGone(page, maxWaitMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const adShowing = await page
      .locator("#movie_player.ad-showing, .ad-showing")
      .count()
      .catch(() => 0);
    if (!adShowing) return true;
    await page.waitForTimeout(250).catch(() => {});
  }
  return false;
}

async function fastSkipAds(page, maxWaitMs = 45000) {
  // ✅ your REAL skip button
  const skipBtn = page.locator("div.ytp-skip-ad button.ytp-skip-ad-button");

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (page.isClosed()) return false;

    const adShowing = await page
      .locator("#movie_player.ad-showing, .ad-showing")
      .count()
      .catch(() => 0);
    if (!adShowing) return false;

    try {
      if (await skipBtn.first().isVisible({ timeout: 250 })) {
        await skipBtn.first().click({ force: true, timeout: 1000 });
        if (await waitAdsGone(page, 8000)) return true;

        await page.waitForTimeout(200).catch(() => {});
        await skipBtn.first().click({ force: true, timeout: 1000 });
        if (await waitAdsGone(page, 8000)) return true;
      }
    } catch {}

    await page.waitForTimeout(200).catch(() => {});
  }
  return false;
}

async function setQuality1080p(page) {
  const settingsBtn = page.locator("button.ytp-settings-button");
  const opened = await clickIfVisible(settingsBtn, 2500);
  if (!opened) return false;

  const qualityItem = page.locator(".ytp-menuitem", { hasText: /quality/i });
  const qOpen = await clickIfVisible(qualityItem, 2000);
  if (!qOpen) {
    await page.keyboard.press("Escape").catch(() => {});
    return false;
  }

  const opt1080 = page.locator(".ytp-menuitem", { hasText: /1080p/i }).first();
  const did = await clickIfVisible(opt1080, 2000);

  await page.keyboard.press("Escape").catch(() => {});
  return did;
}

async function videoFullscreen(page) {
  const fsBtn = page.locator("button.ytp-fullscreen-button");
  const ok = await clickIfVisible(fsBtn, 4000);
  if (!ok) await page.keyboard.press("f").catch(() => {});
  await page.waitForTimeout(800).catch(() => {});
}

// ✅ UPDATED: watcher stops cleanly when page/browser closes
async function startAdWatcher(page, intervalMs = 2000) {
  let stopped = false;

  const loop = async () => {
    while (!stopped) {
      try {
        if (page.isClosed()) break;

        // quick attempt, don't block too long
        await fastSkipAds(page, 2500);
      } catch {
        break; // page closed / context closed
      }

      try {
        if (page.isClosed()) break;
        await page.waitForTimeout(intervalMs);
      } catch {
        break;
      }
    }
  };

  loop(); // fire-and-forget
  return () => {
    stopped = true;
  };
}

/**
 * YouTube Skill
 */
export default async function youtubeSkill(opts = {}) {
  const {
    query,
    outDir = process.cwd(),
    screenshotName = "yt_fullscreen_1080p.png",
    browserFullscreen = true,
    playerFullscreen = true,
    set1080p = true,
    keepOpen = true,
    watchAds = true,
  } = opts;

  if (!query || typeof query !== "string") {
    throw new Error("youtubeSkill: 'query' is required (string).");
  }

  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();

  await page.goto("https://www.youtube.com", { waitUntil: "domcontentloaded" });

  // consent if any
  await clickIfVisible(page.getByRole("button", { name: /accept all/i }), 2000);
  await clickIfVisible(page.getByRole("button", { name: /i agree/i }), 2000);
  await clickIfVisible(page.getByRole("button", { name: /^agree$/i }), 2000);

  // search
  const searchBox = page.locator("input#search, input[name='search_query']").first();
  await searchBox.waitFor({ state: "visible", timeout: 30000 });
  await searchBox.fill(query);
  await page.keyboard.press("Enter");

  // open first video
  const firstVideo = page.locator("ytd-video-renderer a#thumbnail").first();
  await firstVideo.waitFor({ state: "visible", timeout: 30000 });
  await firstVideo.click();

  // wait player/video
  await page.locator("#movie_player").waitFor({ state: "visible", timeout: 30000 });
  await page.locator("#movie_player video.html5-main-video").first().waitFor({
    state: "visible",
    timeout: 30000,
  });

  // browser fullscreen (monitor)
  if (browserFullscreen) {
    await page.keyboard.press("F11").catch(() => {});
    await page.waitForTimeout(700).catch(() => {});
  }

  // skip first ad
  await fastSkipAds(page, 45000);
  await waitAdsGone(page, 45000);

  // set quality
  if (set1080p) await setQuality1080p(page);

  // player fullscreen
  if (playerFullscreen) await videoFullscreen(page);

  // start watching future ads
  let stopWatcher = null;
  if (watchAds) stopWatcher = await startAdWatcher(page);

  const result = {
    ok: true,
    query,
    note: "Browser kept open for watching.",
    message: "Video is running and working well without logging by itself."
  };

  // Return immediately with success info, keep browser open in background
  // Don't wait for browser to close
  return result;
}