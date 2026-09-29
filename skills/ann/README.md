# ann: annotate markdown in the browser

`/ann` renders a markdown file in the browser; you select text and type a comment, and the comment lands in
the `.md` file as CriticMarkup (`{==highlighted text==}{>>you|2026-09-25: comment<<}`), byte-compatible with the
VS Code md-comments extension and with the protocol in `references/criticmarkup.md`. The file on disk
is the only store; there is no database, no send button and no waiting process: when you are done you type
"address the annotations in <path>" in the terminal. `SKILL.md` is what Claude reads; this file is for whoever
maintains the tool.

Built 2026-09-25 (the core by one Claude session, the server, page, CLI and verification by the next).
Decisions taken that day and not open: one skill with the three `/draft`-like modes; terminal-only handoff; no
extras (chat panel, whiteboards, feedback queues).

## Layout

```
SKILL.md               what Claude does on /ann
references/            criticmarkup.md: how Claude addresses the annotations afterwards
scripts/ann.mjs        CLI: open <file> [--no-open] [--idle-minutes N] | stop <file> | list | serve <file>
lib/criticmarkup.mjs   scan CriticMarkup, group into threads, mask
lib/render.mjs         parse, analyze, align, render HTML with source offsets, threadInfo()
lib/edit.mjs           addComment, addGeneral, reply, editComment, deleteComment, resolve, and the safety check
lib/server.mjs         one file served on 127.0.0.1 with a token in the path; SSE reload; atomic writes; undo
web/                   index.html, app.js, app.css (no build step, no framework)
test/edit.test.mjs     unit tests: node --test test/*.test.mjs
dev/corpus-check.mjs   read-only render of every tracked .md in a repo, checks the render invariant
dev/fuzz.mjs           random selections on real docs, in memory; every accepted edit undone by hand and compared
package.json           exact-pinned deps (mdast-util-from-markdown, gfm, frontmatter); npm ci after a copy
```

State: `${XDG_STATE_HOME:-~/.local/state}/ann/<sha1(realpath)[:12]>.json` per served file (`{pid, port, token,
file, log}`) and `logs/<same>.log`, one line per event, appended.

## Using it

Paths assume the skill is installed at `~/.claude/skills/ann`.

```
node ~/.claude/skills/ann/scripts/ann.mjs open docs/foo.md      # starts or reuses a server, opens the browser
node ~/.claude/skills/ann/scripts/ann.mjs list
node ~/.claude/skills/ann/scripts/ann.mjs stop docs/foo.md
```

In the page: select text, press the floating Comment button (or Ctrl+Shift+M, the extension's key), type,
Enter. Shift+Enter is a newline, Escape cancels an empty composer. Cards sit in the right margin beside their
highlights; hover links card and highlight; each comment has Edit and Delete, each thread Reply and Resolve.
"Comment on whole doc" puts a point comment above the first block. Undo (button or Ctrl+Z outside a text
field) reverts the last edit made from this page. Below 1000 px the cards are listed after the document. The
page follows the file: when Claude or an editor changes it, the page re-renders; if a composer was open, the
typed text is kept and you are asked to reselect. The author name is `ANN_AUTHOR`, else
`review-comments.authorName` from VS Code's settings, else `you`.

A server exits 30 minutes after the last tab disconnects (`--idle-minutes`, 0 = never), on SIGTERM
(`stop`), and removes its registry entry.

## How the core works

### The one idea

The browser shows rendered markdown; the file holds source. Every run of rendered text is emitted as
`<span data-s="OFFSET">text</span>` where `text === source.slice(OFFSET, OFFSET + text.length)`. Text that
cannot map one to one (a decoded entity like `&amp;`, a whole code block) is emitted with `data-s` and `data-e`
and treated as a unit. The browser converts a DOM selection to `[start, end)` source offsets through these
attributes alone (`rangeToOffsets` in `app.js`) and posts them; the server edits the source. Offsets are
JavaScript string indices, the unit mdast positions use.

### Parsing and alignment (`lib/render.mjs`)

- `parse()` is `mdast-util-from-markdown` with GFM and YAML/TOML front matter.
- `align(value, slice, base)` walks a node's value against its source slice: equal characters extend an identity
  run; syntax characters are skipped (`\` escapes, `>` quote markers, list-continuation indentation, `\r`,
  backticks of code spans); an entity becomes a unit. An unexpected difference maps the rest as one unit; on
  the corpus this never happens.
- `repairPositions()`: the GFM literal-autolink transform splits a text node into text and link nodes with no
  positions (543 such nodes in the test corpus). They are recovered by finding each piece in order
  between positioned siblings; a second pass gives any text piece still unplaced the gap between its
  neighbours and lets `align` map inside it. Nodes that still have no position render as plain, unselectable
  text.
- `analyze()` memoizes its last result (the server renders a version, edits it, renders the result; without the
  memo each step re-parsed the same source).

### CriticMarkup scanning and masking (`lib/criticmarkup.mjs`)

- `analyze()` parses the raw source once to find fenced/indented code blocks and front matter (CriticMarkup
  there is literal, for example syntax examples in docs), scans the rest, then parses a masked copy for
  rendering.
- CriticMarkup inside inline code is live, deliberately: real review docs carry annotations inside backticks.
  Inside code blocks it is literal. A doc whose inline code shows syntax examples therefore shows them as
  annotations.
- A highlight, insertion or deletion may contain a whole code block (markers on the lines around it); a
  comment or substitution may not run into one.
- `mask()` replaces every hidden character (markers and whole comments) with `MASK = '⸰'`, same length, so
  offsets stay valid and the parser never sees CriticMarkup syntax. The mask character must be Unicode
  punctuation: a private-use character is treated as a letter by emphasis flanking, so `**Label:**==}` stopped
  closing the bold.
- Threads: an anchor (highlight, insertion, deletion, substitution) followed directly by comments, or a run of
  adjacent comments with no anchor (point comment). Threads and comments are identified by their start
  offset in a given version of the file.

### Rendering

`render(an)` walks the masked tree with a hand-written renderer (not mdast-util-to-hast, to control offsets
and escaping). Per-offset kind/thread arrays decide how each character renders: hidden (dropped, with a
`<span class="cm-anchor" data-anchor="ID">` at the first comment of each thread), `<mark class="cm-hl"
data-t="ID">`, `<ins class="cm-ins">`, `<del class="cm-del">`, substitution old/new. Code blocks are `<pre
class="code" data-s data-e>` units; a highlight around one wraps it in `<div class="cm-block cm-hl" data-t>`.
Front matter renders as `<pre class="frontmatter">` without offsets (not annotatable). Relative link and image
targets are rewritten to `files/<path>`, which the server serves from the document's directory, refusing
anything outside the git work tree (or the file's directory when not in one); `javascript:` and other schemes
are dropped. `threadInfo()` gives the browser `{id, kind, start, end, line, quote, placed, comments}`; a
thread with `placed === false` (CriticMarkup inside a link URL, say) is shown at the top of the margin as
unplaced, never hidden.

### The safety check (`lib/edit.mjs`, `check()`)

Every edit re-analyzes the new source and is refused unless all of these hold:

1. the masked tree has the same structure (node types and nesting; paragraphs that contain only masked
   characters are ignored; bare literal autolinks are ignored because markup placed right after a URL runs
   into the URL in any renderer, which is cosmetic);
2. the visible text is the same (masked values minus MASK, whitespace-normalized);
3. the raw (unmasked) block structure is the same, computed after replacing `|` inside comments with spaces:
   the `you|date` prefix already splits table cells in renderers that do not know CriticMarkup, and annotating
   inside tables is common, so a pipe in a comment is accepted while a line break in a table comment
   (which really breaks the row) is refused;
4. the new annotation is found where it was put.

A refusal throws `EditError` with a user-facing message and `.detail` naming the failed checks; the file is
never written. The three views of a version are cached on the analysis.

### Placing a new comment (`addComment`)

1. Trim whitespace off the selection, then widen it to whole words.
2. If it lies inside an existing highlight or suggestion, it becomes a reply to that thread.
3. If it overlaps an existing thread otherwise, refuse ("select outside it, or reply").
4. Snap: inline units (inline code, images, footnote refs, inline HTML, breaks, bare URLs) are covered whole;
   emphasis, strong, strikethrough and links are covered whole when the selection half-covers them, and left
   alone when it lies wholly inside; code blocks are covered whole.
5. A fenced code block at either end is wrapped with the marker on a line of its own, keeping the container
   prefix (`> ` in a blockquote, indentation in a list); a code block that opens a list item, indented code
   and raw HTML blocks are refused with a message.
6. Insert `{==` and `==}{>>author|date: text<<}`, run the check.

`addGeneral` puts a point comment on its own paragraph above the first block (after front matter).
`deleteComment` removing the last comment of a highlight also removes the highlight; `resolve` removes markers
and comments; both remove the lines a wrapped code block added and the blank line a lone point comment
leaves. Suggestions (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`) are rendered and can carry comments, but resolve
refuses them (they are accepted or rejected in the file). CRLF files keep CRLF.

### The server (`lib/server.mjs`)

Node `http`, bound to `127.0.0.1` on a random port, every URL under `/<32 hex token>/`; requests whose `Host` is
not `127.0.0.1:PORT` or `localhost:PORT` get 403 (DNS rebinding); POST bodies must be JSON. Routes: `GET /`
(page), `app.js`, `app.css`, `api/doc`, `api/ping`, `api/events` (SSE: `hello`, `doc {version}` on every change,
a comment line every 25 s), `files/<path>`; `POST api/comment|general|reply|edit|delete|resolve|undo`, each
with `version` = short sha1 of the file content: a mismatch is a 409 with the current doc and changes nothing,
so an edit never lands on a stale base; a refused edit is a 422 with the message. Writes are atomic (temp file
beside the document, same mode, rename), the in-memory hash is updated first so the watcher (`fs.watch` on the
directory plus `fs.watchFile`, debounced) sees no echo; a real outside change is broadcast. Undo keeps
`{before, afterHash}` and restores `before` only while the file still hashes to `afterHash`. The log shows every
event with timing.

## Verification (done 2026-09-25, all against copies in a scratch directory, never repo files)

- Unit tests: 31, all pass (`node --test --test-reporter=tap test/*.test.mjs`).
- Corpus (`node dev/corpus-check.mjs <repo>` on a private docs repo, 652 tracked `.md` files): 144,123 text spans,
  0 mismatches; all 63 annotation threads placed; only `docs/TODO.md` (250 KB) renders over 150 ms (166 ms).
- Fuzz (`node dev/fuzz.mjs out.json <repo>`, same corpus): 1,444 random selections accepted and undone byte for byte (strip by
  hand, `deleteComment`, `resolve`), 31 refused as whitespace-only, 39 wrap a fenced code block; the reply
  pass placed 58 replies inside existing highlights or suggestions in 11 docs, 1 refused (whitespace). Hand reading of 18
  random placements plus all refusals found the word snapping, inline-code and link covering, and code-block
  wrapping correct; it found the bare-URL split (fixed: a bare URL is now a unit).
- Edit latency on the server (log timings): 100 to 210 ms on a 45 KB doc, 683 ms on the 250 KB `TODO.md`
  (three parses of the edited text for the check; the render is cached).
- End to end in Chromium with `playwright-cli`, headed: comment on plain text, across bold, across list items, in a
  table cell, over a fenced code block; reply, edit, delete, resolve, undo twice (file compared after each
  step); an outside edit with the page open (live reload) and with a composer open (text kept, reselect asked,
  then saved); a forced stale version (409, reloaded, toast); the overlap refusal and the line-break-in-table
  refusal (422, message shown, text kept); the whole-document comment; Ctrl+Shift+M; hover linking; dark mode;
  800 px width; a file with front matter; a file with CriticMarkup inside code blocks (stays literal); the
  250 KB file. No console errors other than the browser logging a 422 for a refused edit; no failed requests.
- CLI: idle exit with no tab (registry entry removed), `stop` on a dead and a live entry, `list`, the
  missing-`node_modules` message.
- Not yet done: opening a browser-annotated file in VS Code's preview with the md-comments extension to confirm
  it lists the comments.

## Known limits

- Highlights may span paragraphs, list items and table rows; the check accepts them and the viewer renders
  them. Outside this viewer the markers show wherever they land, as with the VS Code extension today.
- Indented code blocks, raw HTML blocks and code blocks that open a list item cannot be wrapped; the user gets a
  message suggesting a nearby selection.
- A comment placed right after a bare URL makes the URL run into the markup in plain GFM renderers (text
  intact, link wrong). Cosmetic; accepted in the check on purpose.
- The md-comments extension lists only comments attached to a highlight, so a whole-document point comment
  (`{>>...<<}` alone at the top) is read by Claude's protocol but does not appear in that extension's list.
- Suggestion authoring (`{++ ++}` etc.) is out of scope; they render and can be commented on.
- An edit on a very large file costs three parses of the new text (0.7 s at 250 KB). Parsing only the
  region around the edit would weaken the check; a worker-thread parallel parse would save a third.

Source: [github.com/davidsvaughn/skills](https://github.com/davidsvaughn/skills), `skills/ann`.
