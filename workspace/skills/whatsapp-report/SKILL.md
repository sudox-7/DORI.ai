---
name: whatsapp-report
description: Compile weather, news, and emails into a daily report and send to WhatsApp.
---

## When to Use
- User says daily report, morning briefing, or send summary to WhatsApp
- Triggered from scheduled tasks as a periodic report

## Steps
1. Call get_weather with city=Marrakech
2. Call get_news with limit=5
3. Call gmail_read with limit=3
4. Format everything into one clean WhatsApp message
5. Call whatsapp_send with toSelf=true

## Rules
- No markdown in WhatsApp — use CAPS and plain text for emphasis
- If one source fails, skip it and continue with the rest
- Always send to self, never to others 