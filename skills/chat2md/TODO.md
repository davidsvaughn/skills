# TODO

Code work still owed; what is known or unknown about the sites is in `NOTES.md`.

- claude.ai: give proper handling to the block types that so far only a synthetic snapshot has been through (thinking, artifacts, `create_file`, code execution, `web_fetch`, MCP tools; see the open questions in `NOTES.md`).
  They go through the generic renderer, which keeps everything but may not read well.
  When a real share with them comes by, keep its JSON with `--save-raw`, record the shapes in `NOTES.md`, then handle them in `source_claude.py`.
- ChatGPT: plugin calls (`recipient` `api_tool.call_tool`, and the `tool` reply after it) are skipped without a note, so the transcript does not show that a tool was used.
  Their content is redacted in the share, so nothing else is lost; a note line such as `*[tool call: api_tool.call_tool, redacted in the share]*` would close the gap.
  It changes the output of existing transcripts (one added line), so check with the maintainer first.
- Both sites: the verbatim check cannot see text deleted inside a spliced span, because the `verbatim` pieces are cut at every span the converter touched, deleted or not (found 2026-09-24 when `followup_a` references deleted three bullet lines and the run still reported "verified").
  Cut the pieces only where something was inserted, and compare the deleted spans against what was removed (whitespace or citation glyphs only), so a deletion of real text fails the check.
  Re-run the ChatGPT shares on record afterwards to confirm nothing else was lost.
  A second miss, 2026-09-26: a misplaced sources footnote replaced the space after a message's first word with the source list, and the run still reported "verified" (details in `NOTES.md`, ChatGPT citations).
  The raw pages of the five ChatGPT shares converted so far are worth keeping as a regression set when this is done; today they must be re-fetched from the links in their transcripts' headers.
  Since 2026-11-12 a re-fetch gives the new "octane" page, so the old-format path can no longer be regression-tested from links; keep `--save-raw` pages of new shares instead.
- ChatGPT octane, found 2026-11-25 by re-fetching the 24 ChatGPT shares linked from local transcripts (every one now serves the octane page): the run notes gaps the octane path does not handle yet, unchanged by that day's fix.
  Reference types `grouped_webpages` (on 12 shares), `url`, `file`, `writing`; message fields `maskedUploads` (2 shares) and `hideActions` (2); `Entity` dil components (3 shares, "NOT in the file").
  For each, check whether the transcript actually lacks something the page shows (for `Entity`, whether the bare name is already in the markdown copy) and either handle it or record it in `NOTES.md` as nothing to render.
- ChatGPT octane: the splicer in `chatgpt_dil.py` has been through three real shares only.
  It places a component by the program text before or after it; a constant that also appears earlier in the markdown, or one the markdown rewrites (smart quotes, entities, math), could misplace a component or show text as page-only, and the verbatim check would not notice either.
  A cross-check worth adding: count the components in `dil.code` and fail the run when fewer were placed.
