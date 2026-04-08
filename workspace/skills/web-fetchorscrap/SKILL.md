---
name: web-fetchorscrap
description: Decide whether to use web_fetch or web_scrape based on user intent
---

## When to Use
When you need to read or extract data from a webpage and must choose between `web_fetch` and `web_scrape`.

## Steps
1. Analyze the user's request:
   - If they want to **read, understand, summarize, or analyze content** → use `web_fetch`
   - If they want to **extract specific elements, links, data points, or need full page structure** → use `web_scrape`
2. Apply the decision rule: "READ/UNDERSTAND → web_fetch; EXTRACT/STRUCTURE → web_scrape"
3. Call the chosen tool with appropriate parameters
4. Return the result to the user

## Output Format
- State which tool was used
- Provide the extracted/read content
- Briefly explain why that tool was chosen (optional)

## Rules
- `web_fetch` = clean text, fast, focused
- `web_scrape` = full HTML/structure, comprehensive, noisier
- Never use both for the same URL unless user explicitly asks for both perspectives
- If user request is ambiguous, default to `web_fetch` (safer for understanding)