import { chromium } from "playwright";
import * as cheerio from "cheerio";

function ok(message, extra = {}) {
  return {
    status: "OK",
    message,
    ...extra,
  };
}

function fail(message, extra = {}) {
  return {
    status: "ERROR",
    message,
    ...extra,
  };
}

function normalizeUrl(url) {
  if (!url) throw new Error("URL is required");
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function cleanText(text = "") {
  return String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function absUrl(base, href = "") {
  try {
    return new URL(href, base).href;
  } catch {
    return href || "";
  }
}

function extractMainText($) {
  const selectors = [
    "article",
    "main",
    "[role='main']",
    ".content",
    ".post-content",
    ".entry-content",
    "#content",
    "body",
  ];

  for (const sel of selectors) {
    const texts = [];
    $(sel).each((_, el) => {
      const txt = cleanText($(el).text());
      if (txt.length > 200) texts.push(txt);
    });

    if (texts.length) {
      return texts.sort((a, b) => b.length - a.length)[0];
    }
  }

  return cleanText($("body").text());
}

function extractLinks($, baseUrl, limit = 20) {
  const out = [];

  $("a[href]").each((_, el) => {
    if (out.length >= limit) return false;

    const href = absUrl(baseUrl, $(el).attr("href"));
    const text = cleanText($(el).text()) || href;

    if (!href) return;
    if (!/^https?:\/\//i.test(href)) return;

    out.push({ text, href });
  });

  return out;
}

async function scrapeWithFetch(url) {
  const target = normalizeUrl(url);

  const res = await fetch(target, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  const finalUrl = res.url || target;

  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  const title = cleanText($("title").first().text());
  const text = extractMainText($);
  const links = extractLinks($, finalUrl);

  return {
    mode: "fetch",
    url: finalUrl,
    title,
    text,
    links,
  };
}

async function scrapeWithBrowser(url) {
  const target = normalizeUrl(url);
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({
      viewport: { width: 1400, height: 900 },
    });

    await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });

    await page.waitForTimeout(1500);

    const finalUrl = page.url();
    const html = await page.content();

    const $ = cheerio.load(html);
    $("script, style, noscript, svg").remove();

    let title = cleanText($("title").first().text());
    let text = extractMainText($);

    if (!text || text.length < 150) {
      text = cleanText(
        await page.evaluate(() => document.body?.innerText?.trim() || ""),
      );
    }

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .map((a) => ({
          text: (a.innerText || a.href || "").trim(),
          href: a.href,
        }))
        .filter((x) => x.href && /^https?:\/\//i.test(x.href))
        .slice(0, 20);
    });

    if (!title) {
      title = await page.title().catch(() => "");
    }

    return {
      mode: "browser",
      url: finalUrl,
      title,
      text,
      links,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function scrapeUrl(url, options = {}) {
  try {
    const mode = options.mode || "auto";
    let result;

    if (mode === "fetch") {
      result = await scrapeWithFetch(url);
    } else if (mode === "browser") {
      result = await scrapeWithBrowser(url);
    } else {
      try {
        result = await scrapeWithFetch(url);
        if (!result.text || result.text.length < 150) {
          result = await scrapeWithBrowser(url);
        }
      } catch {
        result = await scrapeWithBrowser(url);
      }
    }

    return ok("Scrape success", result);
  } catch (err) {
    return fail(`scrapeUrl failed: ${err.message}`, { url });
  }
}

export async function scrapeArticle(url, options = {}) {
  try {
    const raw = await scrapeUrl(url, options);
    if (raw.status !== "OK") return raw;

    const paragraphs = String(raw.text || "")
      .split(/\n+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 40)
      .slice(0, 15);

    return ok("Article extracted", {
      url: raw.url,
      title: raw.title,
      mode: raw.mode,
      paragraphs,
      articleText: paragraphs.join("\n\n"),
    });
  } catch (err) {
    return fail(`scrapeArticle failed: ${err.message}`, { url });
  }
}

export async function scrapeLinks(url, options = {}) {
  try {
    const raw = await scrapeUrl(url, options);
    if (raw.status !== "OK") return raw;

    return ok("Links extracted", {
      url: raw.url,
      title: raw.title,
      mode: raw.mode,
      links: raw.links || [],
    });
  } catch (err) {
    return fail(`scrapeLinks failed: ${err.message}`, { url });
  }
}

export default {
  scrapeUrl,
  scrapeArticle,
  scrapeLinks,
};

