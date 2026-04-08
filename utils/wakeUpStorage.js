import fs   from "fs/promises";
import path  from "path";
import { fileURLToPath } from "url";
import { randomUUID }    from "crypto";
import { buildTaskPrompt } from "./wakeupPromptBuilder.js";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const WAKEUP_FILE = path.join(__dirname, "../data/wakeup.json");

const DEFAULT = {
  runs:           [],
  completedTasks: [],
  pendingTasks:   [],   // one-off tasks
  dailyTasks:     [],   // recurring daily tasks
  totalRuns:      0,
  lastRun:        null,
};

// ── Write queue — no race conditions ─────────────────────────────────────────
let writeQueue = Promise.resolve();
function enqueue(fn) {
  writeQueue = writeQueue.then(fn).catch(() => {});
  return writeQueue;
}

// ── Low-level read/write ──────────────────────────────────────────────────────
async function readWakeUp() {
  try {
    const raw = await fs.readFile(WAKEUP_FILE, "utf-8");
    if (!raw.trim()) return { ...DEFAULT };
    const data = JSON.parse(raw);
    if (!data.dailyTasks) data.dailyTasks = [];
    return data;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[wakeUpStorage] read error:", err.message);
    return { ...DEFAULT };
  }
}

async function writeWakeUp(data) {
  await fs.mkdir(path.dirname(WAKEUP_FILE), { recursive: true });
  await fs.writeFile(WAKEUP_FILE, JSON.stringify(data, null, 2));
}

async function updateWakeUp(updater) {
  return enqueue(async () => {
    const data    = await readWakeUp();
    const updated = await updater({
      runs:           data.runs           || [],
      completedTasks: data.completedTasks || [],
      pendingTasks:   data.pendingTasks   || [],
      dailyTasks:     data.dailyTasks     || [],
      totalRuns:      data.totalRuns      || 0,
      lastRun:        data.lastRun        || null,
    });
    await writeWakeUp(updated);
    return updated;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── One-off tasks ─────────────────────────────────────────────────────────────
export async function logTriggerRun({ status, action, response, error }) {
  await updateWakeUp(data => {
    data.runs.push({
      timestamp: new Date().toISOString(),
      status,
      action:   action   || null,
      response: response ? response.slice(0, 300) : null,
      error:    error    || null,
    });
    if (data.runs.length > 100) data.runs = data.runs.slice(-100);
    data.lastRun  = new Date().toISOString();
    data.totalRuns += 1;
    return data;
  });
}

export async function savePendingTask(task, scheduledTime) {
  const id     = randomUUID();
  const prompt = await buildTaskPrompt(task);
  await updateWakeUp(data => {
    data.pendingTasks.push({ id, task, prompt, scheduledTime, createdAt: new Date().toISOString(), done: false });
    return data;
  });
  return { id, message: `✅ Task scheduled: "${task}" at ${scheduledTime}` };
}

export async function markTaskDone(id) {
  await updateWakeUp(data => {
    const task = data.pendingTasks.find(t => t.id === id);
    if (task) { task.done = true; task.completedAt = new Date().toISOString(); }
    return data;
  });
}

export async function saveCompletedTask(taskDescription) {
  await updateWakeUp(data => {
    data.completedTasks.push({ task: taskDescription, completedAt: new Date().toISOString() });
    if (data.completedTasks.length > 50) data.completedTasks = data.completedTasks.slice(-50);
    return data;
  });
}

export async function getPendingTasks() {
  const data = await readWakeUp();
  return (data.pendingTasks || []).filter(t => !t.done);
}

export async function getCompletedTasks() {
  const data = await readWakeUp();
  return (data.completedTasks || []).map(t => t.task);
}

// ── Daily recurring tasks ─────────────────────────────────────────────────────

/**
 * Save a new daily task.
 * @param {string} task       - What to execute
 * @param {string} timeStr    - "9:00am", "21:30", "8am" — or null for "anytime once per day"
 */
export async function saveDailyTask(task, timeStr = null) {
  const id     = randomUUID();
  const prompt = await buildTaskPrompt(task);  // async — loads skill file if skill name
  await updateWakeUp(data => {
    data.dailyTasks.push({
      id,
      task,
      prompt,                     // ← rich structured execution prompt
      time:      timeStr || null,
      enabled:   true,
      lastRanOn: null,
      createdAt: new Date().toISOString(),
    });
    return data;
  });
  return { id, message: `✅ Daily task saved: "${task}"${timeStr ? ` at ${timeStr}` : " (runs once per day)"}` };
}

/** Get all enabled daily tasks */
export async function getDailyTasks() {
  const data = await readWakeUp();
  return (data.dailyTasks || []).filter(t => t.enabled !== false);
}

/** Mark a daily task as ran today */
export async function markDailyRanToday(id) {
  await updateWakeUp(data => {
    const task = data.dailyTasks.find(t => t.id === id);
    if (task) task.lastRanOn = todayStr();
    return data;
  });
}

/** Check if daily task already ran today */
export function dailyRanToday(task) {
  return task.lastRanOn === todayStr();
}

/** Disable a daily task by id */
export async function disableDailyTask(id) {
  await updateWakeUp(data => {
    const task = data.dailyTasks.find(t => t.id === id);
    if (task) task.enabled = false;
    return data;
  });
}

export async function getWakeUpStats() {
  const data = await readWakeUp();
  return {
    totalRuns:           data.totalRuns || 0,
    lastRun:             data.lastRun   || null,
    lastStatus:          data.runs.at(-1)?.status || null,
    completedTasksCount: data.completedTasks?.length || 0,
    pendingTasksCount:   (data.pendingTasks || []).filter(t => !t.done).length,
    dailyTasksCount:     (data.dailyTasks   || []).filter(t => t.enabled !== false).length,
  };
}