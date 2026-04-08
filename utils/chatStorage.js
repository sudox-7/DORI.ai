import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { summarizeWithAI } from "./summarizer.js";
import { saveSessionSummary, getUserOverview } from "./summaryStorage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CHATS_DIR = path.join(ROOT, "data", "chats");
const MEMORY_FILE = path.join(ROOT, "data", "memory.json");
const USER_FILE = path.join(ROOT, "data", "user.json");

const MAX_MESSAGES = 50;
const CONTEXT_WINDOW = 10;

// ── write queue ───────────────────────────────────────────────
const writeQueues = new Map();

async function safeWrite(filePath, data) {
  if (!writeQueues.has(filePath)) writeQueues.set(filePath, Promise.resolve());
  const queue = writeQueues.get(filePath).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  });
  writeQueues.set(filePath, queue.catch(() => {}));
  return queue;
}

async function readJSON(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[chatStorage] readJSON error (${path.basename(filePath)}):`, err.message);
    }
    return fallback;
  }
}

function getToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}

function roleLabel(role) {
  return { user: "User", assistant: "Dori", system: "System" }[role] ?? "Unknown";
}

// ============================================================
// ROLLING SUMMARIZATION
// ============================================================
async function summarizeAndCompress(filePath, chat) {
  const existingSummary = chat.find(m => m.isSummary);
  const regularMessages = chat.filter(m => !m.isSummary);
  if (regularMessages.length < MAX_MESSAGES) return;

  console.log("🧠 Summarizing chat...");

  const toSummarize = regularMessages.slice(0, -CONTEXT_WINDOW);
  const recentMessages = regularMessages.slice(-CONTEXT_WINDOW);

  const previousSummary = existingSummary
    ? `Previous summary:\n${existingSummary.content}\n\n`
    : "";

  const transcript = previousSummary + toSummarize
    .map(m => `${roleLabel(m.role)}: ${m.content.slice(0, 300)}`)
    .join("\n");

  const aiSummary = await summarizeWithAI(transcript);

  const summaryBlock = {
    role: "system",
    content: `[Rolling AI Summary — ${getToday()}]\n${aiSummary}`,
    timestamp: new Date().toISOString(),
    isSummary: true,
  };

  await safeWrite(filePath, [summaryBlock, ...recentMessages]);

  // ✅ save to summary.json — not memory.json
  await saveSessionSummary(getToday(), aiSummary);
  console.log("✅ Chat compressed and summary saved.");
}

// ============================================================
// 1. SAVE CHAT MESSAGE
// ============================================================
export async function saveChatMessage(role, content) {
  if (typeof role !== "string" || !role.trim()) return;
  if (typeof content !== "string" || !content.trim()) return;

  const filePath = path.join(CHATS_DIR, `chat_${getToday()}.json`);
  const chat = await readJSON(filePath, []);

  chat.push({ role, content, timestamp: new Date().toISOString() });
  await safeWrite(filePath, chat);

  const nonSummary = chat.filter(m => !m.isSummary);
  if (nonSummary.length >= MAX_MESSAGES) {
    summarizeAndCompress(filePath, chat).catch(err => {
      console.error("Summary error:", err.message);
    });
  }

  await incrementTotalMessages();
}

async function incrementTotalMessages() {
  const memory = await readJSON(MEMORY_FILE, { totalMessages: 0 });
  await safeWrite(MEMORY_FILE, {
    ...memory,
    totalMessages: (memory.totalMessages || 0) + 1,
  });
}

// ============================================================
// 2. GET CONTEXT — summary + last 10 → agent
// ============================================================
export async function getContextMessages(limit = CONTEXT_WINDOW) {
  const filePath = path.join(CHATS_DIR, `chat_${getToday()}.json`);
  const chat = await readJSON(filePath, []);

  const summaryBlock = chat.find(m => m.isSummary);
  const recent = chat.filter(m => !m.isSummary).slice(-limit);
  const context = summaryBlock ? [summaryBlock, ...recent] : recent;

  return context.map(m => ({
    role: ["assistant", "system", "user"].includes(m.role) ? m.role : "user",
    content: m.content,
  }));
}

// ============================================================
// 3. GET USER DETAILS
// ============================================================
export async function getUserDetails() {
  try {
    const user = await readJSON(USER_FILE, {});
    const memory = await readJSON(MEMORY_FILE, {});
    const overview = await getUserOverview(); // last 5 summaries

    return JSON.stringify({
      profile: {
        name: user.name ?? "Unknown",
        age: user.age ?? "Unknown",
        email: user.email ?? "Unknown",
        location: user.location ?? "Unknown"
      },

      preferences: user.preferences ?? {},

      accounts: user.accounts ?? {},

      activity: {
        lastSeen: memory.lastSeen ?? null,
        totalMessages: memory.totalMessages ?? 0
      },

      memory: {
        notes: memory.notes ?? [],
        recentYouTube: memory.preferences?.recentYoutubeSearches ?? []
      },

      conversationOverview: overview ?? []
    }, null, 2);

  } catch (err) {
    console.error("[getUserDetails] error:", err.message);

    return JSON.stringify({
      error: "Unable to load user details"
    });
  }
}

// ============================================================
// 4. MEMORY WRITE
// ============================================================
export async function memoryWrite(info, category = "general") {
  if (typeof info !== "string" || !info.trim()) return "Invalid info.";

  const memory = await readJSON(MEMORY_FILE, {
    lastSeen: null,
    totalMessages: 0,
    topics: [],
    preferences: { recentYoutubeSearches: [] },
    notes: [],
  });

  const notes = memory.notes || [];
  if (notes.some(n => n.content === info)) return `Already saved: "${info}"`;

  notes.push({ content: info, category, timestamp: new Date().toISOString() });

  if (notes.length > 50) {
    const idx = notes.findIndex(n => n.category !== "summary");
    notes.splice(idx !== -1 ? idx : 0, 1);
  }

  await safeWrite(MEMORY_FILE, {
    ...memory,
    notes,
    lastSeen: new Date().toISOString(),
  });

  return `✅ Saved: "${info}" [${category}]`;
}

// ============================================================
// 5. TRACK SESSION
// ============================================================
export async function trackSession(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return;

  const memory = await readJSON(MEMORY_FILE, {
    lastSeen: null, totalMessages: 0, topics: [],
    preferences: { recentYoutubeSearches: [] }, notes: [],
  });

  const topic = prompt.split(" ").slice(0, 4).join(" ");
  const topics = memory.topics || [];
  if (!topics.includes(topic)) {
    topics.push(topic);
    if (topics.length > 20) topics.shift();
  }

  await safeWrite(MEMORY_FILE, {
    ...memory,
    topics,
    lastSeen: new Date().toISOString(),
  });
}

// ============================================================
// 6. ADD YOUTUBE SEARCH
// ============================================================
export async function addYoutubeSearch(query) {
  if (typeof query !== "string" || !query.trim()) return;

  const memory = await readJSON(MEMORY_FILE, {});
  const searches = memory.preferences?.recentYoutubeSearches || [];
  searches.push(query);
  if (searches.length > 10) searches.shift();

  await safeWrite(MEMORY_FILE, {
    ...memory,
    preferences: { ...memory.preferences, recentYoutubeSearches: searches },
  });
};