---
name: daily-standup
description: Every morning summarize top 3 tasks from memory, check weather in Marrakech, and send both to WhatsApp.
---

## When to Use
Triggered automatically every morning as a daily briefing.

## Steps
1. Search memory for tasks/goals using `memory_search` with query "task", "goal", "work" to find top priorities
2. Extract the top 3 actionable items from the results
3. Call `get_weather` with city="Marrakech"
4. Format everything into a clean WhatsApp message:
   - Start with "DAILY STANDUP" in caps
   - List top 3 tasks as bullet points (using • or -)
   - Add weather: temperature, conditions, and any notable forecast
   - Keep it concise, no markdown
5. Send via `whatsapp_send` with `toSelf=true`

## Output Format
Plain text WhatsApp message, all caps for headings, simple bullets.

## Rules
- If memory search returns fewer than 3 tasks, use whatever is available
- If weather fails, skip it and send tasks only
- Always send to self, never to others
- Close any browser windows opened during the process