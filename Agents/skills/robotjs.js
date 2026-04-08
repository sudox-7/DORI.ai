import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const execAsync = promisify(exec);
const isWin = process.platform === "win32";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, "../../data/screenshots");

async function ensureScreenshotsDir() {
  await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

async function sh(cmd, timeoutMs = 10000) {
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return (stdout || stderr || "").trim();
  } catch (e) {
    return (e.stdout || "").trim() || `ERROR: ${e.message.slice(0, 200)}`;
  }
}

// ══════════════════════════════════════════════════════════════
// OPEN APP
// ══════════════════════════════════════════════════════════════
export async function openApp(appName) {
  const key = appName.toLowerCase().trim();

  const aliases = {
    chrome: "chrome", googlechrome: "chrome",
    firefox: "firefox",
    edge: "msedge", microsoftedge: "msedge",
    brave: "brave",
    vscode: "vscode", "vs code": "vscode", code: "vscode",
    terminal: "terminal", cmd: "terminal", "command prompt": "terminal",
    powershell: "powershell", ps: "powershell",
    git: "gitbash", gitbash: "gitbash", "git bash": "gitbash",
    word: "word", excel: "excel",
    powerpoint: "powerpoint", ppt: "powerpoint",
    outlook: "outlook",
    notepad: "notepad",
    calculator: "calculator", calc: "calculator",
    explorer: "explorer", "file explorer": "explorer",
    taskmanager: "taskmanager", taskmgr: "taskmanager", "task manager": "taskmanager",
    controlpanel: "controlpanel", "control panel": "controlpanel",
    paint: "paint", mspaint: "paint",
    settings: "settings",
    // ✅ Discord variants
    discord: "discord",
    // Social
    spotify: "spotify",
    slack: "slack",
    zoom: "zoom",
    teams: "teams", "microsoft teams": "teams",
    telegram: "telegram",
    whatsapp: "whatsapp",
    skype: "skype",
    steam: "steam",
    obs: "obs", "obs studio": "obs",
    vlc: "vlc",
  };

  const winCmds = {
    chrome:       `start "" "chrome"`,
    firefox:      `start "" "firefox"`,
    msedge:       `start "" "msedge"`,
    brave:        `start "" "brave"`,
    vscode:       `start "" "code"`,
    terminal:     `start "" "cmd"`,
    powershell:   `start "" "powershell"`,
    gitbash:      `start "" "C:\\Program Files\\Git\\git-bash.exe"`,
    word:         `start "" "winword"`,
    excel:        `start "" "excel"`,
    powerpoint:   `start "" "powerpnt"`,
    outlook:      `start "" "outlook"`,
    notepad:      `start "" "notepad"`,
    calculator:   `start "" "calc"`,
    explorer:     `start "" "explorer"`,
    taskmanager:  `start "" "taskmgr"`,
    controlpanel: `start "" "control"`,
    paint:        `start "" "mspaint"`,
    settings:     `start ms-settings:`,
    // ✅ Discord — tries both update launcher and direct exe
    discord:      `start "" "%LOCALAPPDATA%\\Discord\\Update.exe" --processStart Discord.exe`,
    spotify:      `start "" "%APPDATA%\\Spotify\\Spotify.exe"`,
    slack:        `start "" "slack"`,
    zoom:         `start "" "zoom"`,
    teams:        `start ms-teams:`,
    telegram:     `start "" "telegram"`,
    whatsapp:     `start "" "whatsapp"`,
    skype:        `start "" "skype"`,
    steam:        `start "" "steam"`,
    obs:          `start "" "obs64"`,
    vlc:          `start "" "vlc"`,
  };

  if (!isWin) {
    try {
      await execAsync(`open -a "${appName}"`);
      return `✅ Opened: ${appName}`;
    } catch (e) {
      return `❌ Could not open "${appName}": ${e.message}`;
    }
  }

  const resolvedKey = aliases[key] || key;
  const primaryCmd = winCmds[resolvedKey];
  const fallbackCmd = `start "" "${key}"`;

  for (const cmd of [primaryCmd, fallbackCmd].filter(Boolean)) {
    const result = await sh(cmd, 8000);
    if (!result.startsWith("ERROR")) return `✅ Opened: ${appName}`;
  }

  return `❌ Could not open "${appName}" — is it installed?`;
}

// ══════════════════════════════════════════════════════════════
// OPEN VISIBLE TERMINAL IN A SPECIFIC FOLDER
// ✅ Opens a real CMD window the user can see and interact with
// ══════════════════════════════════════════════════════════════
export async function openTerminalInFolder(folderPath, title = "Terminal") {
  if (!folderPath) return "❌ No folder path provided";
  try {
    const resolved = path.resolve(folderPath);
    if (isWin) {
      spawn("cmd.exe", ["/C", `start "${title}" cmd.exe /K "cd /D "${resolved}""` ], {
        detached: true,
        shell: true,
        windowsHide: false, // MUST be false — we want user to see it
        stdio: "ignore",
      }).unref();
    } else {
      spawn("open", ["-a", "Terminal", resolved], { detached: true, stdio: "ignore" }).unref();
    }
    return `✅ Opened terminal window at:\n📁 ${resolved}\n(Check taskbar — CMD window is open)`;
  } catch (e) {
    return `❌ openTerminalInFolder failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// RUN COMMAND IN VISIBLE TERMINAL WINDOW
// ✅ Opens a titled CMD window, CDs to folder, runs command — user sees output live
// ══════════════════════════════════════════════════════════════
export async function runInVisibleTerminal(command, folderPath = "", title = "Dori Terminal") {
  if (!command?.trim()) return "❌ No command provided";
  try {
    const workDir = folderPath ? path.resolve(folderPath) : process.cwd();
    if (isWin) {
      // /K keeps window open so user can see results
      const fullCmd = `start "${title}" cmd.exe /K "cd /D "${workDir}" && ${command}"`;
      spawn("cmd.exe", ["/C", fullCmd], {
        detached: true,
        shell: true,
        windowsHide: false, // visible window
        stdio: "ignore",
      }).unref();
    } else {
      spawn("open", ["-a", "Terminal"], { detached: true, stdio: "ignore" }).unref();
    }
    return `✅ Running in visible terminal window:\n📂 ${workDir}\n💻 ${command}\n(Check taskbar for the CMD window titled "${title}")`;
  } catch (e) {
    return `❌ runInVisibleTerminal failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// CLOSE APP
// ══════════════════════════════════════════════════════════════
export async function closeApp(appName) {
  const key = appName.toLowerCase().trim();
  const processMap = {
    chrome: "chrome.exe", googlechrome: "chrome.exe",
    firefox: "firefox.exe",
    edge: "msedge.exe",
    discord: "Discord.exe",
    spotify: "Spotify.exe",
    slack: "slack.exe",
    zoom: "Zoom.exe",
    teams: "Teams.exe",
    telegram: "Telegram.exe",
    vscode: "Code.exe", code: "Code.exe",
    terminal: "cmd.exe", cmd: "cmd.exe",
    powershell: "powershell.exe",
    notepad: "notepad.exe",
    calculator: "Calculator.exe",
    taskmanager: "Taskmgr.exe",
    explorer: "explorer.exe",
    word: "WINWORD.EXE",
    excel: "EXCEL.EXE",
    powerpoint: "POWERPNT.EXE",
    paint: "mspaint.exe",
    vlc: "vlc.exe",
    steam: "steam.exe",
    obs: "obs64.exe",
  };

  const proc = processMap[key] || `${appName}.exe`;

  const r1 = await sh(`taskkill /IM "${proc}" /F 2>nul`, 5000);
  if (!r1.includes("ERROR") && !r1.toLowerCase().includes("not found")) return `✅ Closed: ${appName}`;

  const procName = proc.replace(/\.exe$/i, "");
  await sh(`powershell -NoProfile -NonInteractive -Command "Stop-Process -Name '${procName}' -Force -ErrorAction SilentlyContinue"`, 5000);

  await sh(`taskkill /FI "WINDOWTITLE eq ${appName}" /F 2>nul`, 5000);
  return `✅ Close signal sent to: ${appName}`;
}

// ══════════════════════════════════════════════════════════════
// VOLUME
// ══════════════════════════════════════════════════════════════
export async function setVolume(level) {
  if (isNaN(level) || level < 0 || level > 100) return "❌ Volume must be 0-100";
  try {
    if (isWin) {
      const vol = Math.round(level / 100 * 65535);
      await execAsync(
        `powershell -NoProfile -NonInteractive -command "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class Vol { [DllImport(\\"winmm.dll\\")] public static extern int waveOutSetVolume(IntPtr h, uint v); }'; [Vol]::waveOutSetVolume([IntPtr]::Zero, ${vol * 0x10001})"`,
        { timeout: 8000 }
      );
    } else {
      await execAsync(`osascript -e "set volume output volume ${level}"`);
    }
    return `✅ Volume set to ${level}%`;
  } catch (e) {
    return `❌ Volume error: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// SCREENSHOT — returns JSON {message, filepath} for WhatsApp chain
// ══════════════════════════════════════════════════════════════
export async function takeScreenshot() {
  await ensureScreenshotsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `screenshot-${timestamp}.png`;
  const outputPath = path.join(SCREENSHOTS_DIR, filename);
  const winPath = outputPath.replace(/\//g, "\\");

  try {
    if (isWin) {
      await execAsync(
        `powershell -NoProfile -NonInteractive -command "` +
        `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
        `$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; ` +
        `$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height); ` +
        `$g = [System.Drawing.Graphics]::FromImage($bmp); ` +
        `$g.CopyFromScreen(0,0,0,0,$s.Size); ` +
        `$bmp.Save('${winPath}'); ` +
        `$g.Dispose(); $bmp.Dispose()"`,
        { timeout: 15000 }
      );
    } else {
      await execAsync(`screencapture "${outputPath}"`);
    }
    return JSON.stringify({ message: `✅ Screenshot saved`, filepath: outputPath });
  } catch (e) {
    return `❌ Screenshot failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// SYSTEM INFO — single fast PowerShell call
// ══════════════════════════════════════════════════════════════
export async function getSystemInfo() {
  try {
    if (isWin) {
      // Use simple separate commands instead of one giant pipe
      const [cpuOut, ramOut, diskOut, gpuOut, osOut, uptimeOut] = await Promise.all([
        sh(`powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Processor).LoadPercentage"`),
        sh(`powershell -NoProfile -NonInteractive -Command "$os=Get-CimInstance Win32_OperatingSystem; Write-Host ([math]::Round($os.TotalVisibleMemorySize/1MB,1)) ([math]::Round(($os.TotalVisibleMemorySize-$os.FreePhysicalMemory)/1MB,1)) ([math]::Round($os.FreePhysicalMemory/1MB,1))"`),
        sh(`powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { $_.DeviceID+' '+[math]::Round($_.Size/1GB,1)+'GB total '+[math]::Round($_.FreeSpace/1GB,1)+'GB free' }"`),
        sh(`powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_VideoController | Select-Object -First 1).Name"`),
        sh(`powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_OperatingSystem).Caption"`),
        sh(`powershell -NoProfile -NonInteractive -Command "$os=Get-CimInstance Win32_OperatingSystem; [math]::Round(($os.LocalDateTime-$os.LastBootUpTime).TotalHours,1)"`),
      ]);

      const [ramTotal, ramUsed, ramFree] = ramOut.trim().split(" ");

      return [
        `💻 System Info`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🔲 CPU    : ${cpuOut.trim()}%`,
        `🧠 RAM    : ${ramUsed}GB used / ${ramTotal}GB total (${ramFree}GB free)`,
        `💾 Disk   : ${diskOut.trim()}`,
        `🎮 GPU    : ${gpuOut.trim()}`,
        `🖥️  OS     : ${osOut.trim()}`,
        `⏱️  Uptime : ${uptimeOut.trim()}h`,
      ].join("\n");
    } else {
      const [cpu, ram, disk] = await Promise.all([
        sh(`top -bn1 | grep "Cpu(s)" | awk '{print $2}'`),
        sh(`free -h | awk '/^Mem:/ {print $2" total "$3" used "$4" free"}'`),
        sh(`df -h / | awk 'NR==2 {print $2" total "$3" used "$4" free"}'`),
      ]);
      return `💻 System Info\n━━━━━━━━━━━━━━━━━━━━\n🔲 CPU: ${cpu}%\n🧠 RAM: ${ram}\n💾 Disk: ${disk}`;
    }
  } catch (e) {
    return `❌ system_info failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// TOP PROCESSES
// ══════════════════════════════════════════════════════════════
export async function getTopProcesses(limit = 5) {
  try {
    if (isWin) {
      const out = await sh(
        `powershell -NoProfile -NonInteractive -command "Get-Process | Sort-Object CPU -Descending | Select-Object -First ${limit} Name,@{N='CPU';E={[math]::Round($_.CPU,1)}},@{N='RAM_MB';E={[math]::Round($_.WorkingSet64/1MB,1)}} | Format-Table -AutoSize | Out-String"`,
        10000
      );
      return `🔧 Top ${limit} Processes\n━━━━━━━━━━━━━━━━━━━━\n${out.trim()}`;
    } else {
      const out = await sh(`ps aux --sort=-%cpu | head -${limit + 1} | awk 'NR>1 {print $11, $3"%", $4"%"}'`);
      return `🔧 Top ${limit} Processes\n━━━━━━━━━━━━━━━━━━━━\n${out.trim()}`;
    }
  } catch (e) {
    return `❌ top_processes failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// CLIPBOARD
// ══════════════════════════════════════════════════════════════
export async function readClipboard() {
  try {
    const out = isWin
      ? await sh(`powershell -NoProfile -NonInteractive -command "Get-Clipboard"`)
      : await sh(`pbpaste`);
    return out.trim() ? `📋 Clipboard:\n${out.trim().slice(0, 500)}` : "📋 Clipboard is empty";
  } catch (e) {
    return `❌ clipboard failed: ${e.message}`;
  }
}

// ══════════════════════════════════════════════════════════════
// LOCK / SHUTDOWN / RESTART
// ══════════════════════════════════════════════════════════════
export async function lockScreen() {
  try {
    await execAsync(isWin ? "rundll32.exe user32.dll,LockWorkStation" : "pmset displaysleepnow");
    return "✅ Screen locked";
  } catch (e) { return `❌ lock_screen failed: ${e.message}`; }
}

export async function shutdownPC(minutes = 0) {
  try {
    await execAsync(isWin ? `shutdown /s /t ${minutes * 60}` : `sudo shutdown -h +${minutes}`);
    return `✅ Shutdown scheduled in ${minutes} minute(s)`;
  } catch (e) { return `❌ shutdown failed: ${e.message}`; }
}

export async function restartPC() {
  try {
    await execAsync(isWin ? "shutdown /r /t 0" : "sudo reboot");
    return "✅ Restarting...";
  } catch (e) { return `❌ restart failed: ${e.message}`; }
}

export default {
  openApp,
  openTerminalInFolder,
  runInVisibleTerminal,
  closeApp,
  setVolume,
  takeScreenshot,
  getSystemInfo,
  getTopProcesses,
  readClipboard,
  lockScreen,
  shutdownPC,
  restartPC,
};