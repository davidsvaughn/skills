# chat2md notes: what is known about each site's shares

What agents have found out about how each site publishes a shared conversation, how to get it out, and what failed.
`SKILL.md` says how to run the skill; this file is the evidence behind it, for whoever debugs a failure, changes a script or adds a site.
Read it before doing any of those, and add to it as you learn; the rules for adding are in `SKILL.md`, under "NOTES.md: keep it current".

Each entry is dated and says how it was established.
"Seen" means observed on the share named; "assumed" means nobody has checked it.

## ChatGPT (`chatgpt.com/share/<id>`)

Evidence: the original script (written by 2026-09-18, its evidence not recorded), and share `6ab4295a-...` converted on 2026-09-23.

### Fetching

- `chatgpt.com/backend-api/share/<id>` and the other JSON endpoints answer 403 to anything that is not a browser (by 2026-09-18; not rechecked since).
- The share page itself fetches with Python's urllib and a browser User-Agent (seen 2026-09-23).
- A saved page names its share link in `<link rel="canonical">` (seen 2026-09-23).
  Do not use `og:url` for this: the same page has two of them, the share link and plain `https://chatgpt.com/`.

### Payload

- The conversation is in a React Router stream payload: string literals passed to `streamController.enqueue(...)`, 2 of them on 2026-09-23.
  Joined and parsed, they form a flat pool of values; an object's keys look like `"_<n>"` and point at pool indices, as do its integer values, and negative integers stand for undefined or null.
- An older format put it in a `__NEXT_DATA__` script (by 2026-09-18; not seen since).
- The conversation object carries `title`, `default_model_slug` (`gpt-6-astra-wm` on 2026-09-23), `linear_conversation` (the display order) and also `mapping` with `current_node` (seen 2026-09-23).
- A conversation with branches is flattened to the path the share displays, which is what `linear_conversation` holds (assumed from the original script).

### Messages

Each node's `message` has `author.role`, `recipient`, `content.content_type` and `metadata`.
Kinds seen on 2026-09-23, with what the converter does:

- `user` or `assistant`, `text`, recipient `all`: a message, written out.
- `assistant`, `text`, recipient `web.run`: a search call, noted with its `metadata.search_queries`.
- `assistant`, `thoughts`: thinking summaries, noted.
- `assistant`, `reasoning_recap`: the "Worked for 2m" line, noted.
- `assistant`, `model_editable_context`: empty and marked `is_visually_hidden_from_conversation`, skipped.
- `assistant`, `text`, recipient `api_tool.call_tool`, and the `tool` reply after it: both say only "The output of this plugin was redacted."
  The converter skips them without a note (see `TODO.md`).
- Tool results are not published: container and plugin output comes through redacted (by 2026-09-18, and seen again 2026-09-23).

### Citations

- Citations are private-use code points U+E200..U+E206 around an opaque id, inside the message text (by 2026-09-18).
- The sources are in the message's `metadata.content_references`, each with `matched_text`, `start_idx`, `end_idx` and its links in `item`, `items`, `fallback_items` or `sources`.
- The end-of-message source list is a reference of `type` `sources_footnote` whose `matched_text` is a single space and whose `start_idx` is usually past the end of the text, so splicing by span is the only safe placement; a string replace of the marker hits the wrong spot.
- The footnote's `start_idx` is not always past the end (seen 2026-09-26, share `6ab7587c-...`, model `gpt-5-6-thinking`, and again on the 2026-09-19 share `6aade23c-...`).
  When the message closes with suggested follow-up prompts (`followup_a`), `start_idx` points inside the text, just before those bullets, at a character that is not its space (a newline on `6ab7587c-...`).
  Until 2026-09-26 the converter then fell back to a text search for the space and spliced the whole source list after the message's first word ("Yes ([GitHub](...))— ..."), eating the space; the verbatim check still reported "verified" (see `TODO.md`).
  Now a `sources_footnote` always goes to the closing `Sources:` line, and a whitespace marker whose span does not match is never searched for by text.
  Re-converting the five ChatGPT shares on record changed only those two footnotes.
- Not every `content_references` entry is a citation (seen 2026-09-24, share `6ab4c074-...`, model `gpt-5-6-thinking`).
  ChatGPT's suggested follow-up prompts come as references of `type` `followup_a` with `matched_text`, `start_idx` and `end_idx` covering the model's own closing bullet lines ("If you want, I can: - ..."), an `alt` equal to the bullet text, a `prompt_text` with the full suggested prompt, and no links.
  Until 2026-09-24 the converter rendered a link-less reference as an empty string and so deleted those bullets, leaving `- ` lines; the verbatim check did not notice because its pieces are cut at every spliced span.
  Now a link-less span is removed only when its reference is of `type` `hidden` or the span is whitespace or starts with a private-use glyph; any other text stays.
  The `prompt_text` (the fuller suggested prompt) is not part of the message and is not written out.
- The other link-less type seen is `hidden` (share `6ab4295a-...`, 2026-09-21, two occurrences): a UI payload such as `genui{"suggest_automation":{"label":"..."}}` embedded in the message text, wrapped in the same private-use glyphs as citations.
  It is not the model's prose and is removed; a first version of the 2026-09-24 guard kept it, which the regression check against the stored transcript caught.

## Claude (`claude.ai/share/<uuid>`)

Evidence: share `16855790-...`, 2026-09-23, with playwright-cli 0.1.20 and its Chromium (user agent `HeadlessChrome/150` when headless).

### The share page

- The page is a 125 KB app shell with `og:title` "Claude" and no conversation text in it, so a saved page is useless.
- Its script loads the conversation from `/api/chat_snapshots/<uuid>?rendering_mode=messages&render_all_tools=true`; that path appears in the page's own inline script.
- The rendered page shows a banner "Shared by <first name>. ... Shared snapshot may contain attachments and data not displayed here."
  Its turns are headed "You said:" and "Claude responded:", and a long user message is folded behind "Message collapsed / Show more", another reason not to scrape the page.

### Fetching and Cloudflare

- The snapshot API is behind a Cloudflare bot check, whose challenge is HTTP 403 with `content-type: text/html` and the header `cf-mitigated: challenge`.
- The check scores the whole request, not only the IP:
  curl with a Chrome User-Agent got 403 three times out of three; Python's urllib with the same User-Agent (`... Chrome/140.0.0.0 Safari/537.36`) got 200 three times out of three; urllib with its default User-Agent got 403.
  An early probe with curl alone made it look as if every plain request fails, so test with urllib before concluding that.
- `/api/share/<uuid>` also answered 403 to curl; whether it exists at all is unknown.
- A headless browser does not pass: the snapshot request gets 403 and the page moves to `/api/challenge_redirect?to=...` with the title "Just a moment...", and keeps looping there.
  Do not disguise a headless browser to get past this.
- A headed browser passes on the first load with no click: the snapshot request returned 200, and open, fetch and close took 3.4 s.
- Opening the API URL directly in a headed browser also returns the JSON (`application/json`), which is the manual fallback.
- Playwright cannot read a response's body after the page has navigated away ("Response body is not available for a response that was navigated away from"), so the browser code listens before calling `goto` and reads the body inside the response handler.
- `playwright-cli --raw run-code` prints a returned object as one line of JSON; on failure it prints `### Error` text instead.
  A 75 s wait inside `run-code` finished normally, so the CLI does not cut off a wait of that length.

### Snapshot JSON

- Top-level keys: `uuid` (the share id), `conversation_uuid`, `created_at`, `updated_at`, `snapshot_name` (the title), `created_by` (the sharer's first name), `creator` (`uuid`, `full_name`), `project_uuid`, `chat_messages`, `up_to_date`, `is_public`, `working_documents`.
- There is no model field anywhere in the snapshot.
- `working_documents` was an empty list; what fills it is unknown.
- The transcript leaves the sharer's name out, as the ChatGPT one does.
- Each message has `uuid`, `index`, `sender` (`human` or `assistant`), `created_at`, `content` (a list of blocks), `text` (empty; the words are in `content`), `attachments`, `files`, `file_count`, `image_count`, `truncated`, `stop_reason` (`end_turn`), `compaction_summary`, `parent_message_uuid`, `input_mode`, `attached_folders`, `local_project`.
- The first message's parent is `00000000-0000-4000-8000-000000000000`, and each later one points at the message before it; no branches were seen.

### Content blocks

Every block has `type`, `start_timestamp`, `stop_timestamp` and `flags`.

- `text`: `text`, `citations`, and `citations_grouping_mode` (`paragraph_end` seen) on assistant blocks.
- `tool_use`: `id`, `name` (`web_search_fast` seen), `input` (`{"query": ...}`), `message` ("Searching the web"), `icon_name`, `tool_origin` (`first_party`), and many fields that were null: `integration_name`, `integration_icon_url`, `mcp_server_url`, `tool_identifier`, `context`, `display_content`, `approval_options`, `approval_key`, `is_mcp_app`, `hidden_in_chat`.
- `tool_result`: `tool_use_id`, `name`, `is_error`, `structured_content` and `meta` (null), and `content`, a list of results.
  A search result is `{"type": "knowledge", "title", "url", "metadata": {"type": "webpage_metadata", "site_domain", "favicon_url", "site_name"}, "is_missing"}`.
  Result titles are often junk or repeated (the same page in eight languages, a title that is Romanian for "skip to main content"); that is the data, and the transcript keeps it as it is.
- Consecutive text blocks in one message are shown as one continuous text (assumed; this share had one text block per stretch).

### Citations

- A citation is `{uuid, title, url, metadata, origin_tool_name: "web_search", sources: [{title, url, source, icon_url, subtitles, resource_type, content_body, uuid}], start_index, end_index}`.
- `start_index` and `end_index` count characters (code points) into that text block; checked on text containing em dashes, but not on text with emoji, which would tell code points from UTF-16 units.
- With `paragraph_end` the page shows the chip at the end of the cited paragraph, labelled with the source's `source` field ("datacamp").

### Attachments

- A message with an attachment the share hides has `file_count: 1` while `attachments` and `files` are both empty, and the page shows a "Files hidden when shared" heading in that message.
- Long pasted text, which claude.ai turns into an attachment, is hidden the same way; its content cannot be recovered from the share.

## Open questions

- The shape of Claude thinking, artifacts, file creation, code execution, `web_fetch` and MCP tool blocks in a share; so far only a synthetic snapshot has been through the generic renderer.
- What `working_documents` holds on a Claude share, and whether artifacts appear there.
- How a Claude share reports images: `image_count` is not used yet.
- Whether Claude citation offsets are code points or UTF-16 units on text with emoji.
- How long urllib keeps passing claude.ai's Cloudflare check.
