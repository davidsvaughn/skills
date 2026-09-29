#!/usr/bin/env python3
"""Turn a shared ChatGPT or Claude conversation into a complete markdown transcript.

    chat2md.py https://chatgpt.com/share/<id> --out chat.md
    chat2md.py https://claude.ai/share/<id> --out chat.md
    chat2md.py saved-share-page.html --out chat.md    # a ChatGPT share page saved by a browser
    chat2md.py snapshot.json --out chat.md            # a claude.ai snapshot saved by a browser

Each site hides its conversation differently, so each has a module that gets it out and turns it
into the same list of blocks: source_chatgpt.py decodes it from the share page, source_claude.py
takes it from claude.ai's snapshot API, through a browser when Cloudflare insists. This file renders
those blocks and checks the result. Everything is stdlib only; the claude.ai browser fallback uses
the playwright-cli installed on this machine.

The transcript is verbatim by design: every user and assistant message is written out in full,
never summarised or trimmed. The script re-reads its own output and checks each message survived,
and exits non-zero if one did not, so a silent loss cannot pass for a clean run.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys

sys.dont_write_bytecode = True          # keep __pycache__ out of the skill folder
import source_chatgpt  # noqa: E402
import source_claude  # noqa: E402
from chat2md_common import fenced, log  # noqa: E402

SOURCES = [source_chatgpt, source_claude]


def pick_source(source: str):
    """The module for a link or saved file, or an error that says what would work instead."""
    if re.match(r"https?://", source):
        for mod in SOURCES:
            if mod.handles_url(source):
                return mod, True
        raise SystemExit("Unsupported link. This handles chatgpt.com/share/... and claude.ai/share/... "
                         "links; for another assistant, convert by hand (see SKILL.md).")
    text = open(source, encoding="utf-8", errors="replace").read()
    if re.search(r'<meta[^>]+og:site_name"[^>]+content="Claude"', text):
        raise SystemExit("That is a saved claude.ai page, which is only an app shell: the conversation "
                         "is not in it. Save the snapshot JSON instead (see SKILL.md), or pass the link.")
    for mod in SOURCES:
        if mod.handles_file(text):
            return mod, False
    raise SystemExit("Not a file this understands: expected a saved ChatGPT share page (.html) or a "
                     "claude.ai snapshot (.json).")


# ---------------------------------------------------------------------------- rendering

def utc(stamp: dt.datetime) -> str:
    return stamp.strftime("%Y-%m-%d %H:%M UTC")


def render(platform: str, info: dict, blocks: list[dict], style: str, header: bool,
           activity: bool) -> str:
    out: list[str] = []
    stamps = [b["time"] for b in blocks if b.get("time")]
    if header:
        title = info.get("title") or f"Shared {platform} conversation"
        span = ""
        if stamps:
            first, last = utc(stamps[0]), utc(stamps[-1])
            span = f", {first}" + (f" to {last}" if last != first else "")
        model = info.get("model")
        out.append(f'Shared {platform} conversation "{title}"{span}' +
                   (f", model `{model}`" if model else "") + ".")
        if info.get("url"):
            out.append(f"Source: {info['url']}")
        out.append(f"Transcribed {dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')}: "
                   "every user and assistant message verbatim" +
                   (", with the tool steps shown between them in italics." if activity else "."))
        out.append("")

    pending: list[dict] = []

    def flush():
        if pending and activity:
            for act in pending:
                out.append(f"*[{act['text']}]*")
                if act.get("body"):
                    out.extend(["", act["body"], ""])
            if out[-1] != "":
                out.append("")
        pending.clear()

    def attachments(b: dict) -> list[str]:
        lines = []
        names = [a["name"] for a in b.get("attachments") or [] if not a.get("content")]
        if names:
            lines += ["*[attached: " + ", ".join(names) + "]*", ""]
        for a in b.get("attachments") or []:
            if a.get("content"):
                lines += [f"*[attached: {a['name']}]*", "", fenced(a["content"]), ""]
        return lines

    first_turn = True
    for b in blocks:
        if b["kind"] == "act":
            pending.append(b)
            continue
        flush()
        if b["kind"] == "user":
            if not first_turn:
                out += ["---", ""]
            first_turn = False
            if style == "qa":
                out += ["Q: " + b["text"], ""] + attachments(b) + ["---", "", "A:", ""]
            else:
                out += ["## User", "", b["text"], ""] + attachments(b) + ["## Assistant", ""]
        else:
            out += [b["text"], ""]
    flush()
    return "\n".join(out).rstrip() + "\n"


def verify(markdown: str, blocks: list[dict]) -> list[dict]:
    """Every message must appear verbatim in the file; anything missing is a bug, not a trim.

    A block's `verbatim` pieces are the site's original text, cut wherever the converter inserted
    something (a citation link); they are checked as well as the rendered text, so the check is
    against what the model wrote rather than only against what this script produced.
    """
    missing = []
    for b in blocks:
        if b["kind"] not in ("user", "assistant"):
            continue
        wanted = [b["text"], *b.get("verbatim", []),
                  *[a["content"].rstrip("\n") for a in b.get("attachments") or [] if a.get("content")]]
        if any(w not in markdown for w in wanted):
            missing.append(b)
    return missing


# -------------------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="a chatgpt.com/share/... or claude.ai/share/... link, or a saved "
                                   "ChatGPT share page (.html) or claude.ai snapshot (.json)")
    ap.add_argument("--out", help="write the transcript here (default: stdout)")
    ap.add_argument("--stdout", action="store_true", help="also print the transcript when --out is used")
    ap.add_argument("--json", dest="json_out", help="also dump the decoded conversation object")
    ap.add_argument("--save-raw", help="keep what was fetched (the ChatGPT page, the claude.ai JSON) "
                                       "here, which is what you need if a format ever changes")
    ap.add_argument("--url", help="the share link to name in the header, when converting a saved file "
                                  "that does not carry it")
    ap.add_argument("--style", choices=["qa", "sections"], default="qa",
                    help="qa: 'Q:' / 'A:' separated by --- (default); sections: '## User' / '## Assistant'")
    ap.add_argument("--no-activity", action="store_true", help="omit the tool, search and thinking notes")
    ap.add_argument("--no-header", action="store_true", help="omit the source and title lines")
    ap.add_argument("--browser-session", default="",
                    help="claude.ai: playwright-cli session name for the browser fallback "
                         "(default chat2md-<first 8 characters of the Claude Code session id>)")
    ap.add_argument("--browser-timeout", type=float, default=180,
                    help="claude.ai: seconds to wait for the snapshot in the browser (default 180)")
    args = ap.parse_args()

    mod, is_url = pick_source(args.source)
    if mod is source_claude:
        info, blocks, raw, notes = mod.load(args.source, is_url, args.save_raw,
                                            args.browser_session, args.browser_timeout)
    else:
        info, blocks, raw, notes = mod.load(args.source, is_url, args.save_raw)
    if args.url:
        info["url"] = args.url
    if args.json_out:
        json.dump(raw, open(args.json_out, "w", encoding="utf-8"), indent=1, default=str,
                  ensure_ascii=False)

    markdown = render(mod.NAME, info, blocks, args.style, not args.no_header, not args.no_activity)
    users = [b for b in blocks if b["kind"] == "user"]
    assistants = [b for b in blocks if b["kind"] == "assistant"]
    acts = [b for b in blocks if b["kind"] == "act"]
    if not users and not assistants:
        raise SystemExit("the conversation decoded but held no messages - check the --json output")

    missing = verify(markdown, blocks)
    if args.out:
        open(args.out, "w", encoding="utf-8").write(markdown)
    if args.stdout or not args.out:
        sys.stdout.write(markdown)

    log(f"title: {info.get('title')!r}")
    log(f"messages: {len(users)} user, {len(assistants)} assistant, {len(acts)} tool/search steps")
    log(f"message characters: {sum(len(b['text']) for b in users + assistants):,}"
        f" -> {args.out or 'stdout'} ({len(markdown):,} characters)")
    for note in notes:
        log(f"note: {note}")
    if missing:
        log(f"FAILED: {len(missing)} message(s) did not survive into the output")
        return 1
    log("verified: every message appears verbatim in the output")
    return 0


if __name__ == "__main__":
    sys.exit(main())
