import { createLogger } from "./logger.js";
const log = createLogger("web");

const DEFAULT_TIMEOUT = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// Strip HTML tags, scripts, styles — clean readable text
function sanitizeHtml(html, url) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 8000);
}

export async function webSearch(query, { count = 10, offset = 0 } = {}) {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return { error: "BRAVE_SEARCH_API_KEY not set in .env" };

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(count, 20)}&offset=${offset}`;
    const res = await fetchWithTimeout(url, {
      timeout: DEFAULT_TIMEOUT,
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
    });

    if (!res.ok) throw new Error(`Brave search failed: ${res.status}`);
    const data = await res.json();

    const results = (data.web?.results ?? []).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));

    log.info(`web_search: "${query}" → ${results.length} results`);
    return { results, query, count: results.length };
  } catch (err) {
    log.error("web_search failed:", err.message);
    return { error: err.message };
  }
}

export async function webFetch(url, { maxBytes = 100000 } = {}) {
  try {
    const res = await fetchWithTimeout(url, { timeout: DEFAULT_TIMEOUT });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

    const contentType = res.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      const json = await res.json();
      return { url, content: JSON.stringify(json, null, 2).slice(0, maxBytes), contentType };
    }

    if (contentType.includes("text/")) {
      const text = await res.text();
      const cleaned = sanitizeHtml(text, url);
      return { url, content: cleaned.slice(0, maxBytes), contentType };
    }

    throw new Error(`Unsupported content type: ${contentType}`);
  } catch (err) {
    log.error("web_fetch failed:", err.message);
    return { error: err.message };
  }
}
