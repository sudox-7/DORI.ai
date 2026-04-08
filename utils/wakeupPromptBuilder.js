/**
 * utils/wakeupPromptBuilder.js
 * Builds rich structured prompts for scheduled tasks.
 * If task is a skill name → loads skill file and embeds its steps.
 * If task is a regular description → detects tools and builds execution plan.
 */

import fs   from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, "../workspace/skills");

// ── Tool detection ────────────────────────────────────────────────────────────
const TOOL_MAP = [
  { keywords: ["weather"],                       tool: "get_weather",         desc: "fetch weather data" },
  { keywords: ["news", "briefing", "headlines"], tool: "get_news",            desc: "fetch latest news" },
  { keywords: ["whatsapp", "send message"],      tool: "whatsapp_send",       desc: "send WhatsApp message" },
  { keywords: ["screenshot", "screen"],          tool: "computer_control",    desc: "take screenshot" },
  { keywords: ["send image","send screenshot"],  tool: "whatsapp_send_image", desc: "send image via WhatsApp" },
  { keywords: ["email", "gmail"],                tool: "gmail_send",          desc: "send email" },
  { keywords: ["search","find","research"],       tool: "ask_ai_web",          desc: "search/analyze with AI" },
  { keywords: ["summarize","summary","analyze"], tool: "ask_ai_web",          desc: "analyze with AI" },
  { keywords: ["file","read file"],              tool: "filesystem",          desc: "read/write file" },
  { keywords: ["terminal","run command"],        tool: "terminal_control",    desc: "run terminal command" },
];

const TOOL_ORDER = [
  "get_weather","get_news","ask_ai_web","filesystem",
  "computer_control","terminal_control","save_memory",
  "whatsapp_send","whatsapp_send_image","gmail_send",
];

function detectTools(text) {
  const lower = text.toLowerCase();
  const found = [], seen = new Set();
  for (const e of TOOL_MAP) {
    if (e.keywords.some(k => lower.includes(k)) && !seen.has(e.tool)) {
      seen.add(e.tool); found.push(e);
    }
  }
  found.sort((a,b) => {
    const ai = TOOL_ORDER.indexOf(a.tool), bi = TOOL_ORDER.indexOf(b.tool);
    return (ai<0?99:ai)-(bi<0?99:bi);
  });
  if (lower.includes("whatsapp") && !seen.has("whatsapp_send") && !seen.has("whatsapp_send_image"))
    found.push({ tool: "whatsapp_send", desc: "send result to WhatsApp" });
  return found.length ? found : [{ tool: "whatsapp_send", desc: "send message to WhatsApp" }];
}

// ── Skill loader ──────────────────────────────────────────────────────────────
async function loadSkillContent(skillName) {
  const candidates = [
    path.join(SKILLS_DIR, skillName, "index.md"),
    path.join(SKILLS_DIR, skillName, "skill.md"),
    path.join(SKILLS_DIR, skillName, `${skillName}.md`),
    path.join(SKILLS_DIR, `${skillName}.md`),
  ];
  for (const p of candidates) {
    try { return await fs.readFile(p, "utf-8"); } catch {}
  }
  return null;
}

function looksLikeSkillName(task) {
  // kebab-case or single word, short, no sentence structure
  return /^[a-z0-9-_]{2,40}$/.test(task.trim());
}

// ── Main builder ──────────────────────────────────────────────────────────────
export async function buildTaskPrompt(rawTask, context = {}) {
  const {
    userName = "Oussama",
    location = "Marrakech",
    time     = new Date().toLocaleTimeString(),
  } = context;

  const taskTrim = rawTask.trim();

  // Case 1: skill name → load and embed skill steps
  if (looksLikeSkillName(taskTrim)) {
    const skillContent = await loadSkillContent(taskTrim);
    if (skillContent) {
      return `## Background Task Execution
You are Dori running a scheduled skill. The user is NOT online — execute fully and autonomously.
Current time: ${time} | User: ${userName} | Location: ${location}

## Skill: ${taskTrim}
${skillContent.trim()}

## Execution Rules
- Follow the skill steps exactly in order
- Do not ask for confirmation — just do it
- If a step fails, try once then continue to next step
- Send results to WhatsApp unless the skill says otherwise
- Keep messages clean, friendly, and concise

Execute now.`;
    }
  }

  // Case 2: regular task description → detect tools
  const tools     = detectTools(taskTrim);
  const toolSteps = tools.map((t,i) => `  ${i+1}. ${t.tool} — ${t.desc}`).join("\n");

  return `## Background Task Execution
You are Dori running a scheduled background task. The user is NOT online — execute fully and autonomously.
Current time: ${time} | User: ${userName} | Location: ${location}

## Main Task
${taskTrim}

## Tools to Use (in order)
${toolSteps}

## Execution Rules
- Execute all steps completely — do not stop halfway
- Do not ask for confirmation — just do it
- If a tool fails, try once more then skip and continue
- Send results to WhatsApp unless task says otherwise
- Keep the WhatsApp message clean, friendly, and concise

## User's Exact Need
${taskTrim}

Execute now.`;
}

export default { buildTaskPrompt };