import fetch from "node-fetch";

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const BASE = "https://newsapi.org/v2";

export async function getTopNews({ category = "general", country = "us", query = null, limit = 5 } = {}) {
  if (!NEWS_API_KEY) return "NEWS_API_KEY missing in .env";

  try {
    let url;

    if (query) {
      // ✅ search by keyword
      url = `${BASE}/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${limit}&apiKey=${NEWS_API_KEY}`;
    } else {
      // ✅ top headlines by category
      url = `${BASE}/top-headlines?country=${country}&category=${category}&pageSize=${limit}&apiKey=${NEWS_API_KEY}`;
    }

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "ok") return `News API error: ${data.message}`;
    if (!data.articles?.length) return "No news found.";

    return data.articles.map((a, i) => [
      `**${i + 1}. ${a.title}**`,
      `📰 ${a.source?.name || "Unknown source"}`,
      `🕐 ${new Date(a.publishedAt).toLocaleString()}`,
      a.description ? `📝 ${a.description.slice(0, 150)}...` : "",
      `🔗 ${a.url}`,
    ].filter(Boolean).join("\n")).join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n");

  } catch (err) {
    console.error("[news] error:", err.message);
    return `Could not fetch news: ${err.message}`;
  }
}

export default getTopNews;