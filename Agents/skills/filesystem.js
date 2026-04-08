/**
 * filesystem.js — Dori AI File System Skill
 *
 * ARCHITECTURE:
 * ─────────────────────────────────────────────────────────────────────
 * SEARCH STRATEGY (fastest → slowest, auto-selected):
 *   1. Windows Search Index (Everything-like) via PowerShell WDS query — <1s
 *   2. Smart targeted dir scan (known folders: Desktop, Docs, Downloads, etc) — 2-5s
 *   3. Full C:\ scan — last resort only, skips Windows/System32/node_modules — 10-20s
 *
 * OUTPUT CAP: All results hard-capped at 1800 chars to prevent LLM crash.
 * PAGINATION: readFile shows first 80 lines. readChunk(startLine, endLine) for more.
 * ─────────────────────────────────────────────────────────────────────
 */

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";

const execAsync = promisify(exec);
const isWin = process.platform === "win32";

// ─── Hard output cap — grok-4.1-fast crashes on >2000 char tool results ──────
const MAX_OUT = 1800;

function cap(text, hint = "") {
  if (!text || text.length <= MAX_OUT) return text;
  return (
    text.slice(0, MAX_OUT) +
    `\n⚠️ [Capped at ${MAX_OUT} chars — ${text.length} total]` +
    (hint ? `\n💡 ${hint}` : "")
  );
}

// ─── Shell runner ──────────────────────────────────────────────────────────────
async function sh(cmd, timeoutMs = 12000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    return (stdout || stderr || "").trim();
  } catch (e) {
    const out = (e.stdout || "").trim();
    return out || `ERROR: ${e.message.slice(0, 200)}`;
  }
}

// ─── Path helpers ──────────────────────────────────────────────────────────────
function resolve(p) {
  if (!p) return process.cwd();
  if (p.startsWith("~")) return path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

const HOME = os.homedir();

// Common user locations to search first (ordered by likelihood)
const SMART_ROOTS = [
  `${HOME}\\Documents`,
  `${HOME}\\Desktop`,
  `${HOME}\\Downloads`,
  `${HOME}\\Projects`,
  `${HOME}\\dev`,
  `${HOME}\\repos`,
  `${HOME}`,
  `C:\\Users`,
];

// ══════════════════════════════════════════════════════════════════════════════
// 1. FIND FOLDER — ultra-fast via Windows Search Index, falls back to smart scan
// ══════════════════════════════════════════════════════════════════════════════
export async function findFolder(namePattern) {
  if (!namePattern) return "❌ Provide a folder name or pattern";

  const results = [];

  if (isWin) {
    // ── Strategy 1: Windows Search Index (WDS) via PowerShell — <1s ──────────
    // Uses the same index as Windows Explorer search
    const wdsCmd = `powershell -NoProfile -NonInteractive -Command "` +
      `$query = 'SELECT System.ItemPathDisplay FROM SystemIndex WHERE ` +
      `System.ItemType = ''Directory'' AND System.FileName LIKE ''%${namePattern}%'''; ` +
      `$con = New-Object -ComObject ADODB.Connection; ` +
      `$con.Open('Provider=Search.CollatorDSO;Extended Properties=\\'Application=Windows\\''); ` +
      `$rs = $con.Execute($query); ` +
      `while(-not $rs.EOF){ Write-Output $rs.Fields.Item(0).Value; $rs.MoveNext() } ` +
      `$con.Close()" 2>nul`;

    try {
      const wdsResult = await sh(wdsCmd, 5000);
      if (wdsResult && !wdsResult.startsWith("ERROR")) {
        const paths = wdsResult.split("\n").map(l => l.trim()).filter(l => l && !l.includes("ERROR"));
        results.push(...paths.slice(0, 10));
      }
    } catch {}

    // ── Strategy 2: Smart targeted scan of common user folders — 2-5s ─────────
    if (results.length === 0) {
      const psSmartCmd = `powershell -NoProfile -NonInteractive -Command "` +
        `$roots = @('${SMART_ROOTS.join("','")}'); ` +
        `foreach($r in $roots){ ` +
        `  if(Test-Path $r){ ` +
        `    Get-ChildItem -Path $r -Recurse -Directory -Filter '*${namePattern}*' ` +
        `    -ErrorAction SilentlyContinue -Depth 5 | ` +
        `    Select-Object -First 5 -ExpandProperty FullName ` +
        `  } ` +
        `} " 2>nul`;

      const smartResult = await sh(psSmartCmd, 15000);
      if (smartResult && !smartResult.startsWith("ERROR")) {
        const paths = smartResult.split("\n").map(l => l.trim()).filter(Boolean);
        results.push(...paths.slice(0, 10));
      }
    }

    // ── Strategy 3: Full C:\ scan — only if nothing found yet — skip heavy dirs
    if (results.length === 0) {
      const skipDirs = "Windows,System32,SysWOW64,WinSxS,node_modules,Program Files,ProgramData".split(",");
      const excludes = skipDirs.map(d => `-Exclude '*${d}*'`).join(" ");
      const fullCmd = `powershell -NoProfile -NonInteractive -Command "` +
        `Get-ChildItem -Path 'C:\\Users' -Recurse -Directory -Filter '*${namePattern}*' ` +
        `-ErrorAction SilentlyContinue -Depth 8 | ` +
        `Select-Object -First 10 -ExpandProperty FullName" 2>nul`;

      const fullResult = await sh(fullCmd, 25000);
      if (fullResult && !fullResult.startsWith("ERROR")) {
        const paths = fullResult.split("\n").map(l => l.trim()).filter(Boolean);
        results.push(...paths);
      }
    }

  } else {
    // Linux/Mac: use locate (instant) or find with smart roots
    const locateResult = await sh(`locate -i -l 10 "${namePattern}" 2>/dev/null | grep -v node_modules`, 3000);
    if (locateResult) results.push(...locateResult.split("\n").filter(Boolean));
    else {
      const findResult = await sh(`find ~ -type d -iname "*${namePattern}*" 2>/dev/null | head -10`, 15000);
      if (findResult) results.push(...findResult.split("\n").filter(Boolean));
    }
  }

  const unique = [...new Set(results)].filter(Boolean);

  if (!unique.length) return `🔍 No folder matching "${namePattern}" found.\n💡 Try a shorter/fuzzier name.`;

  return [
    `📁 Found ${unique.length} folder(s) matching "${namePattern}":`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...unique.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. FIND FILE — same 3-strategy approach
// ══════════════════════════════════════════════════════════════════════════════
export async function findFile(namePattern, searchDir = "") {
  if (!namePattern) return "❌ Provide a file name or pattern";

  const results = [];
  const inDir = searchDir ? resolve(searchDir) : "";

  if (isWin) {
    if (inDir) {
      // Search within specific directory — fast
      const cmd = `powershell -NoProfile -NonInteractive -Command "` +
        `Get-ChildItem -Path '${inDir}' -Recurse -Filter '*${namePattern}*' ` +
        `-ErrorAction SilentlyContinue -File | Select-Object -First 10 -ExpandProperty FullName"`;
      const r = await sh(cmd, 15000);
      if (r && !r.startsWith("ERROR")) results.push(...r.split("\n").map(l => l.trim()).filter(Boolean));
    } else {
      // Strategy 1: WDS index
      const wdsCmd = `powershell -NoProfile -NonInteractive -Command "` +
        `$query = 'SELECT System.ItemPathDisplay FROM SystemIndex WHERE ` +
        `System.ItemType <> ''Directory'' AND System.FileName LIKE ''%${namePattern}%'''; ` +
        `$con = New-Object -ComObject ADODB.Connection; ` +
        `$con.Open('Provider=Search.CollatorDSO;Extended Properties=\\'Application=Windows\\''); ` +
        `$rs = $con.Execute($query); ` +
        `while(-not $rs.EOF){ Write-Output $rs.Fields.Item(0).Value; $rs.MoveNext() } ` +
        `$con.Close()" 2>nul`;
      try {
        const r = await sh(wdsCmd, 5000);
        if (r && !r.startsWith("ERROR")) results.push(...r.split("\n").map(l => l.trim()).filter(l => l));
      } catch {}

      // Strategy 2: smart roots
      if (results.length === 0) {
        const roots = SMART_ROOTS.filter(r => r).join("','");
        const cmd = `powershell -NoProfile -NonInteractive -Command "` +
          `$roots = @('${roots}'); ` +
          `foreach($r in $roots){ if(Test-Path $r){ ` +
          `Get-ChildItem -Path $r -Recurse -Filter '*${namePattern}*' -File ` +
          `-ErrorAction SilentlyContinue -Depth 6 | Select-Object -First 5 -ExpandProperty FullName } }`;
        const r = await sh(cmd, 20000);
        if (r && !r.startsWith("ERROR")) results.push(...r.split("\n").map(l => l.trim()).filter(Boolean));
      }
    }
  } else {
    const root = inDir || "~";
    const r = await sh(`find ${root} -iname "*${namePattern}*" -not -path "*/node_modules/*" 2>/dev/null | head -10`, 15000);
    if (r) results.push(...r.split("\n").filter(Boolean));
  }

  const unique = [...new Set(results)].filter(Boolean).slice(0, 10);
  if (!unique.length) return `🔍 No file matching "${namePattern}" found.`;

  return [
    `📄 Found ${unique.length} file(s) matching "${namePattern}":`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ...unique.map((p, i) => `${i + 1}. ${p}`),
  ].join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. LIST FOLDER CONTENTS
// ══════════════════════════════════════════════════════════════════════════════
export async function listFolder(dirPath = ".") {
  try {
    const resolved = resolve(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    if (!entries.length) return `📁 ${resolved}\n(empty)`;

    const folders = entries.filter(e => e.isDirectory()).map(e => `📁 ${e.name}/`);
    const files   = entries.filter(e => e.isFile()).map(e => `📄 ${e.name}`);
    const out = [
      `📂 ${resolved} (${folders.length} folders, ${files.length} files)`,
      `━━━━━━━━━━━━━━━━━━━━`,
      ...[...folders, ...files],
    ].join("\n");

    return cap(out, "Ask to list a subfolder for more details.");
  } catch (e) {
    return `❌ listFolder: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. READ FILE — first 80 lines, paginated
// ══════════════════════════════════════════════════════════════════════════════
export async function readFile(filePath, startLine = 1, endLine = 80) {
  if (!filePath) return "❌ No file path provided";
  try {
    const resolved = resolve(filePath);
    const raw = await fs.readFile(resolved, "utf-8");
    const lines = raw.split("\n");
    const total = lines.length;
    const totalChars = raw.length;

    const s = Math.max(1, startLine) - 1;
    const e = Math.min(endLine, total);
    const chunk = lines.slice(s, e).join("\n");

    const header = [
      `📄 ${resolved}`,
      `📦 ${totalChars} chars | ${total} lines | showing lines ${s + 1}–${e}`,
      `━━━━━━━━━━━━━━━━━━━━`,
    ].join("\n");

    const body = cap(chunk, e < total ? `Say "read lines ${e + 1}-${e + 80} of ${path.basename(resolved)}" to continue.` : "");
    const footer = e < total
      ? `\n💡 ${total - e} more lines. Say "read lines ${e + 1}-${e + 80} of ${path.basename(resolved)}"`
      : "\n✅ End of file";

    return header + "\n" + body + footer;
  } catch (e) {
    return `❌ readFile: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. WRITE / CREATE FILE
// ══════════════════════════════════════════════════════════════════════════════
export async function writeFile(filePath, content = "") {
  if (!filePath) return "❌ No file path provided";
  try {
    const resolved = resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.writeFile(resolved, content, "utf-8");
    const lines = content.split("\n").length;
    return `✅ Written: ${resolved}\n📦 ${content.length} chars | ${lines} lines`;
  } catch (e) {
    return `❌ writeFile: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. UPDATE FILE — replace a specific section
// ══════════════════════════════════════════════════════════════════════════════
export async function updateFile(filePath, oldText, newText) {
  if (!filePath) return "❌ No file path provided";
  try {
    const resolved = resolve(filePath);
    const raw = await fs.readFile(resolved, "utf-8");
    if (!raw.includes(oldText)) return `❌ Text not found in ${path.basename(resolved)}:\n"${oldText.slice(0, 100)}"`;
    const updated = raw.replace(oldText, newText);
    await fs.writeFile(resolved, updated, "utf-8");
    return `✅ Updated: ${resolved}\n📝 Replaced ${oldText.length} chars → ${newText.length} chars`;
  } catch (e) {
    return `❌ updateFile: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. APPEND TO FILE
// ══════════════════════════════════════════════════════════════════════════════
export async function appendFile(filePath, content) {
  if (!filePath) return "❌ No file path provided";
  try {
    const resolved = resolve(filePath);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    await fs.appendFile(resolved, content, "utf-8");
    return `✅ Appended ${content.length} chars to: ${resolved}`;
  } catch (e) {
    return `❌ appendFile: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. DELETE FILE OR FOLDER
// ══════════════════════════════════════════════════════════════════════════════
export async function deleteItem(itemPath) {
  if (!itemPath) return "❌ No path provided";
  try {
    const resolved = resolve(itemPath);
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) {
      await fs.rm(resolved, { recursive: true, force: true });
      return `✅ Deleted folder: ${resolved}`;
    } else {
      await fs.unlink(resolved);
      return `✅ Deleted file: ${resolved}`;
    }
  } catch (e) {
    if (e.code === "ENOENT") return `⚠️ Not found: ${itemPath}`;
    return `❌ deleteItem: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. COPY FILE OR FOLDER
// ══════════════════════════════════════════════════════════════════════════════
export async function copyItem(src, dest) {
  if (!src || !dest) return "❌ Provide both source and destination";
  try {
    const s = resolve(src), d = resolve(dest);
    await fs.mkdir(path.dirname(d), { recursive: true });
    const stat = await fs.stat(s);
    if (stat.isDirectory()) {
      await fs.cp(s, d, { recursive: true });
      return `✅ Copied folder: ${s} → ${d}`;
    }
    await fs.copyFile(s, d);
    return `✅ Copied: ${s} → ${d}`;
  } catch (e) {
    return `❌ copyItem: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. MOVE / RENAME
// ══════════════════════════════════════════════════════════════════════════════
export async function moveItem(src, dest) {
  if (!src || !dest) return "❌ Provide both source and destination";
  try {
    const s = resolve(src), d = resolve(dest);
    await fs.mkdir(path.dirname(d), { recursive: true });
    await fs.rename(s, d);
    return `✅ Moved: ${s} → ${d}`;
  } catch (e) {
    // cross-device fallback
    try {
      await copyItem(src, dest);
      await deleteItem(src);
      return `✅ Moved (copy+delete): ${src} → ${dest}`;
    } catch {
      return `❌ moveItem: ${e.message}`;
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 11. FILE / FOLDER INFO
// ══════════════════════════════════════════════════════════════════════════════
export async function itemInfo(itemPath) {
  if (!itemPath) return "❌ No path provided";
  try {
    const resolved = resolve(itemPath);
    const stat = await fs.stat(resolved);
    return [
      `📄 ${resolved}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `🗂️  Type    : ${stat.isDirectory() ? "Folder" : "File"}`,
      `📦 Size    : ${stat.size} bytes (${(stat.size / 1024).toFixed(1)} KB)`,
      `🕐 Modified: ${stat.mtime.toLocaleString()}`,
      `🕐 Created : ${stat.birthtime.toLocaleString()}`,
    ].join("\n");
  } catch (e) {
    if (e.code === "ENOENT") return `⚠️ Not found: ${itemPath}`;
    return `❌ itemInfo: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 12. FIND FOLDER THEN LIST IT — combo for "find folder X and show its files"
// ══════════════════════════════════════════════════════════════════════════════
export async function findFolderAndList(namePattern) {
  const found = await findFolder(namePattern);
  if (found.includes("No folder") || found.includes("❌")) return found;

  // extract first path
  const lines = found.split("\n").filter(l => /^\d+\./.test(l));
  if (!lines.length) return found;
  const firstPath = lines[0].replace(/^\d+\.\s*/, "").trim();

  const listing = await listFolder(firstPath);
  return `${found}\n\n${listing}`;
}

// ══════════════════════════════════════════════════════════════════════════════
// 13. FIND FILE AND READ IT — combo for "find X and read it"
// ══════════════════════════════════════════════════════════════════════════════
export async function findFileAndRead(namePattern, searchDir = "") {
  const found = await findFile(namePattern, searchDir);
  if (found.includes("No file") || found.includes("❌")) return found;

  const lines = found.split("\n").filter(l => /^\d+\./.test(l));
  if (!lines.length) return found;
  const firstPath = lines[0].replace(/^\d+\.\s*/, "").trim();

  return readFile(firstPath, 1, 80);
}

export default {
  findFolder,
  findFile,
  listFolder,
  readFile,
  writeFile,
  updateFile,
  appendFile,
  deleteItem,
  copyItem,
  moveItem,
  itemInfo,
  findFolderAndList,
  findFileAndRead,
};