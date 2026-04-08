/**
 * Agents/hooks/trigger.js
 *
 * Scheduler + trigger system for Dori.
 * Runs every 10 minutes — checks pending/daily tasks and fires them.
 */

import "dotenv/config";
import fs   from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../../utils/logger.js";

const log         = createLogger("trigger");
const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const WAKEUP_FILE = path.join(__dirname, "../../data/wakeup.json");

// ── setAgentRunning — used by agent.js to signal busy state ──────────────────
let _agentRunning = false;
export function setAgentRunning(val) { _agentRunning = Boolean(val); }
export function isAgentRunning()     { return _agentRunning; }

// ── Parse time string → today's Date ─────────────────────────────────────────
function parseTime(timeStr) {
  if (!timeStr) return null;
  const now = new Date();

  const m12 = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1]);
    const m = parseInt(m12[2]);
    const p = m12[3].toLowerCase();
    if (p === "pm" && h < 12) h += 12;
    if (p === "am" && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    return d;
  }

  const m24 = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const d = new Date(now);
    d.setHours(parseInt(m24[1]), parseInt(m24[2]), 0, 0);
    return d;
  }

  return null;
}

// ── Load / save wakeup data ───────────────────────────────────────────────────
async function loadWakeup() {
  try {
    const raw = await fs.readFile(WAKEUP_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { pendingTasks: [], dailyTasks: [], runs: [], completedTasks: [] };
  }
}

async function saveWakeup(data) {
  try {
    await fs.writeFile(WAKEUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch {}
}

// ── Execute a scheduled task ──────────────────────────────────────────────────
async function executeTask(task, taskId) {
  log.info(`[trigger] Firing: "${task.slice(0, 80)}"`);

  // If Dori is busy → skip this cycle, will retry next interval
  if (_agentRunning) {
    log.warn(`[trigger] Dori busy — skipping "${task.slice(0, 60)}" (will retry next cycle)`);
    return { status: "skipped", action: null };
  }

  try {
    const { runAgentTrigger } = await import("../agent.js");
    const prompt   = `[Scheduled task — execute now]\n\n${task}`;
    const response = await runAgentTrigger(prompt);

    const isAction = response && response !== "NO_ACTION";
    log.info(`[trigger] Task ${isAction ? "executed" : "no-action"}: "${task.slice(0, 60)}"`);

    return {
      status:   isAction ? "action_taken" : "no_action",
      action:   isAction ? task : null,
      response: isAction ? response : "NO_ACTION",
    };
  } catch (e) {
    log.error(`[trigger] executeTask error: ${e.message}`);
    return { status: "error", action: null, response: null, error: e.message };
  }
}

// ── Main trigger loop ─────────────────────────────────────────────────────────
export async function runTrigger() {
  const now  = new Date();
  const data = await loadWakeup();

  const run = {
    timestamp: now.toISOString(),
    status:    "no_action",
    action:    null,
    response:  "NO_ACTION",
    error:     null,
  };

  try {
    const { pendingTasks = [], dailyTasks = [] } = data;

    // ── One-off pending tasks ────────────────────────────────────────────────
    for (const task of pendingTasks) {
      if (task.done) continue;
      const scheduledTime = new Date(task.scheduledTime);
      if (now < scheduledTime) continue;

      const result = await executeTask(task.task, task.id);
      Object.assign(run, result);

      if (result.status !== "skipped") {
        task.done        = true;
        task.completedAt = now.toISOString();
        data.completedTasks = data.completedTasks || [];
        data.completedTasks.push({ task: task.task, completedAt: task.completedAt });
      }
      break; // one task per cycle
    }

    // ── Daily recurring tasks ────────────────────────────────────────────────
    if (run.status === "no_action") {
      const today = now.toDateString();

      for (const task of dailyTasks) {
        if (!task.enabled) continue;
        if (task.lastRanOn === today) continue;

        if (task.time) {
          const scheduledTime = parseTime(task.time);
          if (!scheduledTime || now < scheduledTime) continue;
        }

        const result = await executeTask(task.task, task.id);
        Object.assign(run, result);

        if (result.status !== "skipped") {
          task.lastRanOn = today;
        }
        break; // one task per cycle
      }
    }

  } catch (e) {
    log.error(`[trigger] runTrigger error: ${e.message}`);
    run.status = "error";
    run.error  = e.message;
  }

  // Save run log (keep last 100)
  data.runs = data.runs || [];
  data.runs.push(run);
  if (data.runs.length > 100) data.runs = data.runs.slice(-100);
  data.totalRuns = (data.totalRuns || 0) + 1;
  data.lastRun   = now.toISOString();
  await saveWakeup(data);

  return run;
}

// ── Start the trigger interval (call once from main.js) ──────────────────────
let _triggerStarted = false;

export function startTrigger(intervalMs = 10 * 60 * 1000) {
  if (_triggerStarted) return;
  _triggerStarted = true;
  log.info(`[trigger] Started — interval: ${intervalMs / 1000}s`);
  runTrigger().catch(e => log.error(`[trigger] First run error: ${e.message}`));
  setInterval(() => {
    runTrigger().catch(e => log.error(`[trigger] Interval error: ${e.message}`));
  }, intervalMs);
}