import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inspect } from "util";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, "../logs");
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
let currentLevel = "info";

function getLogFile() {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `dori-${date}.jsonl`);
}

function writeJsonLine(obj) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(getLogFile(), JSON.stringify(obj) + "\n", "utf-8");
  } catch {}
}

function writeLog(subsystem, level, args) {
  if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(currentLevel)) return;
  const entry = {
    ts: Date.now(),
    time: new Date().toISOString(),
    level,
    subsystem,
    args: args.map(a => typeof a === "string" ? a : inspect(a, { depth: 2, compact: true })),
  };
  writeJsonLine(entry);
  // also print to console with color
  const colors = { trace: "\x1b[90m", debug: "\x1b[36m", info: "\x1b[32m", warn: "\x1b[33m", error: "\x1b[31m", fatal: "\x1b[35m" };
  const reset = "\x1b[0m";
  const time = new Date().toLocaleTimeString();
  console.log(`${colors[level]}[${time}] ${level.toUpperCase()} [${subsystem}]${reset}`, ...args);
}

export function createLogger(subsystem) {
  return {
    subsystem,
    trace: (...args) => writeLog(subsystem, "trace", args),
    debug: (...args) => writeLog(subsystem, "debug", args),
    info:  (...args) => writeLog(subsystem, "info",  args),
    warn:  (...args) => writeLog(subsystem, "warn",  args),
    error: (...args) => writeLog(subsystem, "error", args),
    fatal: (...args) => writeLog(subsystem, "fatal", args),
  };
}

export function setLogLevel(level) {
  if (LOG_LEVELS.includes(level)) currentLevel = level;
}

export function getLogFile_export() {
  return getLogFile();
}

export default createLogger;