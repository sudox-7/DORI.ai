import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;

import qrcode from "qrcode-terminal";
import fs from "fs/promises";
import path from "path";

let client = null;
let isReady = false;
let isInitializing = false;
let isReconnecting = false;
let reconnectTimer = null;

let lastAgentReply = "";
let isProcessing = false;
let lastProcessedTime = 0;

const COOLDOWN_MS = 5000;
const RECONNECT_DELAY_MS = 8000;
const MAX_SAFE_SEND_WAIT_MS = 30000;
const AGENT_TAG = "[Dori Agent]";

// ============================================================
// PATHS
// ============================================================
const DATA_DIR = path.resolve("./data");
const ALLOWED_FILE = path.join(DATA_DIR, "allowed_numbers.json");
const SESSION_DIR = path.join(DATA_DIR, "whatsapp-session");

// ============================================================
// PROCESS GUARDS — never let node die from unhandled errors
// ============================================================
process.on("unhandledRejection", async (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
  await forceReconnect("unhandledRejection");
});

process.on("uncaughtException", async (err) => {
  console.error("❌ Uncaught Exception:", err);
  await forceReconnect("uncaughtException");
});

// ============================================================
// SMALL HELPERS
// ============================================================
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(ALLOWED_FILE);
  } catch {
    await fs.writeFile(ALLOWED_FILE, "[]", "utf-8");
  }

  await fs.mkdir(SESSION_DIR, { recursive: true });
}

function normalizePhone(phone = "") {
  return String(phone).replace(/[^0-9]/g, "");
}

function extractPhoneFromWid(wid = "") {
  return String(wid).replace(/[^0-9@]/g, "").split("@")[0];
}

function getOwnerPhone() {
  return normalizePhone(process.env.WHATSAPP_USER_PHONE || "");
}

function isOwner(phoneOrWid) {
  const ownerPhone = getOwnerPhone();
  const msgPhone = extractPhoneFromWid(phoneOrWid);
  return !!ownerPhone && ownerPhone === msgPhone;
}

function isGroupMessage(msg) {
  return msg?.from?.includes("@g.us");
}

function isStatusMessage(msg) {
  return msg?.from === "status@broadcast";
}

function looksLikeAgentOutput(text) {
  if (!text) return false;

  return (
    text.startsWith(AGENT_TAG))
}

function shouldCooldown() {
  return Date.now() - lastProcessedTime < COOLDOWN_MS;
}

function markProcessing() {
  isProcessing = true;
  lastProcessedTime = Date.now();
}

function clearProcessing() {
  isProcessing = false;
}

// ============================================================
// ALLOWED STRANGERS
// ============================================================
async function getAllowedNumbers() {
  try {
    const raw = await fs.readFile(ALLOWED_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function allowNumber(phone) {
  const list = await getAllowedNumbers();
  const clean = normalizePhone(phone);

  if (!clean) throw new Error("Invalid phone number");

  if (!list.includes(clean)) {
    list.push(clean);
    await fs.writeFile(ALLOWED_FILE, JSON.stringify(list, null, 2), "utf-8");
  }

  return clean;
}

async function removeNumber(phone) {
  const list = await getAllowedNumbers();
  const clean = normalizePhone(phone);

  const updated = list.filter((n) => n !== clean);
  await fs.writeFile(ALLOWED_FILE, JSON.stringify(updated, null, 2), "utf-8");

  return clean;
}

// ============================================================
// CLIENT STATE
// ============================================================
function resetClientState() {
  isReady = false;
  isInitializing = false;
}

async function destroyClientSafe() {
  if (!client) return;

  try {
    await client.destroy();
  } catch (err) {
    console.warn("⚠️ client.destroy() warning:", err?.message || err);
  } finally {
    client = null;
    resetClientState();
  }
}

function scheduleReconnect(reason = "unknown") {
  if (reconnectTimer) return;

  console.log(`🔄 Scheduling reconnect in ${RECONNECT_DELAY_MS}ms — reason: ${reason}`);

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    await forceReconnect(reason);
  }, RECONNECT_DELAY_MS);
}

async function forceReconnect(reason = "unknown") {
  if (isReconnecting) {
    console.log("⏳ Reconnect already in progress...");
    return;
  }

  isReconnecting = true;
  console.log(`🔧 Force reconnect started — reason: ${reason}`);

  try {
    await destroyClientSafe();
    await sleep(1500);
    await initWhatsApp({ force: true });
  } catch (err) {
    console.error("❌ forceReconnect failed:", err?.message || err);
    scheduleReconnect("forceReconnect-failed");
  } finally {
    isReconnecting = false;
  }
}

// ============================================================
// SAFE SEND
// ============================================================
async function waitUntilReady(timeoutMs = MAX_SAFE_SEND_WAIT_MS) {
  const started = Date.now();

  while (!isReady || !client) {
    if (Date.now() - started >= timeoutMs) return false;
    await sleep(500);
  }

  return true;
}

async function safeSend(chatId, content, options = {}) {
  const ready = await waitUntilReady();
  if (!ready || !client) {
    throw new Error("WhatsApp not ready");
  }

  try {
    return await client.sendMessage(chatId, content, options);
  } catch (err) {
    const text = String(err?.message || err);

    console.error("❌ safeSend error:", text);

    const recoverable =
      text.includes("detached Frame") ||
      text.includes("Execution context was destroyed") ||
      text.includes("Cannot find context with specified id") ||
      text.includes("Protocol error") ||
      text.includes("Target closed") ||
      text.includes("Session closed");

    if (recoverable) {
      console.warn("⚠️ Recoverable WhatsApp/Puppeteer send error detected");
      await forceReconnect("safeSend-recoverable-error");

      const readyAfterReconnect = await waitUntilReady();
      if (!readyAfterReconnect || !client) {
        throw new Error("Reconnect failed after send error");
      }

      return await client.sendMessage(chatId, content, options);
    }

    throw err;
  }
}

// ============================================================
// MEDIA HELPERS
// ============================================================
async function fileToMessageMedia(filePath) {
  const absPath = path.resolve(filePath);
  await fs.access(absPath);

  const data = await fs.readFile(absPath);
  const base64 = data.toString("base64");

  const ext = path.extname(absPath).toLowerCase().replace(".", "");
  const mimeMap = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };

  const mimetype = mimeMap[ext] || "application/octet-stream";
  return new MessageMedia(mimetype, base64, path.basename(absPath));
}

async function resolveChatIdFromPhone(phone) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) throw new Error("Invalid phone number");

  const ids = [`${cleanPhone}@c.us`, `${cleanPhone}@s.whatsapp.net`];

  let lastError = null;

  for (const id of ids) {
    try {
      // sendMessage is the true test here
      return id;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
  throw new Error("Could not resolve WhatsApp chat id");
}

// ============================================================
// AGENT
// ============================================================
async function generateAgentReply(prompt) {
  const { runAgentStream } = await import("../agent.js");

  let reply = "";
  await runAgentStream(prompt, (token) => {
    reply += token;
  });

  return reply.trim();
}

// ============================================================
// SELF CHAT DETECTION
// ============================================================
function isSelfChatMessage(msg) {
  if (!msg?.fromMe) return false;

  const ownerPhone = getOwnerPhone();
  if (!ownerPhone) return false;

  const fromId = extractPhoneFromWid(msg.from);
  const toId = extractPhoneFromWid(msg.to);

  return fromId === ownerPhone || toId === ownerPhone;
}

// ============================================================
// MAIN INIT
// ============================================================
export async function initWhatsApp(options = {}) {
  const force = options.force === true;

  if ((isInitializing || isReady) && !force) return;
  if (isInitializing && force) return;

  await ensureDataFiles();

  isInitializing = true;
  isReady = false;

  console.log("📱 Starting WhatsApp...");

  try {
    if (client && force) {
      await destroyClientSafe();
    }

    client = new Client({
      authStrategy: new LocalAuth({
        dataPath: SESSION_DIR,
      }),
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      puppeteer: {
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--no-first-run",
          "--no-zygote",
          "--disable-gpu",
        ],
      },

      // safer than pinning a stale remote html version
      webVersionCache: {
        type: "local",
      },
    });

    client.on("qr", (qr) => {
      console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📱 SCAN THIS QR CODE WITH WHATSAPP:");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
      qrcode.generate(qr, { small: true });
      console.log("\nOpen WhatsApp → Linked Devices → Link a Device");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
    });

    client.on("loading_screen", (percent, msg) => {
      console.log(`⏳ WhatsApp loading: ${percent}% — ${msg}`);
    });

    client.on("authenticated", () => {
      console.log("🔐 WhatsApp authenticated!");
    });

    client.on("auth_failure", async (msg) => {
      console.error("❌ WhatsApp auth failed:", msg);
      resetClientState();
      scheduleReconnect("auth_failure");
    });

    client.on("ready", () => {
      isReady = true;
      isInitializing = false;
      console.log("✅ WhatsApp ready — listening for messages...");
    });

    client.on("change_state", (state) => {
      console.log("📡 WhatsApp state:", state);
    });

    client.on("disconnected", async (reason) => {
      console.log("❌ WhatsApp disconnected:", reason);
      resetClientState();
      await destroyClientSafe();
      scheduleReconnect(`disconnected:${reason}`);
    });

    // ============================================================
    // INCOMING — from other people
    // ============================================================
    client.on("message", async (msg) => {
      try {
        if (isGroupMessage(msg)) return;
        if (isStatusMessage(msg)) return;
        if (!msg.body?.trim()) return;
        if (msg.fromMe) return;

        const senderPhone = extractPhoneFromWid(msg.from);
        const owner = isOwner(msg.from);

        if (!owner) {
          const allowedList = await getAllowedNumbers();
          const isAllowed = allowedList.includes(senderPhone);

          if (!isAllowed) {
            console.log(`🚫 Ignored message from unknown number: ${senderPhone}`);
            return;
          }

          if (isProcessing) return;
          if (shouldCooldown()) return;

          markProcessing();
          console.log(`📨 Message from allowed stranger (${senderPhone}): "${msg.body}"`);

          const prompt = `[GUEST MESSAGE from ${senderPhone}]
This person was allowed by the owner to chat with you.
Rules:
- Be friendly and helpful
- NEVER share owner personal data: name, email, location, notes, memory, tasks
- Do NOT use: get_user, gmail_read, gmail_send, schedule_task, computer_control, browser_control
- You CAN help with: weather, news, general questions, math, advice

Their message: "${msg.body}"`;

          const reply = await generateAgentReply(prompt);

          if (reply) {
            lastAgentReply = reply;
            await safeSend(msg.from, `${AGENT_TAG}\n${reply}`);
            console.log(`✅ Replied to guest ${senderPhone}`);
          }

          return;
        }

        if (isProcessing) return;
        if (shouldCooldown()) return;

        markProcessing();
        console.log(`📨 Message from owner: "${msg.body}"`);

        const reply = await generateAgentReply(msg.body);

        if (reply) {
          lastAgentReply = reply;
          await safeSend(msg.from, `${AGENT_TAG}\n${reply}`);
          console.log(`✅ Agent replied to owner: "${reply.slice(0, 80)}"`);
        }
      } catch (err) {
        console.error("[whatsapp] message error:", err?.message || err);
        scheduleReconnect("message-handler-error");
      } finally {
        clearProcessing();
      }
    });

    // ============================================================
    // SELF-CHAT
    // ============================================================
    client.on("message_create", async (msg) => {
      try {
        if (!isSelfChatMessage(msg)) return;
        if (!msg.body?.trim()) return;

        const body = msg.body.trim();

        if (body.startsWith(AGENT_TAG)) return;
        if (body === lastAgentReply.trim()) return;

        if (looksLikeAgentOutput(body)) {
          console.log("⏭️ Skipped — looks like agent output");
          return;
        }

        if (isProcessing) return;
        if (shouldCooldown()) return;

        const allowMatch = body.match(/^(answer|allow|reply to)\s+(\d+)/i);
        const blockMatch = body.match(/^(block|ignore|remove)\s+(\d+)/i);

        if (allowMatch) {
          const phone = allowMatch[2];
          await allowNumber(phone);

          lastAgentReply = `✅ Got it — I'll now respond to ${phone}`;
          await safeSend(msg.from, `${AGENT_TAG}\n${lastAgentReply}`);

          console.log(`✅ Allowed number: ${phone}`);
          return;
        }

        if (blockMatch) {
          const phone = blockMatch[2];
          await removeNumber(phone);

          lastAgentReply = `✅ Blocked — I'll ignore messages from ${phone}`;
          await safeSend(msg.from, `${AGENT_TAG}\n${lastAgentReply}`);

          console.log(`🚫 Blocked number: ${phone}`);
          return;
        }

        markProcessing();
        console.log(`📨 Self-message: "${body}"`);

        const reply = await generateAgentReply(body);

        if (reply) {
          lastAgentReply = reply;
          await safeSend(msg.from, `${AGENT_TAG}\n${reply}`);
          console.log("✅ Agent replied to self-message");
        }
      } catch (err) {
        console.error("[whatsapp] self-message error:", err?.message || err);
        scheduleReconnect("self-message-handler-error");
      } finally {
        clearProcessing();
      }
    });

    await client.initialize();
  } catch (err) {
    console.error("❌ WhatsApp init error:", err?.message || err);
    resetClientState();
    scheduleReconnect("init-error");
  }
}

// ============================================================
// SEND TEXT
// ============================================================
export async function sendWhatsAppMessage(phone, message) {
  try {
    const chatId = await resolveChatIdFromPhone(phone);
    await safeSend(chatId, message);
    console.log(`✅ Sent to ${chatId}`);
    return "✅ WhatsApp message sent";
  } catch (err) {
    console.error("[whatsapp] send error:", err?.message || err);
    scheduleReconnect("sendWhatsAppMessage-error");
    return `❌ Failed: ${err?.message || err}`;
  }
}

export async function sendToSelf(message) {
  try {
    const phone = process.env.WHATSAPP_USER_PHONE;
    if (!phone) return "❌ WHATSAPP_USER_PHONE missing in .env";

    const chatId = await resolveChatIdFromPhone(phone);
    await safeSend(chatId, message);

    console.log(`✅ Sent to self via ${chatId}`);
    return "✅ WhatsApp message sent to self";
  } catch (err) {
    console.error("[whatsapp] sendToSelf error:", err?.message || err);
    scheduleReconnect("sendToSelf-error");
    return `❌ sendToSelf failed: ${err?.message || err}`;
  }
}

// ============================================================
// SEND IMAGE TO SELF
// ============================================================
export async function sendImageToSelf(imagePath, caption = "") {
  try {
    const phone = process.env.WHATSAPP_USER_PHONE;
    if (!phone) return "❌ WHATSAPP_USER_PHONE missing in .env";

    const media = await fileToMessageMedia(imagePath);
    const chatId = await resolveChatIdFromPhone(phone);

    await safeSend(chatId, media, { caption });
    console.log(`✅ Image sent to self via ${chatId}`);

    return "✅ Screenshot sent to your WhatsApp";
  } catch (err) {
    console.error("[whatsapp] sendImageToSelf error:", err?.message || err);
    scheduleReconnect("sendImageToSelf-error");
    return `❌ sendImageToSelf failed: ${err?.message || err}`;
  }
}

// ============================================================
// SEND IMAGE TO ANY NUMBER
// ============================================================
export async function sendImageToPhone(phone, imagePath, caption = "") {
  try {
    const media = await fileToMessageMedia(imagePath);
    const chatId = await resolveChatIdFromPhone(phone);

    await safeSend(chatId, media, { caption });
    console.log(`✅ Image sent to ${chatId}`);

    return `✅ Image sent to ${normalizePhone(phone)}`;
  } catch (err) {
    console.error("[whatsapp] sendImageToPhone error:", err?.message || err);
    scheduleReconnect("sendImageToPhone-error");
    return `❌ sendImageToPhone failed: ${err?.message || err}`;
  }
}

// ============================================================
// STATUS
// ============================================================
export function getWhatsAppStatus() {
  if (isReady) return "✅ Connected";
  if (isInitializing || isReconnecting) return "⏳ Connecting";
  return "❌ Disconnected";
}


export default {
  initWhatsApp,
  sendWhatsAppMessage,
  sendToSelf,
  sendImageToSelf,
  sendImageToPhone,
  getWhatsAppStatus,
};