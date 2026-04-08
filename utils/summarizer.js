import { ChatOpenRouter } from "@langchain/openrouter";
import "dotenv/config";

let llmInstance = null;

function getLLM() {
  if (!llmInstance) {
    const apiKey = process.env.OPENROUTER_API_KEY_summarizer ;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY_summarizer is missing.");
    llmInstance = new ChatOpenRouter({
      apiKey,
      model: "stepfun/step-3.5-flash:free",
      temperature: 0.1,
    });
  }
  return llmInstance;
}

function normalizeContent(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(p => p?.text || p?.content || p || "").join("").trim();
  if (content?.text) return content.text.trim();
  return typeof content === "object" ? JSON.stringify(content) : "";
}

export async function summarizeWithAI(transcript) {
  if (!transcript || typeof transcript !== "string") return "• Summary unavailable.";

  try {
    const result = await getLLM().invoke([
      {
        role: "system",
        content: `You are a conversation summarizer.
Summarize in 5-8 bullet points. Focus ONLY on:
- Facts about the user (name, job, age, location, preferences)
- Important decisions or requests
- Key topics discussed
- Anything worth remembering for future conversations
Rules: bullet points only, concise, no filler.`,
      },
      {
        role: "user",
        content: `Summarize this conversation:\n\n${transcript}`,
      },
    ]);

    const summary = normalizeContent(result?.content);
    return summary || "• No meaningful summary generated.";
  } catch (err) {
    console.error("[summarizer] failed:", err.message);
    return "• Summary could not be generated.";
  }
}