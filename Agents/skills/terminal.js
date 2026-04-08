import { exec } from "child_process";
import { promisify } from "util";
import os from "os";
import path from "path";

const execAsync = promisify(exec);
const isWin = process.platform === "win32";

// ─── Output cap — LLM crashes on tool results > ~2000 chars ──────────────────
const MAX_OUT = 1800;

function cap(text) {
  const s = String(text ?? "");
  if (s.length <= MAX_OUT) return s;
  return s.slice(0, MAX_OUT) + `\n⚠️ [Truncated — ${s.length} total chars]`;
}

// ─── Core shell runner — the ONLY place we call exec ─────────────────────────
async function sh(cmd, { cwd, timeoutMs = 10000 } = {}) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: cwd ?? process.cwd(),
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 512 * 1024,           // 512 KB — prevents OOM on huge outputs
      shell: isWin ? "cmd.exe" : true, // cmd.exe is faster than the default shell wrapper
    });

    const out = (stdout ?? "").trim();
    const err = (stderr ?? "").trim();

    if (out && err) return cap(`${out}\n[stderr]: ${err}`);
    return cap(out || err || "✅ Done");
  } catch (e) {
    // Return partial stdout if we got any before the error
    const partial = (e.stdout ?? "").trim();
    const errMsg  = ((e.stderr ?? e.message) || "unknown error").trim().slice(0, 300);

    if (e.killed || e.signal === "SIGTERM") {
      return `⏱️ Command timed out after ${timeoutMs / 1000}s`;
    }
    if (partial) return cap(`${partial}\n❌ ${errMsg}`);
    return `❌ ${errMsg}`;
  }
}

// ─── Path resolver ────────────────────────────────────────────────────────────
function resolve(p) {
  if (!p) return process.cwd();
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

// ─── Dangerous command guard ──────────────────────────────────────────────────
const DANGER_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/i,            // rm -rf /
  /format\s+[a-z]:\s*$/i,            // format C:
  /rd\s+\/s\s+\/q\s+[a-z]:\\/i,     // rd /s /q C:\
  /del\s+\/[sqf]+\s+[a-z]:\\/i,     // del /s /q C:\
  /mkfs\.\w+/,                        // mkfs.ext4 etc
  /dd\s+.*of=\/dev\/[hsv]d[a-z]\b/, // dd to raw disk
];

function dangerous(cmd) {
  return DANGER_PATTERNS.some(r => r.test(cmd));
}

// ════════════════════════════════════════════════════════════════════════════
// 1. RUN ANY SHELL COMMAND
// ════════════════════════════════════════════════════════════════════════════
export async function runTerminalCommand(command, cwd) {
  if (!command?.trim()) return "❌ No command provided";

  if (dangerous(command)) {
    return `🚫 Blocked — command looks destructive. Confirm explicitly if intentional.`;
  }

  return sh(command, {
    cwd: cwd ? resolve(cwd) : process.cwd(),
    timeoutMs: 20000,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 2. NPM — clean output, strips install noise
// ════════════════════════════════════════════════════════════════════════════
export async function runNpm(command, cwd) {
  if (!command?.trim()) return "❌ No npm command provided";

  const workDir = cwd ? resolve(cwd) : process.cwd();

  // ✅ --no-progress: no spinner garbage in output
  // ✅ --loglevel=warn for installs: hides audit/fetch noise, keeps warnings+errors
  const isInstall = /^(install|i|ci|update|add)\b/.test(command.trim());
  const extra = isInstall ? "--no-progress --loglevel=warn" : "";
  const cmd = `npm ${command} ${extra}`.trimEnd();

  const raw = await sh(cmd, {
    cwd: workDir,
    timeoutMs: 120000, // 2 min — npm install can be slow on first run
  });

  // Strip useless npm timing/http/notice lines
  const cleaned = raw
    .split("\n")
    .filter(l => l.trim() && !/^npm (timing|http|notice WARN|ERR! timing)/.test(l))
    .join("\n");

  return cap(cleaned || "✅ npm done");
}

// ════════════════════════════════════════════════════════════════════════════
// 3. GIT
// ════════════════════════════════════════════════════════════════════════════
export async function runGit(command, cwd) {
  if (!command?.trim()) return "❌ No git command provided";

  const workDir = cwd ? resolve(cwd) : process.cwd();
  return sh(`git ${command}`, { cwd: workDir, timeoutMs: 30000 });
}

// ════════════════════════════════════════════════════════════════════════════
// 4. CLEAR TEMP FILES — PARALLEL (3x faster than old sequential version)
// ════════════════════════════════════════════════════════════════════════════
export async function clearTemp() {
  if (!isWin) {
    await sh("rm -rf /tmp/* 2>/dev/null || true", { timeoutMs: 10000 });
    return "🧹 /tmp cleared";
  }

  const targets = [
    { label: "%TEMP%",               cmd: `del /F /S /Q "%TEMP%\\*" 2>nul` },
    { label: "C:\\Windows\\Temp",    cmd: `del /F /S /Q "C:\\Windows\\Temp\\*" 2>nul` },
    { label: "%LOCALAPPDATA%\\Temp", cmd: `del /F /S /Q "%LOCALAPPDATA%\\Temp\\*" 2>nul` },
  ];

  // ✅ All 3 run at the same time — was running one by one before (3x slower)
  const settled = await Promise.allSettled(
    targets.map(t => sh(t.cmd, { timeoutMs: 15000 }))
  );

  const lines = settled.map((r, i) => {
    const ok = r.status === "fulfilled" && !r.value.startsWith("❌");
    return ok
      ? `✅ Cleared: ${targets[i].label}`
      : `⚠️ Partial: ${targets[i].label} (some files may be locked)`;
  });

  return `🧹 Temp cleanup complete:\n${lines.join("\n")}`;
}

// ════════════════════════════════════════════════════════════════════════════
// 5. FLUSH DNS CACHE
// ════════════════════════════════════════════════════════════════════════════
export async function clearDnsCache() {
  const cmd = isWin
    ? "ipconfig /flushdns"
    : "sudo dscacheutil -flushcache 2>/dev/null; sudo killall -HUP mDNSResponder 2>/dev/null || sudo systemd-resolve --flush-caches 2>/dev/null";

  const result = await sh(cmd, { timeoutMs: 8000 });
  return `🌐 DNS cache flushed:\n${result}`;
}

// ════════════════════════════════════════════════════════════════════════════
// 6. CLEAR BROWSER CACHE — supports 5 browsers
// ════════════════════════════════════════════════════════════════════════════
export async function clearBrowserCache(browser = "chrome") {
  if (!isWin) return "⚠️ Browser cache clearing only supported on Windows";

  const LOCAL   = process.env.LOCALAPPDATA ?? "";
  const ROAMING = process.env.APPDATA ?? "";

  const cacheMap = {
    chrome:  `${LOCAL}\\Google\\Chrome\\User Data\\Default\\Cache`,
    edge:    `${LOCAL}\\Microsoft\\Edge\\User Data\\Default\\Cache`,
    brave:   `${LOCAL}\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Cache`,
    firefox: `${ROAMING}\\Mozilla\\Firefox\\Profiles`,
    opera:   `${ROAMING}\\Opera Software\\Opera Stable\\Cache`,
  };

  const key = browser.toLowerCase().trim();
  const cachePath = cacheMap[key];

  if (!cachePath) {
    return `❌ Unknown browser: "${browser}"\nSupported: ${Object.keys(cacheMap).join(", ")}`;
  }

  const result = await sh(`rd /S /Q "${cachePath}" 2>nul`, { timeoutMs: 12000 });

  // rd exits with error if dir doesn't exist or browser is open
  if (result.startsWith("❌") || result.includes("being used")) {
    return `⚠️ Could not clear ${browser} cache — close the browser first and retry`;
  }
  return `🧹 ${browser} cache cleared`;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════════════════
export default {
  runTerminalCommand,
  runNpm,
  runGit,
  clearTemp,
  clearDnsCache,
  clearBrowserCache,
};