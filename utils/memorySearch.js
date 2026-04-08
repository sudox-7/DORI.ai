/**
 * memorySearch.js — Dori AI Memory Search
 *
 * Searches MEMORY.md + workspace/memory/YYYY-MM-DD.md files
 * using keyword matching with section-level scoring.
 *
 * Exposes:
 *   searchMemory(query)        → top matching snippets
 *   getMemorySection(heading)  → read a specific section
 *   appendToMemory(text)       → append raw text to MEMORY.md
 *   logDailyMemory(text)       → append to today's daily log
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");
const MEMORY_FILE = path.join(WORKSPACE_DIR, "MEMORY.md");
const MEMORY_DIR = path.join(WORKSPACE_DIR, "memory");

// ── Get today's date string YYYY-MM-DD ───────────────────────────────────────
function today() {
  return new Date().toISOString().split("T")[0];
}

// ── Safely read a file, return empty string if missing ───────────────────────
async function safeRead(filePath) {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

// ── Parse MEMORY.md into sections (split on ## headings) ─────────────────────
function parseSections(content) {
  const sections = [];
  const lines = content.split("\n");
  let current = { heading: "General", lines: [] };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current.lines.length > 0) sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) sections.push(current);
  return sections;
}

// ── Score a section against query words ──────────────────────────────────────
function scoreSection(section, queryWords) {
  const text = (section.heading + " " + section.lines.join(" ")).toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    if (text.includes(word)) {
      // Heading matches weight more
      if (section.heading.toLowerCase().includes(word)) score += 3;
      else score += 1;
    }
  }
  return score;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. SEARCH MEMORY
// ════════════════════════════════════════════════════════════════════════════
export async function searchMemory(query, maxResults = 5) {
  if (!query || typeof query !== "string") return [];

  const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (queryWords.length === 0) return [];

  // Load MEMORY.md + today's and yesterday's daily logs
  const memoryContent = await safeRead(MEMORY_FILE);
  const todayLog = await safeRead(path.join(MEMORY_DIR, `${today()}.md`));
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const yesterdayLog = await safeRead(path.join(MEMORY_DIR, `${yesterday}.md`));

  const allContent = [
    { source: "MEMORY.md", content: memoryContent },
    { source: `memory/${today()}.md`, content: todayLog },
    { source: `memory/${yesterday}.md`, content: yesterdayLog },
  ].filter(s => s.content.trim());

  const results = [];

  for (const { source, content } of allContent) {
    const sections = parseSections(content);
    for (const section of sections) {
      const score = scoreSection(section, queryWords);
      if (score > 0) {
        results.push({
          source,
          heading: section.heading,
          snippet: section.lines
            .filter(l => l.trim())
            .slice(0, 5)
            .join("\n"),
          score,
        });
      }
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ════════════════════════════════════════════════════════════════════════════
// 2. GET A SPECIFIC SECTION
// ════════════════════════════════════════════════════════════════════════════
export async function getMemorySection(heading) {
  const content = await safeRead(MEMORY_FILE);
  const sections = parseSections(content);
  const match = sections.find(
    s => s.heading.toLowerCase() === heading.toLowerCase()
  );
  if (!match) return `❌ Section "${heading}" not found in MEMORY.md`;
  return match.lines.filter(l => l.trim()).join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 3. APPEND TO MEMORY.md
// ════════════════════════════════════════════════════════════════════════════
export async function appendToMemory(text, category = "General") {
  if (!text?.trim()) return "❌ No text to append";

  try {
    await fs.mkdir(WORKSPACE_DIR, { recursive: true });
    const existing = await safeRead(MEMORY_FILE);

    // Find the right section or append at end
    const entry = `- ${text.trim()} _(${today()})_\n`;
    const sectionHeader = `## ${category}`;

    if (existing.includes(sectionHeader)) {
      // Append after the section heading
      const updated = existing.replace(
        new RegExp(`(## ${category}[^\n]*\n)`),
        `$1${entry}`
      );
      await fs.writeFile(MEMORY_FILE, updated, "utf-8");
    } else {
      // Add new section at end
      const newSection = `\n## ${category}\n${entry}`;
      await fs.appendFile(MEMORY_FILE, newSection, "utf-8");
    }

    return `✅ Added to MEMORY.md [${category}]: "${text.trim()}"`;
  } catch (err) {
    return `❌ appendToMemory failed: ${err.message}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 4. LOG TO DAILY MEMORY FILE
// ════════════════════════════════════════════════════════════════════════════
export async function logDailyMemory(text) {
  if (!text?.trim()) return;

  try {
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    const filePath = path.join(MEMORY_DIR, `${today()}.md`);
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    const entry = `- [${timestamp}] ${text.trim()}\n`;
    await fs.appendFile(filePath, entry, "utf-8");
  } catch (err) {
    console.error("[memorySearch] logDailyMemory failed:", err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 5. FORMAT SEARCH RESULTS FOR LLM
// ════════════════════════════════════════════════════════════════════════════
export function formatSearchResults(results) {
  if (!results.length) return "No relevant memory found.";

  return results
    .map(
      (r, i) =>
        `[${i + 1}] **${r.heading}** (from ${r.source}, score: ${r.score})\n${r.snippet}`
    )
    .join("\n\n");
}

export default {
  searchMemory,
  getMemorySection,
  appendToMemory,
  logDailyMemory,
  formatSearchResults,
};