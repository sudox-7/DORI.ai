---
name: daily-hello-peter
description: Every day at 1pm send "hello peter" to WhatsApp
---

## When to Use
Automatically triggered at 1:00 PM every day.

## Steps
1. Use commsAgent to send WhatsApp message to user's WhatsApp number (212718087970)
2. Message content: "hello peter"

## Output Format
- Success: Confirm message sent to WhatsApp
- Failure: Report error and retry once

## Rules
- Use absolute paths and user's WhatsApp number from memory
- Send to self (user's WhatsApp)
- No additional text or formatting