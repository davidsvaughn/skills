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
