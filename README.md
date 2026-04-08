 # Dori - Autonomous Execution Assistant (2026)

## 🚀 Core Idea

Dori is a **real execution assistant**, not a chatbot. Built with [LangChain](https://langchain.com/) and [LangGraph](https://langchain-ai.github.io/langgraph/), it autonomously executes tasks using modular **skills** (tools) for WhatsApp, terminal, browser automation, email, web scraping, and more.

Inspired by JARVIS/Auto-GPT but reliable: sharp, warm, calm, multilingual (English/Arabic/Darija). Follows strict rules in [`workspace/SOUL.md`](workspace/SOUL.md):
- Direct, natural responses.
- Verifies all file actions.
- Persistent memory.
- No fluff like "Certainly!".

**Goal**: Handle real-world tasks seamlessly—"Send WhatsApp to Mom", "Open GitHub PR", "Debug this script".

## 🏗️ Project Structure

```
learnagent/
├── .env                    # API keys (OPENROUTER_API_KEY, etc.)
├── package.json            # Node.js ESM: langchain, whatsapp-web.js, playwright, ollama, etc.
├── backend/                # Express API
│   ├── server.js           # POST /invoke, /streaminvoke
│   ├── controllers/invoke.js
│   └── middlewares/        # Validation, error handling
├── Agents/                 # Core AI logic
│   ├── agent.js            # LangGraph agent (stream/standard/trigger modes)
│   ├── tools.js            # Tool registry
│   ├── skills/             # Tools: whatsapp.js, terminal.js, robotjs.js, aiweb.js, etc.
│   ├── mcp_client/         # GitHub/Zapier MCP
│   ├── hooks/trigger.js    # Agent state
│   └── agentManager.js
├── utils/                  # Helpers
│   ├── systemPr.js         # Dynamic system prompt builder
│   ├── skillLoader.js      # Auto-load skills
│   ├── logger.js
│   ├── memorySearch.js     # Vector DB search
│   ├── chatStorage.js
│   └── webSearch.js
├── data/                   # Persistent state
│   ├── memory.json         # Vector DB
│   ├── chats/              # chat_YYYY-MM-DD.json
│   ├── summary.json
│   ├── user.json
│   ├── allowed_numbers.json
│   ├── wakeup.json
│   └── whatsapp-session/   # WhatsApp Web session
├── workspace/              # Config & custom skills
│   ├── SOUL.md             # Personality/rules
│   ├── USER.md             # User prefs
│   ├── MEMORY.md           # Long-term memory
│   └── skills/             # User-defined: code-review, news-summary, whatsapp-report, etc.
├── frontend/               # Basic web UI
│   └── src/                # index.html, dori.html, styles
├── logs/                   # dori-YYYY-MM-DD.jsonl
└── test/                   # Tests
```

## 🔄 Core Flow

```
User Prompt → backend/server.js → Agents/agent.js
  ↓
Dynamic System Prompt (utils/systemPr.js + SOUL.md)
  ↓
LangGraph Agent (OpenRouter/Trinity-mini) + Tools (Agents/tools.js)
  ↓
Skills execute (e.g., whatsapp.js → data/whatsapp-session/)
  ↓
Persist: chatStorage.js → data/chats/
  ↓
Stream response
```

- **Streaming**: `runAgentStream()` with tool logging.
- **Triggers**: Cron/scheduler via `Agents/hooks/trigger.js`.
- **Memory**: Vectordb (`data/memory.json`), context from last 10 chats.

## 🚀 Quick Start

1. **Install**:
   ```
   npm install
   ```

2. **Configure** [`./.env`](.env):
   ```
   OPENROUTER_API_KEY=your_key
   MAIN_MODEL=arcee-ai/trinity-mini:free  # Or grok/openai
   ```

3. **Run**:
   ```
   npm run dev  # nodemon backend/server.js
   ```

4. **Test**:
   ```bash
   curl -X POST http://localhost:3000/invoke \\
     -H "Content-Type: application/json" \\
     -d '{"prompt": "Say hello via WhatsApp"}'
   ```

## 🛠️ Key Features

| Category | Skills/Tools | Files |
|----------|--------------|-------|
| **Comm** | WhatsApp, Gmail (imap/nodemailer) | [`Agents/skills/whatsapp.js`](Agents/skills/whatsapp.js), gmail.js |
| **Automate** | Terminal (node-pty), RobotJS, Playwright | [`Agents/skills/terminal.js`](Agents/skills/terminal.js), robotjs.js |
| **Web** | Scraping (cheerio/playwright), News, YouTube, Weather | scraping.js, news.js |
| **AI** | MCP (GitHub/Zapier), LangChain tools | `Agents/mcp_client/`, `Agents/coding/tools/` |
| **Utils** | Web search, QR code, cron | webSearch.js, node-cron |
| **Custom** | Daily standup, code review, news summary | `workspace/skills/` |

## 🔍 Development Notes

- **Prompt Cache**: 10min TTL, refresh via `refreshSystemPromptAndAgent()`.
- **Tool Limits**: 40 calls/stream, recursion 50.
- **Safety**: File backups, no edits to .env/package.json, verify writes.
- **Logs**: `logs/dori-*.jsonl` + console.
- **WhatsApp**: Multi-session support via `data/whatsapp-session/`.

## 📈 Extensibility

1. Add skill: New JS in `Agents/skills/` → auto-loaded.
2. Workspace skill: `workspace/skills/NAME/SKILL.md` → prompt-based.
3. MCP: Register in `Agents/coding/mcp/register.js`.

Senior-dev tip: System prompt is king—tweak [`utils/systemPr.js`](utils/systemPr.js) + [`workspace/SOUL.md`](workspace/SOUL.md) for behavior.

## 🐛 Troubleshooting

- Agent stuck? Check `Agents/lock.js`, `data/missed_tasks.json`.
- WhatsApp QR? Runs on first boot.
- Memory search slow? Optimize `utils/memorySearch.js`.

Fork, extend, execute.