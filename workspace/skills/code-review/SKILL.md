---
name: code-review
description: Read a code file and provide structured review with issues and improvements.
---

## When to Use
- User says review, check, what is wrong with, or improve a file
- User shares a file path and asks for feedback

## Steps
1. Read the file using filesystem action=read
2. Analyze for bugs, performance, security, missing error handling
3. Send to ask_ai_web with provider=chatgpt for expert review
4. Format and present the review cleanly

## Output Format
Code Review: filename
Critical Issues: ...
Improvements: ...
Verdict: ...