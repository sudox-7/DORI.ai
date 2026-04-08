import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUMMARY_FILE = path.join(__dirname, "../data/summary.json");
const DEFAULT = { summaries: [], lastUpdated: null };

// ── write queue ───────────────────────────────────────────────
let writeQueue = Promise.resolve();
function enqueue(fn) {
  writeQueue = writeQueue.then(fn).catch(() => {});
  return writeQueue;
}

async function readSummary() {
  try {
    const raw = await fs.readFile(SUMMARY_FILE, "utf-8");
    if (!raw.trim()) return { ...DEFAULT };
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[summaryStorage] read error:", err.message);
    return { ...DEFAULT };
  }
}

async function writeSummary(data) {
  await fs.mkdir(path.dirname(SUMMARY_FILE), { recursive: true });
  await fs.writeFile(SUMMARY_FILE, JSON.stringify(data, null, 2));
}

export async function saveSessionSummary(date, content) {
  return enqueue(async () => {
    const data = await readSummary();
    const idx = data.summaries.findIndex(s => s.date === date);

    if (idx !== -1) {
      data.summaries[idx].content = content;
      data.summaries[idx].updatedAt = new Date().toISOString();
    } else {
      data.summaries.push({
        date,
        content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // keep last 30 days
    if (data.summaries.length > 30) data.summaries = data.summaries.slice(-30);
    data.lastUpdated = new Date().toISOString();
    await writeSummary(data);
  });
}

export async function getLatestSummary() {
  const data = await readSummary();
  return data.summaries.at(-1) || null;
}

export async function getRecentSummaries(limit = 5) {
  const data = await readSummary();
  return data.summaries.slice(-limit);
}

export async function getUserOverview() {
  const summaries = await getRecentSummaries(5);
  if (!summaries.length) return "No conversation history yet.";
  return summaries.map(s => `[${s.date}]\n${s.content}`).join("\n\n---\n\n");
}