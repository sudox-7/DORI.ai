/**
 * skillLoader.js — Dori AI Skill System
 *
 * Scans workspace/skills/ for SKILL.md files at startup.
 * Parses frontmatter (name, description) + body instructions.
 * Returns a skills prompt section to inject into the system prompt.
 *
 * Skill folder structure:
 *   workspace/skills/
 *     skill-name/
 *       SKILL.md   ← required (frontmatter + instructions)
 *       scripts/   ← optional executable code
 *       refs/      ← optional reference docs
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_DIR = path.join(__dirname, "..", "workspace");
const SKILLS_DIR = path.join(WORKSPACE_DIR, "skills");

// ── Cached skills (reloaded when skill_create is called) ──────────────────────
let cachedSkills = null;

// ── Parse YAML-like frontmatter from SKILL.md ─────────────────────────────────
function parseFrontmatter(content) {
  // Normalize line endings (Windows \r\n → \n)
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    // No frontmatter found — try to use filename as name
    return { frontmatter: {}, body: normalized };
  }

  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) frontmatter[key] = value;
  }

  return { frontmatter, body: match[2].trim() };
};

// ── Load a single skill from its directory ────────────────────────────────────
async function loadSkillFromDir(skillDir) {
  const skillMdPath = path.join(skillDir, "SKILL.md");

  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(content);

    if (!frontmatter.name) {
      console.warn(`[skillLoader] Skipping ${skillDir} — no 'name' in frontmatter`);
      return null;
    }

    return {
      name: frontmatter.name,
      description: frontmatter.description || frontmatter.name,
      body,
      dir: skillDir,
      filePath: skillMdPath,
    };
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`[skillLoader] Error reading ${skillMdPath}:`, err.message);
    }
    return null;
  }
}

// ── Scan workspace/skills/ and load all skills ───────────────────────────────
export async function loadSkills(forceReload = false) {
  if (cachedSkills && !forceReload) return cachedSkills;

  const skills = [];

  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const skill = await loadSkillFromDir(skillDir);
      if (skill) skills.push(skill);
    }
  } catch (err) {
    console.error("[skillLoader] Error scanning skills dir:", err.message);
  }

  cachedSkills = skills;
  console.log(`[skillLoader] Loaded ${skills.length} skill(s):`, skills.map(s => s.name).join(", ") || "(none)");
  return skills;
}

// ── Build the skills section for the system prompt ────────────────────────────
export async function buildSkillsPrompt() {
  const skills = await loadSkills();

  if (skills.length === 0) return "";

  const lines = [
    "## Skills",
    "",
    "You have the following skills available. When the user's request matches a skill's description, follow that skill's instructions precisely.",
    "",
  ];

  for (const skill of skills) {
    lines.push(`### ${skill.name}`);
    lines.push(`**Description:** ${skill.description}`);
    lines.push("");
    lines.push(skill.body);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

// ── Create a new skill from agent tool call ──────────────────────────────────
export async function createSkill(name, description, instructions) {
  if (!name || !description || !instructions) {
    return "❌ name, description, and instructions are all required";
  }

  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
  const skillDir = path.join(SKILLS_DIR, safeName);

  try {
    await fs.mkdir(skillDir, { recursive: true });

    const content = [
      "---",
      `name: ${safeName}`,
      `description: ${description}`,
      "---",
      "",
      instructions,
    ].join("\n");

    await fs.writeFile(path.join(skillDir, "SKILL.md"), content, "utf-8");

    // Reload cache
    await loadSkills(true);

    return `✅ Skill "${safeName}" created at workspace/skills/${safeName}/SKILL.md\n💡 It will be active in the next session (or immediately if reloaded).`;
  } catch (err) {
    return `❌ createSkill failed: ${err.message}`;
  }
}

// ── Load workspace bootstrap files (SOUL, USER, MEMORY, HEARTBEAT) ───────────
export async function loadWorkspaceFiles() {
  const filenames = ["SOUL.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];
  const loaded = [];

  for (const filename of filenames) {
    const filePath = path.join(WORKSPACE_DIR, filename);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      loaded.push({ name: filename, content, path: filePath });
    } catch (err) {
      if (err.code !== "ENOENT") {
        console.error(`[skillLoader] Error reading ${filename}:`, err.message);
      }
      // Skip missing files silently
    }
  }

  return loaded;
}

// ── Build the workspace context section for the system prompt ─────────────────
export async function buildWorkspaceContext() {
  const files = await loadWorkspaceFiles();
  if (files.length === 0) return "";

  const lines = [
    "# Workspace Context",
    "",
    "The following files define who you are, who you're helping, and what you remember.",
    "",
  ];

  for (const file of files) {
    lines.push(`## ${file.name}`);
    lines.push("");
    lines.push(file.content);
    lines.push("");
  }

  return lines.join("\n");
}
// ════════════════════════════════════════════════════════════════════════════
export async function deleteSkill(name) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const skillDir = path.join(SKILLS_DIR, safeName);
  try {
    await fs.rm(skillDir, { recursive: true, force: true });
    await loadSkills(true); // reload cache
    return `✅ Skill "${safeName}" deleted.`;
  } catch (err) {
    return `❌ deleteSkill failed: ${err.message}`;
  }
}

// ════════════════════════════════════════════════════════════════════════════
export async function addHeartbeatTask(task) {
  const filePath = path.join(WORKSPACE_DIR, "HEARTBEAT.md");
  try {
    let content = await fs.readFile(filePath, "utf-8");
    const entry = `- ${task.trim()}`;
    
    // Check if task already exists
    if (content.includes(entry)) return `✅ Task already in HEARTBEAT.md`;
    
    // Find ## Active Tasks section and append after it
    if (content.includes("## Active Tasks")) {
      content = content.replace(
        /## Active Tasks\n/,
        `## Active Tasks\n${entry}\n`
      );
    } else {
      content += `\n## Active Tasks\n${entry}\n`;
    }
    
    await fs.writeFile(filePath, content, "utf-8");
    return `✅ Added to HEARTBEAT.md: "${task}"`;
  } catch (err) {
    return `❌ addHeartbeatTask failed: ${err.message}`;
  }
}
// ════════════════════════════════════════════════════════════════════════════
export async function updateSkill(name, fields) {
  const safeName = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const skillPath = path.join(SKILLS_DIR, safeName, "SKILL.md");

  try {
    const existing = await fs.readFile(skillPath, "utf-8");
    const { frontmatter, body } = parseFrontmatter(existing);

    const newName        = fields.name        ?? frontmatter.name;
    const newDescription = fields.description ?? frontmatter.description;
    const newBody        = fields.instructions ?? body;

    const updated = [
      "---",
      `name: ${newName}`,
      `description: ${newDescription}`,
      "---",
      "",
      newBody,
    ].join("\n");

    await fs.writeFile(skillPath, updated, "utf-8");
    await loadSkills(true);
    return `✅ Skill "${safeName}" updated.`;
  } catch (err) {
    if (err.code === "ENOENT") return `❌ Skill "${name}" not found.`;
    return `❌ updateSkill failed: ${err.message}`;
  }
}

export default {
  loadSkills,
  buildSkillsPrompt,
  createSkill,
  loadWorkspaceFiles,
  buildWorkspaceContext,
  addHeartbeatTask,
  updateSkill,
  deleteSkill

};