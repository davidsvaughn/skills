---
name: ann
description: Annotate a markdown document in the browser with CriticMarkup comments that land in the .md file. Use when the user wants to annotate, comment on or review a markdown doc or a Claude response in the browser - /ann alone saves the previous response to .notes/drafts/ and opens it, /ann <question> answers in a file and opens it, /ann <path or doc name> opens that file.
argument-hint: "[path/to/doc.md | question]"
---

# /ann - annotate markdown in the browser

Timestamp for a new file: !`date +%Y%m%d-%H%M%S`
Date for the header: !`date '+%Y-%m-%d %H:%M'`
Session id: ${CLAUDE_SESSION_ID}

Arguments: $ARGUMENTS

## Decide the mode

1. **No arguments:** write your *previous* chat response, the last full assistant message before this
   command, to a new file **verbatim**. Do not summarize, tidy, reorder, shorten, renumber, or add line
   numbers or section numbers. Keep every heading, table, list, code block and link exactly as written,
   including any closing question or offer. Then open that file.
2. **The arguments name a markdown file:** an existing path, or a name that matches exactly one tracked
   file (`git ls-files '*.md' | grep -i <name>`). Open that file. A vague name with several matches: list
   them and ask which one; do not open any.
3. **Anything else** is a question or request: write your full answer to a new file instead of to chat, in
   the form you would have used in chat (plain markdown, no line numbers). Then open that file.

## New files (modes 1 and 3)

- Directory: `.notes/drafts/` in the current working directory. Create it if missing. Keep it out of git:
  if `git check-ignore -q .notes/x` fails, tell the user once that `.notes/` belongs in their global
  gitignore (`~/.gitignore` or `core.excludesFile`), and do not add the file to git.
- Name: `<timestamp>-<slug>.md`, where `<slug>` is 2-5 lowercase hyphenated words naming the topic.
- Content: this header, then the body, nothing else:

```
---
date: <date for the header>
session: <session id>
kind: captured-response | file-answer
prompt: <the user message this body answers, trimmed to one line - for a bare /ann, the message that preceded your previous response; for /ann <question>, the question>
---
```

## Open the file

```
node ${CLAUDE_SKILL_DIR}/scripts/ann.mjs open <file>
```

It starts a local server for that file (or reuses a running one), opens the default browser on a
tokenised `127.0.0.1` URL and prints `url:`, `file:` and `log:`. Reply in chat with one line: the URL
and the file path. Then stop. Do not wait, poll, or watch the file: comments are saved into the `.md`
file as they are made, and the user comes back in the terminal with "address the annotations in
<path>". Handle that as `${CLAUDE_SKILL_DIR}/references/criticmarkup.md` says (inventory every
annotation, work out each one's scope, act on its intent, reply in chat, never edit or remove the
annotations); read it then if it is not already in context. The page reloads itself whenever the file
changes, including when you edit it.

If the command fails with "Dependencies are missing", run `npm ci` in `${CLAUDE_SKILL_DIR}` once (Node 20 or later).
`ann.mjs list` shows running servers, `ann.mjs stop <file>` stops one; they exit by themselves 30
minutes after the last tab closes. Details, internals and verification: `README.md` next to this file.
