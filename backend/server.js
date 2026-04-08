// ✅ backend/server.js — clean single start
import "dotenv/config";
import { app } from "./main.js";
import { startTrigger } from "../Agents/hooks/trigger.js";
import { initWhatsApp } from "../Agents/skills/whatsapp.js";
import { buildSystemPrompt } from "../utils/systemPr.js";
import { createLogger } from "../utils/logger.js";
const log = createLogger("server");

const port = process.env.PORT || 3000;
let started = false;

app.listen(port, async () => {
  if (started) return;
  started = true;

  log.info("🚀 Server running on http://localhost:" + port);

  initWhatsApp().catch((err) => log.error("WhatsApp failed:", err.message));

  startTrigger();
});

buildSystemPrompt()
  .then(() => log.info("✅ System prompt ready"))
  .catch((err) => log.error("❌ System prompt failed:", err.message));
