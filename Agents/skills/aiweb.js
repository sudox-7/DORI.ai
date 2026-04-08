import { chromium } from "playwright";
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";

const execAsync = promisify(exec);

const CDP_URL = process.env.DORI_CDP_URL || "http://127.0.0.1:9222";
const DORI_PROFILE_DIR =
  process.env.DORI_CHROME_PROFILE ||
  path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "DoriChromeProfile"
  );

let browser = null;
let context = null;
let usingRealChrome = false;
let ownsBrowserSession = false;

// ONE lock per provider — no two calls ever run at the same time
const providerLocks = new Map();

// ─── Provider configs — all use the SAME interaction logic ───────────────────
const PROVIDERS = {
  chatgpt: {
    url: "https://chatgpt.com/",
    inputSelectors: [
      "#prompt-textarea",
      "textarea",
    ],
    sendSelectors: [
      "#composer-submit-button",
      'button[data-testid="send-button"]',
      'button[aria-label*="Send" i]',
    ],
    stopSelectors: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
    ],
    assistantSelectors: [
      '[data-message-author-role="assistant"]',
      ".markdown",
    ],
    readySelector: "#prompt-textarea, textarea",
  },

  gemini: {
    url: "https://gemini.google.com/",
    inputSelectors: [
      "rich-textarea .ql-editor",
      ".ql-editor",
      'rich-textarea [contenteditable="true"]',
      '[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send message"]',
      'button[aria-label*="Send" i]',
    ],
    stopSelectors: [
      '[aria-label="Stop generating"]',
      'button[aria-label*="Stop" i]',
    ],
    assistantSelectors: [
      "model-response",
      "message-content .markdown",
      "message-content",
    ],
    readySelector: 'rich-textarea .ql-editor, rich-textarea [contenteditable="true"]',
  },

  claude: {
    url: "https://claude.ai/new",
    inputSelectors: [
      ".ProseMirror",
      'div[contenteditable="true"]',
    ],
    sendSelectors: [
      'button[aria-label="Send Message"]',
      'button[aria-label*="Send" i]',
    ],
    stopSelectors: [
      'button[aria-label="Stop generating"]',
      'button[aria-label*="Stop" i]',
    ],
    assistantSelectors: [
      '[data-testid="assistant-message"]',
      ".font-claude-message",
    ],
    readySelector: '.ProseMirror, div[contenteditable="true"]',
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ok    = (msg, extra = {}) => ({ status: "OK",    message: msg, ...extra });
const fail  = (msg, extra = {}) => ({ status: "ERROR", message: msg, ...extra });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizePrompt(p) {
  if (p == null) return "";
  if (typeof p === "string") return p.trim();
  if (Array.isArray(p)) return p.map(normalizePrompt).filter(Boolean).join("\n\n").trim();
  try { return JSON.stringify(p, null, 2).trim(); } catch { return String(p).trim(); }
}

// ─── Chrome connection ────────────────────────────────────────────────────────
async function ensureProfileDir() {
  await fs.mkdir(DORI_PROFILE_DIR, { recursive: true });
}

async function resolveChromeExe() {
  const L   = process.env.LOCALAPPDATA || "";
  const P   = process.env.ProgramFiles || "C:\\Program Files";
  const P86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  for (const c of [
    path.join(P,   "Google", "Chrome", "Application", "chrome.exe"),
    path.join(P86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(L,   "Google", "Chrome", "Application", "chrome.exe"),
  ]) { try { await fs.access(c); return c; } catch {} }
  return "chrome.exe";
}

async function connectCDP(markOwned = false) {
  try {
    browser = await chromium.connectOverCDP(CDP_URL);
    const ctxs = browser.contexts();
    if (!ctxs.length) return false;
    context = ctxs[0];
    usingRealChrome = true;
    ownsBrowserSession = markOwned;
    return true;
  } catch { return false; }
}

async function launchChrome() {
  await ensureProfileDir();
  const exe = await resolveChromeExe();
  const cmd = `start "" "${exe}" --remote-debugging-port=9222 --user-data-dir="${DORI_PROFILE_DIR}" --no-first-run --no-default-browser-check`;
  await execAsync(cmd, { timeout: 1800 }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    if (await connectCDP(true)) return true;
    await sleep(400);
  }
  return false;
}

async function ensureConnected() {
  if (context) { try { context.pages(); return true; } catch {} }
  return (await connectCDP()) || (await launchChrome());
}

// ─── Get or open the provider page ───────────────────────────────────────────
async function getPage(config) {
  if (!await ensureConnected()) throw new Error("Cannot connect to Chrome");

  const pages = context.pages();
  const page  = pages.length
    ? ([...pages].reverse().find((p) => {
        try {
          const u = p.url();
          return u && u !== "about:blank" && !u.startsWith("chrome://") && !u.startsWith("devtools://");
        } catch { return false; }
      }) ?? pages.at(-1))
    : await context.newPage();

  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(20000);

  if (page.url() !== config.url) {
    await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  if (config.readySelector) {
    await page.waitForSelector(config.readySelector, { timeout: 12000 }).catch(() => {});
  }
  return page;
}

// ─── Close tab/browser AFTER response is fully received ──────────────────────
async function closeAfterDone(page) {
  try {
    if (!page || page.isClosed() || !context) return;

    const openPages = context.pages().filter((p) => {
      try { return !p.isClosed(); } catch { return false; }
    });

    if (openPages.length <= 1) {
      // Last tab — close entire browser session
      if (browser) await browser.close().catch(() => {});
      browser = null;
      context = null;
      usingRealChrome = false;
      ownsBrowserSession = false;
    } else {
      // Other tabs open — just close this one
      await page.close().catch(() => {});
    }
  } catch {}
}

// ─── Clear the input field (same logic for all 3 providers) ──────────────────
async function clearField(page, el) {
  await el.click();
  await sleep(100);

  // Step 1: Ctrl+A → Backspace (works for textarea AND contenteditable)
  await page.keyboard.press("Control+A");
  await sleep(80);
  await page.keyboard.press("Backspace");
  await sleep(80);

  // Step 2: check if anything remains — force-nuke if so
  const remaining = await el.evaluate((n) => {
    const t = n.tagName?.toLowerCase();
    if (t === "textarea" || t === "input") return n.value || "";
    return (n.innerText || n.textContent || "").trim();
  }).catch(() => "");

  if (remaining.length > 0) {
    await el.evaluate((n) => {
      const t = n.tagName?.toLowerCase();
      if (t === "textarea" || t === "input") {
        n.value = "";
      } else {
        n.innerHTML = "";
        n.textContent = "";
      }
      n.dispatchEvent(new InputEvent("input",  { bubbles: true }));
      n.dispatchEvent(new Event("change",       { bubbles: true }));
    });
    await sleep(80);
    // One more Ctrl+A + Backspace to let the framework sync
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await sleep(80);
  }
}

// ─── Paste full prompt in one shot — no typing, no loops ─────────────────────
async function typePrompt(page, text, selectors) {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).last();
      await el.waitFor({ state: "visible", timeout: 3000 });

      // Clear first
      await clearField(page, el);

      const tag = await el.evaluate((n) => n.tagName?.toLowerCase()).catch(() => "div");

      if (tag === "textarea" || tag === "input") {
        // fill() sets the entire value atomically — no key events, no partial text
        await el.fill(text);
      } else {
        // contenteditable (Quill / ProseMirror):
        // Write to clipboard then Ctrl+V — this is the only method that
        // triggers the framework's paste handler correctly in one shot
        await page.evaluate((t) => navigator.clipboard.writeText(t), text).catch(() => {});
        await sleep(80);
        await page.keyboard.press("Control+V");
        await sleep(300);

        // Verify it landed — fallback to keyboard.type if clipboard was blocked
        const check = await el.evaluate((n) => (n.innerText || n.textContent || "").trim()).catch(() => "");
        if (check.length < Math.floor(text.length * 0.7)) {
          await clearField(page, el);
          await page.keyboard.type(text, { delay: 0 });
        }
      }

      await sleep(300);

      // Final verify
      const value = await el.evaluate((n) => {
        const t = n.tagName?.toLowerCase();
        if (t === "textarea" || t === "input") return n.value;
        return n.innerText || n.textContent || "";
      }).catch(() => "");

      if (value.trim().length >= Math.floor(text.length * 0.7)) return true;
    } catch {}
  }
  return false;
}

// ─── Check if AI is currently generating ─────────────────────────────────────
async function isGenerating(page, config) {
  for (const sel of config.stopSelectors) {
    try {
      if (await page.locator(sel).first().isVisible({ timeout: 300 }).catch(() => false)) return true;
    } catch {}
  }
  return false;
}

// ─── Get the last assistant response text ────────────────────────────────────
async function getLastResponse(page, config) {
  return page.evaluate((sels) => {
    const texts = sels
      .flatMap((s) => [...document.querySelectorAll(s)])
      .map((el) => el?.innerText?.trim())
      .filter((t) => t && t.length > 5);
    return texts.at(-1) || "";
  }, config.assistantSelectors).catch(() => "");
}

// ─── Poll until streaming ends and response is stable ────────────────────────
async function waitForResponse(page, config, beforeText, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;

  // Wait up to 12s for generation to START
  const startDeadline = Date.now() + 12000;
  while (Date.now() < startDeadline) {
    if (await isGenerating(page, config)) break;
    const cur = await getLastResponse(page, config);
    if (cur && cur !== beforeText) break; // response already appeared
    await sleep(300);
  }

  // Poll until text is stable for 2s AND not generating
  let lastText    = "";
  let stableSince = Date.now();

  while (Date.now() < end) {
    const text       = await getLastResponse(page, config);
    const generating = await isGenerating(page, config);

    if (text && text !== beforeText) {
      if (text !== lastText) {
        lastText    = text;
        stableSince = Date.now();
      }
      // Response complete: stopped generating AND text unchanged for 2s
      if (!generating && Date.now() - stableSince > 2000) return lastText;
    }

    await sleep(500);
  }

  return lastText; // return whatever we have on timeout
}

// ─── Click send — skips button if it's actually a stop button ────────────────
async function clickSend(page, config) {
  await sleep(200);
  for (const sel of config.sendSelectors) {
    try {
      const el = page.locator(sel).last();
      if (!await el.isVisible({ timeout: 1500 }).catch(() => false)) continue;
      const label  = (await el.getAttribute("aria-label").catch(() => "")) ?? "";
      const testid = (await el.getAttribute("data-testid").catch(() => "")) ?? "";
      if (label.toLowerCase().includes("stop") || testid.toLowerCase().includes("stop")) continue;
      await el.click({ timeout: 1500 });
      return true;
    } catch {}
  }
  return false;
}

// ─── Serialize calls per provider ────────────────────────────────────────────
async function withLock(provider, fn) {
  const prev = providerLocks.get(provider) || Promise.resolve();
  let release;
  const curr = new Promise((res) => { release = res; });
  providerLocks.set(provider, prev.then(() => curr));
  await prev;
  try   { return await fn(); }
  finally {
    release();
    if (providerLocks.get(provider) === curr) providerLocks.delete(provider);
  }
}

// ─── Core: one call, one message, browser closes after response ───────────────
async function askAIWebOnce(provider, prompt) {
  const config      = PROVIDERS[provider];
  const finalPrompt = normalizePrompt(prompt);
  if (!finalPrompt) return fail("Empty prompt");

  let page = null;
  try {
    page = await getPage(config);

    // If currently generating from a previous call, wait it out first
    if (await isGenerating(page, config)) {
      await waitForResponse(page, config, await getLastResponse(page, config), 60000);
      await sleep(500);
    }

    const beforeText = await getLastResponse(page, config);

    // 1. Type the full prompt word-by-word (natural look, single message)
    const typed = await typePrompt(page, finalPrompt, config.inputSelectors);
    if (!typed) {
      await closeAfterDone(page);
      return fail(`Could not type into ${provider}`);
    }

    // 2. Click send exactly once
    const sent = await clickSend(page, config);
    if (!sent) {
      await closeAfterDone(page);
      return fail(`Could not click send for ${provider}`);
    }

    // 3. Wait for streaming to finish and response to stabilise
    const response = await waitForResponse(page, config, beforeText, 90000);

    // ── Close browser/tab NOW — after full response received ─────────────────
    await closeAfterDone(page);

    if (!response || response === beforeText) return fail(`No new response from ${provider}`);

    return ok(`${provider} replied`, {
      provider,
      response:    response.trim(),
      promptSent:  finalPrompt,
      usingRealChrome,
      ownsBrowserSession,
    });

  } catch (err) {
    await closeAfterDone(page);
    return fail(`${provider} error: ${err.message}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export async function askAIWeb(provider, prompt) {
  const key = String(provider || "").toLowerCase();
  if (!PROVIDERS[key]) return fail("Unknown provider. Use: chatgpt, gemini, claude");
  return withLock(key, () => askAIWebOnce(key, prompt));
}

export const askChatGPTWeb = (p) => askAIWeb("chatgpt", p);
export const askGeminiWeb  = (p) => askAIWeb("gemini",  p);
export const askClaudeWeb  = (p) => askAIWeb("claude",  p);

export default { askAIWeb, askChatGPTWeb, askGeminiWeb, askClaudeWeb };