---
name: evening-report
description: Every day at 6pm, fetch latest tech news, summarize with AI, and send to WhatsApp.
---

1. Call get_news with category="technology" and limit=5 to get latest tech headlines and articles
2. Build a prompt for ask_ai_web: "You are a professional tech news summarizer. Read the following tech news articles and provide a concise English summary for each. Highlight: Date, Source, Main entities, Key facts, Significance. Format in bullet points. News: [paste the news articles here]"
3. Call ask_ai_web with provider="chatgpt" and the prompt
4. Send the AI's response via whatsapp_send with toSelf=true
5. If any step fails, report the error and stop