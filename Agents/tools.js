import "dotenv/config";
import { tool } from "langchain";
import { z }    from "zod";
import os       from "os";
import path     from "path";
import fs       from "fs/promises";

import youtubeSkill from "./skills/youtube.js";
import getWeather   from "./skills/weather.js";
import getTopNews   from "./skills/news.js";
import robotjs      from "./skills/robotjs.js";
import aiWeb        from "./skills/aiweb.js";
import scraper      from "./skills/scraping.js";
import {
  sendToSelf,
  sendWhatsAppMessage,
  sendImageToSelf,
  sendImageToPhone,
  getWhatsAppStatus,
} from "./skills/whatsapp.js";
import { getUnreadEmails, sendEmail } from "./skills/gmail.js";
import {
  getUserDetails,
  memoryWrite,
  addYoutubeSearch,
} from "../utils/chatStorage.js";
import { savePendingTask, saveDailyTask } from "../utils/wakeUpStorage.js";
import fs_skill  from "./skills/filesystem.js";
import terminal  from "./skills/terminal.js";
import {
  searchMemory,
  getMemorySection,
  appendToMemory,
  formatSearchResults,
} from "../utils/memorySearch.js";
import {
  createSkill,
  deleteSkill,
  updateSkill,
} from "../utils/skillLoader.js";
import { webSearch, webFetch } from "../utils/webSearch.js";
import { createLogger }        from "../utils/logger.js";

const log = createLogger("tools");

const USER_PATHS = {
  home:      os.homedir(),
  documents: path.join(os.homedir(), "Documents"),
  desktop:   path.join(os.homedir(), "Desktop"),
  downloads: path.join(os.homedir(), "Downloads"),
  appdata:   process.env.APPDATA      || path.join(os.homedir(), "AppData", "Roaming"),
  localapp:  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. GET USER
// ─────────────────────────────────────────────────────────────────────────────
const get_user = tool(async () => getUserDetails(), {
  name: "get_user",
  description:
    "Returns full user profile, preferences, notes and memory. Call before making any assumptions about the user.",
  schema: z.object({}),
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SAVE MEMORY
// ─────────────────────────────────────────────────────────────────────────────
const save_memory = tool(
  async (i) => {
    await memoryWrite(i.info, i.category).catch(() => {});
    return appendToMemory(i.info, i.category);
  },
  {
    name: "save_memory",
    description:
      "Save important info the user shares — name, job, city, goals, habits, preferences.",
    schema: z.object({
      info:     z.string().describe("The fact to remember"),
      category: z.enum([
        "personal", "preference", "goal", "habit",
        "location", "work", "summary", "general",
      ]),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 3. MEMORY SEARCH
// ─────────────────────────────────────────────────────────────────────────────
const memory_search = tool(
  async (i) => {
    const results = await searchMemory(i.query, i.maxResults ?? 5);
    if (results.length === 0)
      return `🧠 No memory found for: "${i.query}"\n💡 Try get_user for profile data.`;
    return `🧠 Memory results for: "${i.query}"\n━━━━━━━━━━━━━━━━━━━━\n${formatSearchResults(results)}`;
  },
  {
    name: "memory_search",
    description:
      "Search long-term memory for relevant info. Call before answering questions about user preferences, past instructions, project locations.",
    schema: z.object({
      query:      z.string().describe("What to search for in memory"),
      maxResults: z.number().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 4. MEMORY GET
// ─────────────────────────────────────────────────────────────────────────────
const memory_get = tool(
  async (i) => {
    const result = await getMemorySection(i.section);
    return `🧠 Memory [${i.section}]:\n${result}`;
  },
  {
    name: "memory_get",
    description:
      "Read a specific section from MEMORY.md by heading. Use after memory_search to get full section content.",
    schema: z.object({
      section: z.string().describe("Section heading e.g. 'Preferences', 'Work & Projects'"),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 5. WEB SEARCH
// ─────────────────────────────────────────────────────────────────────────────
const web_search = tool(
  async (i) => {
    const result = await webSearch(i.query, { count: i.count ?? 10 });
    if (result.error) return `❌ ${result.error}`;
    const lines = result.results
      .map((r, idx) => `${idx + 1}. ${r.title}\n   🔗 ${r.url}\n   ${r.snippet ?? ""}`)
      .join("\n\n");
    return `🔍 ${result.count} results for "${i.query}":\n\n${lines}`;
  },
  {
    name: "web_search",
    description:
      "Search the web using Brave Search API. Use for current events, news, research, finding URLs.",
    schema: z.object({
      query: z.string(),
      count: z.number().optional().describe("Number of results (default 10)"),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 6. WEB FETCH
// ─────────────────────────────────────────────────────────────────────────────
const web_fetch = tool(
  async (i) => {
    const result = await webFetch(i.url, { maxBytes: i.maxBytes ?? 100000 });
    if (result.error) return `❌ ${result.error}`;
    return `📄 ${result.url}\n\n${result.content}`;
  },
  {
    name: "web_fetch",
    description:
      "Fetch and extract clean text from any URL. Use after web_search to read a page's full content.",
    schema: z.object({
      url:      z.string(),
      maxBytes: z.number().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 7. WEB SCRAPE
// ─────────────────────────────────────────────────────────────────────────────
const web_scrape = tool(
  async (i) => {
    const opts = { mode: i.mode ?? "auto" };
    let result;
    if (i.action === "links")        result = await scraper.scrapeLinks(i.url, opts);
    else if (i.action === "article") result = await scraper.scrapeArticle(i.url, opts);
    else                             result = await scraper.scrapeUrl(i.url, opts);

    if (result.status !== "OK") return `❌ ${result.message}`;
    if (i.action === "links") {
      const lines = (result.links ?? [])
        .map((l, idx) => `${idx + 1}. ${l.text}\n   🔗 ${l.href}`)
        .join("\n\n");
      return `🔗 Links on ${result.title ?? result.url}:\n\n${lines}`.slice(0, 1800);
    }
    if (i.action === "article")
      return `📄 ${result.title}\n🔗 ${result.url}\n\n${result.articleText}`.slice(0, 1800);
    return `📄 ${result.title}\n🔗 ${result.url}\n\n${result.text}`.slice(0, 1800);
  },
  {
    name: "web_scrape",
    description:
      "Scrape any public webpage — full text, clean article, or all links. ACTIONS: full, article, links",
    schema: z.object({
      url:    z.string(),
      action: z.enum(["full", "article", "links"]).default("full"),
      mode:   z.enum(["auto", "fetch", "browser"]).optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. ASK AI WEB
// ─────────────────────────────────────────────────────────────────────────────
const ask_ai_web = tool(
  async (i) => {
    const result = await aiWeb.askAIWeb(i.provider, i.prompt);
    if (result.status === "ERROR") return `DONE (error): ${result.message}`;
    return `DONE: ${result.provider} replied —\n\n${result.response ?? ""}`;
  },
  {
    name: "ask_ai_web",
    description:
      "Send ONE prompt to ChatGPT, Gemini, or Claude via real browser. Call ONCE — never retry if it returns DONE.",
    schema: z.object({
      provider: z.enum(["chatgpt", "gemini", "claude"]),
      prompt:   z.string().describe("Complete prompt with all context in ONE message"),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 9. GET NEWS
// ─────────────────────────────────────────────────────────────────────────────
const get_news = tool(async (i) => getTopNews(i), {
  name: "get_news",
  description: "Get real top news headlines. Filter by category or keyword.",
  schema: z.object({
    category: z.enum([
      "general", "business", "technology", "sports",
      "science", "health", "entertainment",
    ]).optional(),
    query:   z.string().optional(),
    country: z.string().optional(),
    limit:   z.number().optional(),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. GET WEATHER
// ─────────────────────────────────────────────────────────────────────────────
const get_weather = tool(async (i) => getWeather(i.city), {
  name: "get_weather",
  description: "Get real current weather and 3-day forecast for any city.",
  schema: z.object({ city: z.string() }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. YOUTUBE
// ─────────────────────────────────────────────────────────────────────────────
const youtube_skill = tool(
  async (i) => {
    await addYoutubeSearch(i.query).catch(() => {});
    return youtubeSkill(i);
  },
  {
    name: "youtube_skill",
    description: "Search and play YouTube videos in a real browser.",
    schema: z.object({
      query:             z.string(),
      browserFullscreen: z.boolean().optional(),
      playerFullscreen:  z.boolean().optional(),
      set1080p:          z.boolean().optional(),
      keepOpen:          z.boolean().optional(),
      watchAds:          z.boolean().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 12. WHATSAPP SEND
// ─────────────────────────────────────────────────────────────────────────────
const whatsapp_send = tool(
  async (i) => {
    const status = getWhatsAppStatus();
    if (status !== "✅ Connected") return `❌ WhatsApp not ready: ${status}`;
    if (i.toSelf) return sendToSelf(i.message);
    if (!i.phone) return "❌ Provide phone or set toSelf: true";
    return sendWhatsAppMessage(i.phone, i.message);
  },
  {
    name: "whatsapp_send",
    description: "Send a WhatsApp message to self or a specific number.",
    schema: z.object({
      message: z.string(),
      toSelf:  z.boolean().optional(),
      phone:   z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 13. WHATSAPP SEND IMAGE
// ─────────────────────────────────────────────────────────────────────────────
const whatsapp_send_image = tool(
  async (i) => {
    const status = getWhatsAppStatus();
    if (status !== "✅ Connected") return `❌ WhatsApp not ready: ${status}`;
    let filepath = i.filepath;
    if (filepath.startsWith("{")) {
      try { filepath = JSON.parse(filepath).filepath || filepath; } catch {}
    }
    const caption = i.caption || "";
    if (i.toSelf !== false) return sendImageToSelf(filepath, caption);
    if (!i.phone) return "❌ Provide phone or set toSelf: true";
    return sendImageToPhone(i.phone, filepath, caption);
  },
  {
    name: "whatsapp_send_image",
    description: "Send an image via WhatsApp.",
    schema: z.object({
      filepath: z.string(),
      caption:  z.string().optional(),
      toSelf:   z.boolean().optional(),
      phone:    z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 14. GMAIL READ
// ─────────────────────────────────────────────────────────────────────────────
const gmail_read = tool(async (i) => getUnreadEmails(i.limit || 5), {
  name: "gmail_read",
  description: "Read unread emails from Gmail inbox.",
  schema: z.object({ limit: z.number().optional() }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. GMAIL SEND
// ─────────────────────────────────────────────────────────────────────────────
const gmail_send = tool(async (i) => sendEmail(i), {
  name: "gmail_send",
  description: "Send an email via Gmail.",
  schema: z.object({
    to:      z.string(),
    subject: z.string(),
    body:    z.string(),
  }),
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. FILESYSTEM
// ─────────────────────────────────────────────────────────────────────────────
const filesystem = tool(
  async (i) => {
    switch (i.action) {
      case "user_paths":      return JSON.stringify(USER_PATHS, null, 2);
      case "find_folder":     return fs_skill.findFolder(i.value || "");
      case "find_file":       return fs_skill.findFile(i.value || "", i.path || "");
      case "find_folder_list":return fs_skill.findFolderAndList(i.value || "");
      case "find_file_read":  return fs_skill.findFileAndRead(i.value || "", i.path || "");
      case "list":            return fs_skill.listFolder(i.path || ".");
      case "read": {
        const startLine = parseInt(i.value || "1");
        const endLine   = parseInt(i.dest  || "150");
        const result    = await fs_skill.readFile(i.path || "", startLine, endLine);
        const fileSize  = await fs.stat(i.path).then(s => s.size).catch(() => 0);
        if (fileSize > 50000)
          return result + `\n\n⚠️ Large file (${Math.round(fileSize / 1024)}KB). Use value=startLine dest=endLine to paginate.`;
        return result;
      }
      case "write":  return fs_skill.writeFile(i.path || "", i.content || "");
      case "update": return fs_skill.updateFile(i.path || "", i.old_text || "", i.content || "");
      case "append": return fs_skill.appendFile(i.path || "", i.content || "");
      case "delete": return fs_skill.deleteItem(i.path || "");
      case "copy":   return fs_skill.copyItem(i.path || "", i.dest || "");
      case "move":   return fs_skill.moveItem(i.path || "", i.dest || "");
      case "info":   return fs_skill.itemInfo(i.path || "");
      default:       return `❌ Unknown filesystem action: ${i.action}`;
    }
  },
  {
    name: "filesystem",
    description:
      "File system operations — search, read, write, move, delete files and folders. Always use full absolute paths.",
    schema: z.object({
      action: z.enum([
        "user_paths", "find_folder", "find_file", "find_folder_list",
        "find_file_read", "list", "read", "write", "update",
        "append", "delete", "copy", "move", "info",
      ]),
      value:    z.string().optional(),
      path:     z.string().optional(),
      dest:     z.string().optional(),
      content:  z.string().optional(),
      old_text: z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 17. TERMINAL
// ─────────────────────────────────────────────────────────────────────────────
const terminal_control = tool(
  async (i) => {
    switch (i.action) {
      case "run":                  return terminal.runTerminalCommand(i.value || "", i.cwd);
      case "npm":                  return terminal.runNpm(i.value || "", i.cwd);
      case "git":                  return terminal.runGit(i.value || "", i.cwd);
      case "clear_temp":           return terminal.clearTemp();
      case "clear_dns":            return terminal.clearDnsCache();
      case "clear_browser_cache":  return terminal.clearBrowserCache(i.value || "chrome");
      default:                     return `❌ Unknown terminal action: ${i.action}`;
    }
  },
  {
    name: "terminal_control",
    description:
      "Run shell commands, npm, git, and system cleanup. ACTIONS: run, npm, git, clear_temp, clear_dns, clear_browser_cache",
    schema: z.object({
      action: z.enum(["run", "npm", "git", "clear_temp", "clear_dns", "clear_browser_cache"]),
      value:  z.string().optional(),
      cwd:    z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 18. GREP SEARCH
// ─────────────────────────────────────────────────────────────────────────────
const grep_search = tool(
  async (i) => {
    const { pattern, dir, fileGlob, ignoreCase, maxResults } = i;
    if (!pattern) return "❌ pattern is required";
    const searchDir = dir ? path.resolve(dir) : process.cwd();
    const limit     = maxResults ?? 50;
    const flags     = ignoreCase ? "gi" : "g";
    let regex;
    try { regex = new RegExp(pattern, flags); }
    catch (e) { return `❌ Invalid regex: ${e.message}`; }

    const matches = [];
    const visited = new Set();

    const shouldInclude = (filePath) => {
      if (!fileGlob) return true;
      const name = path.basename(filePath);
      if (fileGlob.startsWith("*.")) return name.endsWith(fileGlob.slice(1));
      return name.includes(fileGlob.replace(/\*/g, ""));
    };

    const scanFile = async (filePath) => {
      if (visited.has(filePath)) return;
      visited.add(filePath);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const lines   = content.split(/\r?\n/);
        for (let idx = 0; idx < lines.length; idx++) {
          if (matches.length >= limit) return;
          regex.lastIndex = 0;
          if (regex.test(lines[idx]))
            matches.push({ file: path.relative(searchDir, filePath), line: idx + 1, text: lines[idx].trim().slice(0, 120) });
        }
      } catch {}
    };

    const scanDir = async (dirPath) => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (matches.length >= limit) break;
          if (entry.name.startsWith(".")) continue;
          if (["node_modules", "dist", ".git", "whatsapp-session"].includes(entry.name)) continue;
          const fullPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) await scanDir(fullPath);
          else if (entry.isFile() && shouldInclude(fullPath)) await scanFile(fullPath);
        }
      } catch {}
    };

    await scanDir(searchDir);
    if (matches.length === 0) return `🔍 No matches for "${pattern}" in ${path.basename(searchDir)}/`;
    return [
      `🔍 ${matches.length} match(es) for "${pattern}":`,
      `📁 ${searchDir}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ...matches.map(m => `${m.file}:${m.line}  →  ${m.text}`),
      matches.length >= limit ? `⚠️ Limit reached. Narrow the pattern or dir.` : "",
    ].filter(Boolean).join("\n").slice(0, 1800);
  },
  {
    name: "grep_search",
    description:
      "Fast text search inside files. Find where functions are defined, which files use a variable.",
    schema: z.object({
      pattern:    z.string(),
      dir:        z.string().optional(),
      fileGlob:   z.string().optional(),
      ignoreCase: z.boolean().optional(),
      maxResults: z.number().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 19. COMPUTER CONTROL
// ─────────────────────────────────────────────────────────────────────────────
const computer_control = tool(
  async (i) => {
    switch (i.action) {
      case "open_app":      return robotjs.openApp(i.value || "");
      case "close_app":     return robotjs.closeApp(i.value || "");
      case "set_volume":    return robotjs.setVolume(parseInt(i.value || "50"));
      case "screenshot":    return robotjs.takeScreenshot();
      case "system_info":   return robotjs.getSystemInfo();
      case "top_processes": return robotjs.getTopProcesses(parseInt(i.value || "5"));
      case "read_clipboard":return robotjs.readClipboard();
      case "lock_screen":   return robotjs.lockScreen();
      case "shutdown":      return robotjs.shutdownPC(parseInt(i.value || "0"));
      case "restart":       return robotjs.restartPC();
      default:              return `❌ Unknown action: ${i.action}`;
    }
  },
  {
    name: "computer_control",
    description:
      "Control the local Windows computer. Actions: open_app, close_app, set_volume, screenshot, system_info, top_processes, read_clipboard, lock_screen, shutdown, restart",
    schema: z.object({
      action: z.enum([
        "open_app", "close_app", "set_volume", "screenshot", "system_info",
        "top_processes", "read_clipboard", "lock_screen", "shutdown", "restart",
      ]),
      value: z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 20. ASK HUMAN
// ─────────────────────────────────────────────────────────────────────────────
const ask_human = tool(
  async (i) => {
    const optionsList = i.options.map((opt, idx) => `  ${idx + 1}. ${opt}`).join("\n");
    return `WAITING_FOR_HUMAN_INPUT:\n${i.question}\n\n${optionsList}\n\nReply with the number or name of your choice.`;
  },
  {
    name: "ask_human",
    description:
      "Pause and ask the user to choose before continuing. Use for irreversible actions.",
    schema: z.object({
      question: z.string(),
      options:  z.array(z.string()),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 21. SCHEDULE TASK
// ─────────────────────────────────────────────────────────────────────────────
const schedule_task = tool(
  async (i) => {
    if (i.daily) {
      const result = await saveDailyTask(i.task, i.time || null);
      return result.message;
    }
    const now = new Date();
    let scheduledTime;
    if (i.minutesFromNow)
      scheduledTime = new Date(now.getTime() + i.minutesFromNow * 60000).toISOString();
    else if (i.isoTime)
      scheduledTime = i.isoTime;
    else
      return "❌ Provide minutesFromNow, isoTime, or set daily:true with time";
    const result = await savePendingTask(i.task, scheduledTime);
    return result.message;
  },
  {
    name: "schedule_task",
    description: `Schedule a one-off or recurring daily task.

ONE-OFF:
  { task, minutesFromNow: 5 }
  { task, isoTime: "2026-03-12T21:00" }

DAILY:
  { task, daily: true, time: "9:00am" }
  { task, daily: true, time: "21:30" }`,
    schema: z.object({
      task:          z.string().describe("What to execute — must be self-contained"),
      daily:         z.boolean().optional().describe("true = repeat every day"),
      time:          z.string().optional().describe("Time for daily tasks e.g. '9:00am'"),
      minutesFromNow:z.number().optional().describe("One-off: run in N minutes"),
      isoTime:       z.string().optional().describe("One-off: run at ISO timestamp"),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 22. SKILL CREATE
// ─────────────────────────────────────────────────────────────────────────────
const skill_create = tool(
  async (i) => {
    const result = await createSkill(i.name, i.description, i.instructions);
    try {
      const { refreshSystemPrompt } = await import("../Agents/agent.js");
      await refreshSystemPrompt();
    } catch {}
    return result;
  },
  {
    name: "skill_create",
    description:
      "Create a new permanent skill saved to workspace/skills/. Use when user teaches you a new workflow.",
    schema: z.object({
      name:         z.string(),
      description:  z.string(),
      instructions: z.string(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 23. SKILL UPDATE
// ─────────────────────────────────────────────────────────────────────────────
const skill_update = tool(
  async (i) => {
    const result = await updateSkill(i.name, {
      description:  i.description,
      instructions: i.instructions,
    });
    try {
      const { refreshSystemPrompt } = await import("../Agents/agent.js");
      await refreshSystemPrompt();
    } catch {}
    return result;
  },
  {
    name: "skill_update",
    description: "Update an existing skill's description or instructions.",
    schema: z.object({
      name:         z.string(),
      description:  z.string().optional(),
      instructions: z.string().optional(),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// 24. SKILL DELETE
// ─────────────────────────────────────────────────────────────────────────────
const skill_delete = tool(
  async (i) => {
    const result = await deleteSkill(i.name);
    try {
      const { refreshSystemPrompt } = await import("../Agents/agent.js");
      await refreshSystemPrompt();
    } catch {}
    return result;
  },
  {
    name: "skill_delete",
    description: "Delete a skill from workspace/skills/.",
    schema: z.object({ name: z.string() }),
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────
export const mainTools = [
  // identity & memory
  get_user,
  save_memory,
  memory_search,
  memory_get,
  // web
  web_search,
  web_fetch,
  web_scrape,
  ask_ai_web,
  get_news,
  get_weather,
  youtube_skill,
  // comms
  whatsapp_send,
  whatsapp_send_image,
  gmail_send,
  gmail_read,
  // computer
  filesystem,
  terminal_control,
  grep_search,
  computer_control,
  // control flow
  ask_human,
  schedule_task,
  // skills
  skill_create,
  skill_update,
  skill_delete,
];

export default mainTools;