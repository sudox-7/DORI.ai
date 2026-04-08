import "dotenv/config";
import { createAgent }    from "langchain";
import { ChatOpenRouter } from "@langchain/openrouter";
import { mainTools }      from "./tools.js";
import { buildSystemPrompt } from "../utils/systemPr.js";
import {
  saveChatMessage,
  getContextMessages,
  trackSession,
} from "../utils/chatStorage.js";
import { setAgentRunning } from "./hooks/trigger.js";
import { createLogger }    from "../utils/logger.js";

const log = createLogger("agent");

// ════════════════════════════════════════════════════════════════════════════
// LLM INSTANCE
// ════════════════════════════════════════════════════════════════════════════
const llm = new ChatOpenRouter({
  apiKey:      process.env.OPENROUTER_API_KEY,
  model:       process.env.MAIN_MODEL || "arcee-ai/trinity-mini:free",
  temperature: 0.2,
});

// ════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT CACHE
// ════════════════════════════════════════════════════════════════════════════
let cachedSystemPrompt = null;
let promptBuiltAt      = null;
const PROMPT_CACHE_MS  = 10 * 60 * 1000; // 10 minutes

async function getSystemPrompt(forceRebuild = false) {
  const now     = Date.now();
  const expired = !promptBuiltAt || now - promptBuiltAt > PROMPT_CACHE_MS;
  if (!cachedSystemPrompt || expired || forceRebuild) {
    log.info("[agent] Building system prompt...");
    cachedSystemPrompt = await buildSystemPrompt();
    promptBuiltAt      = now;
    log.info(`[agent] System prompt built (${cachedSystemPrompt.length} chars)`);
  }
  return cachedSystemPrompt;
}

export async function refreshSystemPrompt() {
  return getSystemPrompt(true);
}

// ════════════════════════════════════════════════════════════════════════════
// AGENT INSTANCE (singleton, rebuilt when prompt refreshes)
// ════════════════════════════════════════════════════════════════════════════
let agentInstance = null;

async function getAgent() {
  const systemPrompt = await getSystemPrompt();
  if (!agentInstance) {
    agentInstance = createAgent({ model: llm, systemPrompt, tools: mainTools });
  }
  return agentInstance;
}

// Invalidate cached instance when prompt is force-rebuilt
const _originalRefresh = refreshSystemPrompt;
export async function refreshSystemPromptAndAgent() {
  cachedSystemPrompt = null;
  agentInstance      = null;
  return getSystemPrompt(true);
}

// ════════════════════════════════════════════════════════════════════════════
// SETUP — save message + get context
// ════════════════════════════════════════════════════════════════════════════
async function setup(prompt) {
  await saveChatMessage("user", prompt).catch(() => {});
  await trackSession(prompt).catch(() => {});
  return getContextMessages(10);
}

// ════════════════════════════════════════════════════════════════════════════
// 1. STREAMING AGENT RUN
// ════════════════════════════════════════════════════════════════════════════
export async function runAgentStream(prompt, onToken) {
  setAgentRunning(true);
  log.info("[agent] Started (stream)");

  try {
    const messages = await setup(prompt);
    const agent    = await getAgent();
    const stream   = agent.streamEvents({ messages }, { version: "v2", recursionLimit: 50 });

    let fullResponse  = "";
    let toolCallCount = 0;

    for await (const event of stream) {
      if (event.event === "on_tool_start") {
        toolCallCount++;
        log.info(`[${toolCallCount}] Tool: ${event.name}`);
      }

      if (event.event === "on_tool_end") {
        log.info(`Done: ${event.name} → ${String(event.data?.output || "").slice(0, 100)}`);
      }

      if (event.event === "on_tool_error") {
        log.error(`Error: ${event.name} → ${event.data?.error}`);
      }

      if (event.event === "on_chat_model_stream" && event.data?.chunk?.content) {
        const token = event.data.chunk.content;
        if (token) { fullResponse += token; onToken(token); }
      }

      if (toolCallCount > 40) {
        log.warn(`Tool call limit reached (${toolCallCount}), stopping.`);
        break;
      }
    }

    if (fullResponse) await saveChatMessage("assistant", fullResponse).catch(() => {});

  } catch (err) {
    log.error(`runAgentStream error: ${err.message}`);
    throw err;
  } finally {
    setAgentRunning(false);
    log.info("[agent] Released (stream)");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2. STANDARD AGENT RUN
// ════════════════════════════════════════════════════════════════════════════
export async function runAgent(prompt) {
  setAgentRunning(true);
  log.info("[agent] Started (standard)");

  try {
    const messages = await setup(prompt);
    const agent    = await getAgent();
    const result   = await agent.invoke({ messages }, { recursionLimit: 50 });
    const response = result.messages.at(-1).content;
    await saveChatMessage("assistant", response).catch(() => {});
    return result;
  } catch (err) {
    log.error(`runAgent error: ${err.message}`);
    throw err;
  } finally {
    setAgentRunning(false);
    log.info("[agent] Released (standard)");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 3. TRIGGER AGENT RUN (called by scheduler)
// ════════════════════════════════════════════════════════════════════════════
export async function runAgentTrigger(prompt) {
  log.debug("[agent] Trigger running...");
  try {
    const agent  = await getAgent();
    const result = await agent.invoke(
      { messages: [{ role: "user", content: prompt }] },
      { recursionLimit: 25 }
    );
    return result?.messages?.at(-1)?.content || "NO_ACTION";
  } catch (err) {
    log.error(`runAgentTrigger error: ${err.message}`);
    return "NO_ACTION";
  }
}