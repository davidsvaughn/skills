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

### The "octane" page (since November 2026)

Evidence: share `6af54e47-...` (created 2026-11-12), and the earlier shares `6ae218de-...` and `6ae4edcb-...` re-fetched on 2026-11-12, all fetched with urllib; the page markup calls itself "octane".

- By 2026-11-12 every share link serves this page, the old shares included; there is no `streamController.enqueue(...)` payload any more, so the sections below describe what the page used to be.
  Until 2026-11-12 the converter answered "No conversation found" on it.
  The old format can no longer be fetched for a regression check: re-fetching a share on record gives the new page.
- The conversation is in `<script id="__WEB_MOBILE_DATA__" type="application/json">`, plain JSON, under `conversation`: `title`, `sharedContent` (`originalCreatedAt` in milliseconds, `lastMessageId`, og fields) and `messages`, a flat list in display order.
  Copies of the same messages sit in `octane-conversation-transcript` (user text only, assistant text empty) and in the `application-composer` scope's `serialized-conversation-state` inside the `data-octane-native-signals` scripts (text, no sources); neither is needed.
- A message is `{id, role, content}`; an answer adds `reasoningSummary` (a "Worked for ..." line, absent on some answers), `approvedUrls`, `renderedHtml` (empty) and `source`.
- Not published any more, compared with the same shares' earlier transcripts: thinking summaries, search queries, per-message times and the model slug.
  `originalCreatedAt` is assumed to be when the conversation started; it matched the first message's time in the earlier transcript of `6ae218de-...`, to the minute.
- `content` is a markdown copy of the answer that ChatGPT made from its genui program; it equals `source.dil.fallbackMarkdown` on every answer seen, except where it embeds a widget (next bullet).
  Until 2026-11-25 this line said "on every answer seen" without the exception.
- A writing block (the copyable card for a drafted prompt) sits in `content` as U+E212, a JSON object, U+E213: `{"fallbackMarkdown": ..., "sharedWritingBlock": {"kind": "writing", "content", "index", "variant", "id"}, "reference": {"type": "client_defined_widget"}, "referenceKey", "showLoginRequiredCard"}` (seen 2026-11-25, shares `6b06abbe-...` and `6abe7525-...`).
  The object's own `fallbackMarkdown` was empty on one and filled on the other; `dil.fallbackMarkdown` writes the block as `:::writing{variant=".." id=".."}`, the text, `:::`, and replacing the span with that form rebuilds `dil.fallbackMarkdown` exactly on both.
  Before 2026-11-25 the converter wrote the JSON object into the transcript as it was; `decode_widgets` in `source_chatgpt.py` now writes the directive, and the run notes any answer whose decoded `content` still differs from `dil.fallbackMarkdown`.
  The matching `source.references` entry is `client_defined_widget` with `data.category` `writing_block` (and a `writing` entry on `6abe7525-...`).
- The program of an answer that holds a widget does not `return __dil.jsx(...)`: it returns a ternary on a constant, `__dilConstants["1"]==null ? <Fragment: __chatgptClientDefinedWidget, the rest> : __dilConstants["1"].type==="math" ? <math> : __dilConstants["1"].type==="text" ? <text> : <the rest>` (seen 2026-11-25, `6b06abbe-...`, where constant 1 is `null`).
  Until 2026-11-25 the parser reported such a program as "not parsed"; `chatgpt_dil.branch` now follows the branch the published constants select, and still reports "not parsed" for a condition it does not know.
  It has every inline component stripped: a `Link` leaves nothing (a card's line of two links separated by " · " became the bare " · "), a `Cite`, `MemoryCite` or `AsyncImage` vanishes.
  It also leaves out content drawn with `.map` over inline data (a scored bar chart, a grid of cards), and it backslash-escapes punctuation (`\!`, `\:`, `\.`, `1\.`).
- `source.dil` is the program: `renderer` `dil-v2`, `code` (compiled JSX: `__dil.jsx(tag, props, ...children)`, text as `__dilConstants["<n>"]`, wrapped in `__dilSafe(()=>(...),null)`), `constants`, `appData.opGenui.componentResults` (each component's resolved state, keyed by the `__resolutionId` in its props), `requiredComponents`, `clientDefinedWidgets`, `fallbackMarkdown`, `viewState`.
  Components seen: `Link` (state `url`, `title`), `Cite` (state `items`, each with `url`, `title`, `ref_id`, `thumbnail_url`), `MemoryCite` (empty state), `AsyncImage` (props `query`; state `images`, the first a web page, with images.openai.com copies).
  Lowercase tags are layout (`text`, `bold`, `code`, `title`, `box`, `row`, `col`, `grid`, `grid-item`, `list`, `list-item`, `table`, `icon`, `badge`, `divider`, `pressable`, `math`, `blockquote`, `__chatgptClientDefinedWidget`).
- `chatgpt_dil.py` keeps `content` as the body and splices the components back in, placing each by the program text around it, found in the markdown in document order.
  Text or `.map` data the program shows but the markdown lacks is written in place under a `*[shown on the page, not in ChatGPT's markdown copy:]*` line, the data as a fenced block of the program's own array.
  On the three shares it placed every component the code holds (counted by grep of the code: 21 links, 22 citations, 1 memory citation, 2 images on `6af54e47-...`), and on the two earlier shares the set of link URLs equals the one their old-format transcripts got from the old offsets.
- Two `.map` charts in one answer (seen 2026-11-25, share `6b06e498-...`): a bar chart whose `[{n:"B300",v:288},...]` data duplicates a markdown table, and a scored bar chart whose data is not in the markdown.
  The second was written as a data block, correctly; the first was judged redundant (every 3-letter word of its array is in the markdown), also correctly, but its template label "GB" was still written as a page-only text block of its own.
  Cause: `splice` suppresses a data subtree's unmatched labels only when its data block was shown; a short label in a redundant subtree fails the separator guard (under 4 characters with prose before its match) and lands in the page-only run.
- On the same share a download `Link` that the program places after a paragraph went into the next heading, as `## [huggingface.co](...) 4\. How close...`: a pending component is inserted where the next placed text starts, after the heading's `## ` markup (the code steps back over `*_\`~` only).
- `source.references` types seen: `client_defined_widget` (a code block, already in `content`), `hidden` (a list of `safe_urls`), `followup_a` (the suggested follow-ups, whose text is in `content`), `sources_footnote` (with empty `sources` on both shares that had one).
- A user message can carry `renderFormat: "markdown"` (seen 2026-11-12, share `6af55c80-...`, on a long message with pasted headings); the other user messages had no such field.
- Suggested follow-ups are kept on the last answer only: once the conversation continues, the earlier answer's `content` loses its closing follow-up lines and its `followup_a` references (seen 2026-11-12: share `6af54e47-...` re-shared as `6af55c80-...` after one more turn; the earlier answer's text was otherwise identical).
  A transcript made from the later share is therefore missing those lines; the earlier share's transcript still has them.
- Two user messages can follow each other with no answer between them (seen on `6af54e47-...`); the page shows the same, and the transcript now says `*[no reply to this message in the share]*`.

### Payload (until November 2026)

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
- A "writing block" (the copyable card ChatGPT shows for a drafted prompt or text) is plain text in the assistant message's `content.parts`: a line `:::writing{variant="standard" id="<digits>"}`, the drafted text, and a closing `:::` line (seen 2026-10-01, share `6abe7525-...`, model `gpt-6.1-sol-wm`).
  The converter writes it out verbatim, directive lines included; a markdown viewer shows those lines as text and renders the drafted text as ordinary markdown.
- A user message's text can already carry ChatGPT's own autolinking, including links it mangled when a URL was followed by `).` (seen 2026-10-01, share `6abe7525-...`: `[https://.../2609.17488).](https://.../2609.17488\).)` sits in `content.parts` as stored).
  That is the source, not a converter bug; the transcript keeps it verbatim.
- A `thoughts` summary can contain invisible Unicode isolates, U+2068 and U+2069, around tool names and verbs (seen 2026-10-01, share `6abe7579-...`, model `gpt-6-astra-wm`, on a "Searched the web and used GitHub" summary).
  They are in the payload as stored, and the transcript keeps them; they do not show when rendered but can break a plain-text grep for the words they wrap.
- A long answer can be published as one merged message plus its fragments (seen 2026-10-15, model `gpt-6-thinking`).
  The merged message has `is_merged_message` and `source_message_ids`; each fragment has `is_message_fragment`, `merged_message_id` and `is_visually_hidden_from_conversation`, so the converter skips the fragments and writes the merged message, which holds the whole text.
  The fragments carried `sources_footnote` references with no sources in them, and the merged message carried none, so nothing was lost by skipping them.
- The same answer was written in ChatGPT's "genui" markup: layout tags such as `<text color="secondary" size="xs">`, `<box gap={3}>` and `<row align=start gap={3}>` inline in the markdown (seen 2026-10-15).
  The converter keeps them verbatim; a markdown viewer that drops unknown tags still shows the text inside them.
- A `<badge color="success">` layout tag (a coloured label above a heading) also appears in that markup (seen 2026-10-28, share `6ae218de-...`, model `gpt-6-thinking`); the converter kept it verbatim like the other layout tags, with no note raised.

### Citations

- Citations are private-use code points U+E200..U+E206 around an opaque id, inside the message text (by 2026-09-18).
  On 2026-10-01 (share `6abe7525-...`, model `gpt-6.1-sol-wm`) the marker was `U+E200 genui U+E202 {"citation":{"ref":"turn0view2"}} U+E201`, a `genui` payload rather than a bare id; it still had a matching `content_references` span, and the converter rendered it as a link with no change needed.
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
- A genui message writes its citations as inline tags, `<Cite ref="turn<n>view<k>"/>` or `<Cite refs={["...","..."]}/>`, and `<MemoryCite />` where it leans on ChatGPT's memory (seen 2026-10-15, model `gpt-6-thinking`, 9 `cite` and 1 `memory_cite`).
  Their sources are not in `content_references` (which held only `followup_a` entries there) but in `metadata.genui_components`: one entry per tag with `type`, `start_index`, `end_index` (the tag's exact span), `safe_urls`, `entities` (the turn refs) and `tree_range`.
  `safe_urls` mixes the cited pages with images.openai.com thumbnails; titles for the pages are in the message's `search_result_groups[].entries[]` by `url`.
  Until 2026-10-15 the converter left the tags as raw text and the answer lost all its source links while the verbatim check reported "verified"; now `genui_refs` turns each component into a span spliced with the other references, `cite` as a link list without the thumbnails and `memory_cite` as `*[memory citation]*`, and a component of any other type is reported in the run's notes.
- A genui message can also carry `<Entity category="company" value="PitchBook"/>` tags, which the page shows as the bare name (seen 2026-10-20, share `6ad78688-...`, model `gpt-6-thinking`, five of them in a table column).
  Each has a `genui_components` entry of `type` `entity` with the tag's span and `entities: [{"entity_type": "entity"}]`, and nothing else: no value, no link, no id, so the name has to be read from the tag's `value` attribute.
  Until 2026-10-20 the tags were left as written (and reported as an unknown type); now `genui_refs` renders each as its value, and the run's notes count them.
  Only `category="company"` has been seen; other categories are assumed to carry the same `value` attribute.
- A genui message can carry `<Link url="https://..." title="EDGAR APIs"/>` tags, a link button the page shows by its title, inline in prose or inside a layout `<text>` (seen 2026-10-21, share `6ad91f5b-...`, model `gpt-6-thinking`, four of them).
  Each has a `genui_components` entry of `type` `link` with the tag's span and one `safe_urls` entry: the tag's url with `?utm_source=chatgpt.com` added, and no title.
  Until 2026-10-21 the tags were left as written and reported as an unknown type (the url and title survived in the raw tag); now `genui_refs` renders each as `[title](url)` from the tag's own attributes.
- The same answer had `<AsyncImage query="Tesla vehicle factory ..." aspectRatio="5:4" maxWidth="128px"/>` tags, a picture the page finds by the search query, beside a card of text (seen 2026-10-21, share `6ad91f5b-...`, two of them).
  Each has a `genui_components` entry of `type` `async_image` with the tag's span, `genui_attributes` (`aspectRatio`, `maxWidth`) and `safe_urls`: first a web page, then several images.openai.com copies.
  The first url is assumed, not confirmed against the page, to be where the picture came from; it matched the subject both times.
  Now `genui_refs` renders each as `*[image: <query> from [<host>](<first url>)]*`, leaving out the thumbnails.
- From the code's comments only, committed 2026-11-12 from an uncommitted working tree, its share id not recorded (2026-10-29): a `genui_components` entry of `type` `code_block` covers a `<CodeBlock language="..." editable>...</CodeBlock>` tag, written as fenced code; and 2 of 10 `<Cite/>` tags in a merged message had no `genui_components` entry, their links recovered from `search_result_groups` by `ref_id`.
- The same answer drew a diagram as genui layout markup with Svelte-style loops inside an `<svg>`: `<box border radius="xl" padding={3} gap={2}>`, `{#each [55,170,285] as x}` ... `{/each}`, attributes such as `d={`M170 45 L${x} 96`}`, and a `<caption>` (seen 2026-10-20, share `6ad78688-...`).
  It is plain text in `content.parts` with no `genui_components` entry, and the converter keeps it verbatim; a markdown viewer shows it as raw markup, so the diagram is readable only in the source.
- A fenced code block can come with a `content_references` entry of `type` `client_defined_widget`, `category` `code_block`, whose `data` repeats the block's `content` and `language` and whose `matched_text` is the whole fenced block (seen 2026-10-20, share `6ad78688-...`).
  Its span (`start_idx`, `end_idx`) did not cover the block but a table 1,500 characters earlier, so the converter's text search found the block and counted it as a citation "placed by text search"; the block was kept either way, because a link-less span of real text is never removed.
  Now a link-less `client_defined_widget` is skipped before any placement and counted in the run's notes as a rendered code block left as written.

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
