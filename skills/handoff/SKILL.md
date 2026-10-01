---
name: handoff
description: Write the next numbered handoff file (HANDOFF-001.md, HANDOFF-002.md, ...), a complete current-state snapshot that lets the next agent or session pick up the work without the chat history, while every earlier handoff stays untouched so the chronology is easy to recover. Use when the user asks to prepare, update, refresh or run a handoff, says /handoff, wants a "where are we" summary written down for the next session, or is wrapping up a long working session.
argument-hint: "[directory for the handoffs | note on what to emphasize]"
---

# /handoff - a numbered current-state snapshot

Session id: ${CLAUDE_SESSION_ID}
Date: !`date '+%Y-%m-%d %H:%M'`
(If the lines above show a variable name or a command instead of values, this harness does not fill them in: run `date '+%Y-%m-%d %H:%M'` yourself and leave the session id empty.)

Arguments: the text the user typed after the skill name, which the harness appends after these instructions (Claude Code as `ARGUMENTS: ...`, pi/OMP as `User: ...`); none appended means no arguments.

A handoff answers one question for a fresh agent: where are we right now, and what is next?
Each handoff is a new, complete file; older ones are never edited or overwritten.
The series is the history: the highest number is the current state, and a diff between two consecutive files shows what changed between them.

## Find the series

1. If the arguments name a directory, the series lives there.
2. Otherwise look for one: `git ls-files | grep -i -E '(^|/)handoff(-[0-9]+)?\.md$'`, and also check `docs/handoffs/`.
   Numbered files in one directory: that is the series.
   Numbered files in several directories: list them and ask which one.
   Only an unnumbered `HANDOFF.md`: treat it as the previous snapshot, leave it as it is, and start the series in the same directory.
3. Nothing found: propose `docs/handoffs/` (or `handoffs/` at the root if the repo has no `docs/`) and start there once the user agrees.

## Choose the file to write

- The next number is the highest existing number plus one, zero-padded to three digits: `HANDOFF-001.md`, `HANDOFF-002.md`, and so on.
  With no existing files, start at `HANDOFF-001.md`.
- Exception: if you know this session's id and the latest file's header carries the same one, this session wrote it, so update that file in place instead of starting another.
  An empty or unknown session id never matches; write a new file.
- Never modify any other handoff.

## Write it

1. Read the previous snapshot (the latest numbered file, or the legacy `HANDOFF.md`), if there is one.
2. Check the repository state: `git status --short --branch` and `git log --oneline -10`.
3. Gather what changed this session: code and doc changes, test and build results, commits pushed, blockers hit, and priorities the user stated.
4. Start the new file from the previous snapshot and rewrite every section that is no longer true.
   The file describes the present; do not append "update:" lines under stale ones.
   Put what changed since the previous handoff in "Since the last handoff".
5. Make the file self-sufficient as an entry point, not as a copy: a fresh agent given only this file must reach everything else by links.
   - Open with a "Read in this order" list of Markdown links (relative paths): the project's authoritative state document first, then the index/pointer document, then any instrument or recipe the next step depends on, then background. Every document, dossier, skill or script named anywhere in the file is a link, not a bare path.
   - If the project keeps its queue in a state document (a `docs/…/NN-state-*.md`, a ledger, a TODO with a stated precedence rule), do not restate it as an independent list: link the queue section, say it is authoritative, and keep "Next recommended actions" to a convenience restatement that defers to it.
   - Anything the session's comparisons or results depend on that exists only in chat or in tool calls (reviewer instructions, judge prompts, grading rubrics, exact run recipes and environment, group splits) is written to a file in the repo first and linked; a number that cannot be reproduced on the same instrument is not handed off.
   - List every process the next agent must restart because it will not survive the session (proxies, tunnels, dev servers, watchers started from this session), each with its exact start command.
   - Name what is waiting on the user (decisions, approvals, deletions) separately from what the next agent can do unaided.
6. Check that every link resolves (for example `for l in $(grep -o "]([^)]*)" FILE | tr -d '])(' | sort -u); do [ -e "$l" ] || echo "BROKEN $l"; done`, run from the handoff's directory).
7. Commit the new file with the work it describes; push if the project's workflow pushes checkpoints.

## Template

```markdown
---
handoff: 003
date: <date>
session: <session id>
previous: HANDOFF-002.md
---

# Handoff 003

## Read in this order
<numbered Markdown links: authoritative state document (queue section flagged) → pointer/index → instruments and recipes the next step needs → background>
## Current status
## Since the last handoff
## Latest session notes
## Last verified commands
## Processes to restart
## Next recommended actions
<defers to the linked queue when the project keeps one>
## Known constraints
## Known issues / open questions
## Waiting on the user
```

## Style

- Bullets over paragraphs; no pasted transcripts.
- Exact paths, branch names, commit hashes, IDs and command results where they help the next agent act.
- "Last verified commands" lists commands that were actually run this session, with their outcome, not commands that should work.
- If the next step is obvious, state it directly.
- Links, not paths: a reader must be able to click through to every document the file relies on; bare `docs/...` paths in backticks are only for files that do not exist yet.
