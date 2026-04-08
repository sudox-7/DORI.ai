---
name: quick-open
description: Open a project in VS Code by searching memory for stored project paths
---

# Quick Open Skill

## When to Use
When the user wants to quickly open a project in VS Code. The skill searches memory for stored project locations and opens the requested project.

## Steps
1. Search memory for "project" to get list of stored projects and their paths
2. If user specifies a project name, find matching entry
3. If no specific project mentioned, show available projects and ask which to open
4. Use `computer_control` with action="open_app" and value="code <project_path>" to open VS Code at that location
5. Confirm success to user

## Output Format
- Show which project is being opened
- Confirm VS Code launched successfully

## Rules
- Always use full absolute paths from memory
- If project not found in memory, inform user and suggest saving it first
- Use `computer_control` tool to open VS Code