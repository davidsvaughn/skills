---
name: draft
description: Save Claude's previous chat response (or the answer to a new question) as a plain markdown file under .notes/drafts/ so the user can annotate it in the editor with CriticMarkup and send it back.
argument-hint: "[question to answer in a file instead of chat]"
disable-model-invocation: true
---

# /draft — a response as an annotatable file

Timestamp for the filename: !`date +%Y%m%d-%H%M%S`
Date for the header: !`date '+%Y-%m-%d %H:%M'`
Session id: ${CLAUDE_SESSION_ID}

Arguments: $ARGUMENTS

## What to do

**If the arguments line above is empty:** write your *previous* chat response — the last full
assistant message before this command — to a file, **verbatim**. Do not summarize, tidy, reorder,
shorten, renumber, or add line numbers or section numbers. Keep every heading, table, list, code
block and link exactly as written, including any closing question or offer.

**If arguments were given:** treat them as a question or request and write your full answer to the
file instead of to chat, in the form you would have used in chat. Same rules: plain markdown, no
line numbers.

## File

- Directory: `.notes/drafts/` in the current working directory. Create it if missing. Keep it out
  of git: if `git check-ignore -q .notes/x` fails, tell the user once that `.notes/` belongs in
  their global gitignore (`~/.gitignore` or `core.excludesFile`), and do not add the file to git.
- Name: `<timestamp>-<slug>.md`, where `<slug>` is 2–5 lowercase hyphenated words naming the topic.
  The `yyyymmdd-hhmmss` prefix keeps alphabetical order chronological.
- Content: the front-matter header below, then the body, nothing else — no added title, no wrapper,
  no line numbers. The body is the verbatim previous response (bare `/draft`) or the full answer
  (`/draft <question>`).

Header (fill from the values at the top of this file):

```
---
date: <date for the header>
session: <session id>
kind: captured-response | file-answer
prompt: <the user message this body answers, trimmed to one line — for bare /draft, the message that preceded your previous response; for /draft <question>, the question>
---
```

## After writing

Reply in chat with one line and nothing else:

`Draft saved: .notes/drafts/<file>.md`

The user will annotate the file with CriticMarkup — `{==text==}{>>you|date: comment<<}`,
`{>>you|date: comment<<}`, `{++insert++}`, `{--delete--}`, `{~~old~>new~~}` — and come back with
"address the annotations in <path>". Handle that as `${CLAUDE_SKILL_DIR}/references/criticmarkup.md`
says (read it then if it is not already in context): inventory every annotation before acting, work
out the scope of each, act on its intent, respond in chat rather than in the file, and never edit,
move or remove the user's annotations.
