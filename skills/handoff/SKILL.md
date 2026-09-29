---
name: handoff
description: Write or refresh the project's HANDOFF.md, the current-state entry point that lets the next agent or session pick up the work without the chat history, and log durable checkpoints in a history file beside it. Use when the user asks to prepare, update, refresh or run a handoff, says /handoff, wants a "where are we" summary written down for the next session, or is wrapping up a long working session.
argument-hint: "[path to the handoff file | note on what to emphasize]"
---

# /handoff - keep the current-state doc current

Arguments: $ARGUMENTS

A handoff answers one question for a fresh agent: where are we right now, and what is next?
It is not a history.
History goes in a log file beside it, so the handoff stays short enough to read first.

## Find the files

1. If the arguments name a file, use it.
2. Otherwise look for an existing one: `git ls-files | grep -i -E '(^|/)handoff\.md$'`.
   One match: use it.
   Several: list them and ask which one.
3. None: propose `docs/HANDOFF.md` (or the repo root if the repo has no `docs/`), and create it from the template below once the user agrees.

The history log is `IMPLEMENTATION-LOG.md` in the same directory, unless the handoff already links to a different one.
Create it on the first entry.

## Update the handoff

1. Read the handoff as it stands.
2. Check the repository state: `git status --short --branch` and `git log --oneline -10`.
3. Gather what changed this session: code and doc changes, test and build results, commits pushed, blockers hit, and priorities the user stated.
4. Update only the sections that changed.
   Rewrite stale lines rather than appending below them; the file describes the present.
5. If the session reached a durable checkpoint (a pushed commit, a finished milestone, a decision), append a short dated entry to the history log, unless one already covers it.
6. If you added or changed links, check that they resolve.
7. Commit the handoff with the work it describes; push if the project's workflow pushes checkpoints.

## Template for a new handoff

```markdown
# Handoff

Current-state entry point for the next agent or session.
History: [IMPLEMENTATION-LOG.md](IMPLEMENTATION-LOG.md).

## Current status
## Latest session notes
## Last verified commands
## Next recommended actions
## Known constraints
## Known issues / open questions
```

## Style

- Bullets over paragraphs; no pasted transcripts.
- Exact paths, branch names, commit hashes, IDs and command results where they help the next agent act.
- "Last verified commands" lists commands that were actually run this session, with their outcome, not commands that should work.
- If the next step is obvious, state it directly.
