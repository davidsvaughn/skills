---
name: chat2md
description: Convert a shared ChatGPT or Claude conversation link (chatgpt.com/share/... or claude.ai/share/...) into a complete markdown transcript file - every user and assistant message verbatim, tool and search steps noted, citations kept as links. Use this whenever someone pastes a ChatGPT or claude.ai share link and wants it saved, archived, converted, written to a file, added to a repo's notes, quoted in a doc, or "turned into markdown" - even when they only say something like "make a doc out of this chat" or "save this thread". Also use it when a shared chat needs to be read in full rather than summarized.
argument-hint: "<share URL> [output path]"
---

# chat2md - a shared ChatGPT or Claude thread as a markdown file

Run the bundled script with the link.
It works out which site the link is from, gets the conversation out, and writes the transcript:

```bash
python3 ${CLAUDE_SKILL_DIR}/scripts/chat2md.py "<share URL>" --out <path.md>
```

It is stdlib-only Python, so there is nothing to install.
For a claude.ai link it may open a browser window for a few seconds (see below), so tell the user before running it.
If the run taught you anything new about the site (a failure, a new block type, a surprise in the output), add it to `NOTES.md` before you finish, as "NOTES.md: keep it current" below describes.

## Why the script exists

Fetching the page and reading it is not enough on either site, and the obvious shortcuts fail.
The evidence for everything below, with dates and the dead ends, is in `NOTES.md`.

- **ChatGPT** (`source_chatgpt.py`): the JSON endpoints answer 403 to anything but a browser, so do not spend turns on them.
  The share page fetches fine, but the conversation sits in an encoded React Router payload inside it, which the script decodes.
- **Claude** (`source_claude.py`): the share page is an empty app shell, so a saved claude.ai page is useless.
  The conversation comes as JSON from claude.ai's snapshot API, which is behind a Cloudflare bot check.
  The script tries a plain request first, and when Cloudflare refuses it, opens a short-lived visible `playwright-cli` browser (session `chat2md-<first 8 characters of the Claude Code session id>`, override with `--browser-session`), keeps the snapshot the page requests, and closes the window; that takes a few seconds.
  The plain request sends an ordinary browser User-Agent on a single fetch of a public page, and that is as far as it goes: a headless browser does not pass the check, and the check itself is never evaded (no faked browser fingerprints, no automated challenge solving); when the plain request is refused, the visible window is the route.

Reading the rendered page instead (browser, copy-paste) loses code blocks, tables and links on both sites, and quietly drops anything below the fold.

## Where to write the file

Look for a convention before inventing one: if the repo already keeps transcripts (for example a `docs/chats/` folder of numbered files), match that folder and its numbering, and use the default `qa` style, which is what those files use.
If there is no such folder, use the path the user gave, and otherwise propose one rather than guessing silently.

## Options worth knowing

| flag | what it does |
|---|---|
| `--out FILE` | write the transcript (default: stdout) |
| `--stdout` | print the transcript as well as writing it |
| `--json FILE` | also dump the decoded conversation object, for inspecting anything the transcript does not carry |
| `--save-raw FILE` | keep what was fetched (the ChatGPT page, the claude.ai JSON), which is what you need if a format ever changes |
| `--url URL` | the share link to name in the header when converting a saved file that does not carry it |
| `--style sections` | `## User` / `## Assistant` headings instead of the `Q:` / `A:` layout |
| `--no-activity` | leave out the tool, search and thinking notes, and the tool inputs and outputs with them |
| `--no-header` | leave out the title and source lines |
| `--browser-session NAME` | claude.ai: the playwright-cli session name for the browser fallback |
| `--browser-timeout SECONDS` | claude.ai: how long to wait for the snapshot in the browser (default 180) |

Instead of a link, the script also takes a saved file: a ChatGPT share page saved as HTML, or a claude.ai snapshot saved as JSON.
Either way the header still names the share link, which both files carry.

## What the output contains

Every user and assistant message in full, in order, separated the way the repo's other transcripts are.
Between them, in italics, the steps the assistant showed while working.
User attachments are named, and when the share includes their text (claude.ai pasted text), it is written out in full.
Citations become ordinary markdown links, because the links are the part worth keeping.

```
Q: does claude code, when using fable, automatically delegate to cheaper models?

---

A:

I'm checking the current behavior and whether there's an established routing skill.

*[web search: claude code subagent model haiku cost]*
*[Worked for 32s]*

No, not in the general sense you're asking about. ([Claude](https://code.claude.com/docs/en/subagents))
```

What each site publishes differs, and the notes follow it:

- **ChatGPT**: searches with their actual queries, the commands it ran, thinking summaries and "Worked for 32s" lines.
  A ChatGPT share does not publish tool results, so they are not in the file.
  A message's trailing source list becomes a `Sources:` line.
- **Claude**: each web search with its query, then a line with every result as a link.
  A citation link goes where claude.ai shows its chip: at the end of the cited paragraph, or in a `Sources:` paragraph of its own after a table or code block.
  Consecutive text blocks are joined the way the page shows them.
  Thinking, other tool calls and their results, and any block type the script does not know are written out in full inside collapsed `<details>` sections, so nothing is lost and the rendered file stays readable.

## Reporting back

The script prints, to stderr, the title, the message counts, the character counts, any notes, and a line confirming that every message survived into the file; it exits non-zero if one did not.
For claude.ai messages that carry citations, the check is made against Claude's original text cut at each inserted link, not only against the rendered text.
Pass those numbers on to the user - they are the evidence that nothing was lost, which matters here because a transcript that quietly drops a turn looks exactly like a good one.
Never shorten or summarize a message to tidy the file; verbatim is the whole point.

Notes worth passing on when they appear:

- **"user attachment(s) are hidden by the share itself"** (claude.ai): the share leaves out the file, and the page shows "Files hidden when shared" in its place.
  The transcript marks the spot with `*[attached: 1 file, hidden when shared]*`, but the content cannot be recovered from the link; only the person who shared it has it.
- **"rendered by the generic path"** (claude.ai): so far only text, citations, web searches and hidden attachments have been checked against a real share.
  Thinking, artifacts, file creation, code execution, web fetches and anything else go through a generic renderer that writes out all of their content.
  Read those parts of the file before handing it over.
  When a real share shows their shape, record it in `NOTES.md`, give them proper handling in `source_claude.py`, and update this list.
- A conversation with branches is flattened to the path the share displays.

## When it does not work

- **ChatGPT, HTTP 403 on the page**: a bot check from this network.
  Ask the user to open the link and save the page (Ctrl+S, "Web Page, HTML only"), then pass the saved file instead of the link.
  The `playwright-skill` browser can also save it.
- **ChatGPT, "No conversation found"**: usually a private `chatgpt.com/c/...` URL, which only loads for its owner; ask for a share link (Share -> Create link).
  If it really is a share link, keep the page with `--save-raw` and look for `linear_conversation` or `mapping` inside it; the format has moved before and the extractor is a small function to extend.
- **claude.ai, no browser or the browser fetch fails**: open `https://claude.ai/api/chat_snapshots/<uuid>?rendering_mode=messages&render_all_tools=true` in a browser (a normal window passes the check), save the JSON it shows, and pass that file.
  If the window shows a Cloudflare checkbox, the user can click it while the script waits; `--browser-timeout` gives them longer.
- **claude.ai, HTTP 404**: the share was unshared or deleted.
  A `claude.ai/chat/...` URL is private; ask for a share link (Share -> Create public link).
- **A share link from another assistant** (Gemini, Grok, ...): not supported.
  Adding a site means adding a `source_<site>.py` with `NAME`, `handles_url`, `handles_file` and `load`, as the two existing modules do, and listing it in `SOURCES` in `chat2md.py`; rendering and the verbatim check come for free.
  Start a section for the site in `NOTES.md` while working out where its conversation lives.
  For a one-off, convert by hand from a saved page, keeping the same file shape, and say in the header where it came from.

Whatever the failure, check `NOTES.md` first: the cause may already be known, and if it is not, it belongs there once found.

## NOTES.md: keep it current

`NOTES.md` is this skill's memory of how each site publishes its shares: the formats, the fields, the fetch behaviour, and the things that were tried and failed.
Sites change without notice, and every agent that runs this skill after you starts from what that file says, so it is only as good as what the last agent wrote into it.

Read it before you debug a failure, change a script, or add a site.

Add to it, before the session ends, whenever you learn something about a site that the next agent would otherwise have to find out again:

- a format change, a new message or block type, or a field whose meaning you worked out;
- a fetch that started or stopped working, and what made the difference (tool, headers, browser mode, versions);
- an error and its cause, or a dead end that cost you turns;
- anything in a real run's output that surprised you, even when the script coped with it.

How to write an entry:

- Put it under the site's section, in the subsection it belongs to, one fact per bullet and one sentence per line.
- Date it (YYYY-MM-DD) and say how it was established: the share id, the command or tool, the versions involved.
- Say whether it was seen or is only assumed, and keep those apart; "assumed" entries are the first thing to check when something breaks.
- When a new observation contradicts an entry, correct the entry and keep one dated line on what it used to say, so the change itself is on record ("until 2026-09-23 the payload was ...").
- When you answer one of the open questions, move the answer into its section with the evidence, and remove the question.
- Record structure and behaviour, never content: no text from anyone's shared conversation, no names, no cookies, tokens or saved login state.

Keep the three files apart: `SKILL.md` says how to run the skill, `NOTES.md` what is known about the sites, and `TODO.md` what code work is still owed.
If a new finding changes how the skill should be run, update `SKILL.md` as well.

## Layout

- `scripts/chat2md.py`: the entry point; picks the source, renders, checks, reports.
- `scripts/source_chatgpt.py`, `scripts/source_claude.py`: one module per site, each turning its share into the same list of blocks.
- `scripts/chat2md_common.py`: the small helpers they share.
- `NOTES.md`: what is known about each site's shares, with evidence and dates; read and extend it as described above.
- `TODO.md`: code work still owed.
