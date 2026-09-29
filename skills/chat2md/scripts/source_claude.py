"""claude.ai share links (claude.ai/share/<id>): the conversation from claude.ai's snapshot API.

The share page is an empty app shell: its own script loads the conversation from
/api/chat_snapshots/<id>, and that endpoint sits behind a Cloudflare bot check that scores the whole
request. On 2026-09-23 curl with a browser user agent got the challenge page (HTTP 403 with
`cf-mitigated: challenge`), urllib with the same user agent got the JSON, and a headless browser got
the challenge, since its user agent says HeadlessChrome. An ordinary visible browser passes. So the
fetch tries a plain request first, and otherwise opens a short-lived headed playwright-cli browser,
loads the share page and keeps the snapshot response the page itself requests. The JSON a browser shows for the API URL, saved to a
file, is accepted as input too.

Checked against a real share (2026-09-23): text blocks, citations, web_search_fast calls and their
results, and user attachments that the share hides. Every other block type goes through a generic
path that writes out all of its content, and the report names it, because its shape is unverified.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

from chat2md_common import UA, details, fenced, log

NAME = "Claude"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
SHARE_ID = re.compile(rf"claude\.ai/(?:share|api/chat_snapshots)/({UUID})")
SHARE_PAGE = "https://claude.ai/share/{}"
SNAPSHOT_API = "https://claude.ai/api/chat_snapshots/{}?rendering_mode=messages&render_all_tools=true"

# Runs inside the browser. It listens before navigating, because a response's body can no longer be
# read once the page has moved on, and it keeps waiting through 403s: those are Cloudflare's
# challenge, after which the page reloads and asks again.
BROWSER_FETCH = """async page => {
  let got = null;
  page.on("response", async r => {
    if (got || !r.url().includes("/api/chat_snapshots/%(id)s")) return;
    if (r.status() === 200) {
      try { got = {status: 200, body: await r.text()}; } catch (e) {}
    } else if (r.status() !== 403) {
      got = {status: r.status(), body: ""};
    }
  });
  await page.goto("%(page)s");
  const deadline = Date.now() + %(timeout_ms)d;
  while (!got && Date.now() < deadline) await page.waitForTimeout(500);
  return got || {status: 0, body: "", page: page.url(), title: await page.title()};
}"""


def handles_url(url: str) -> bool:
    return bool(re.match(r"https?://(?:www\.)?claude\.ai/", url))


def handles_file(text: str) -> bool:
    return text.lstrip()[:1] == "{" and '"chat_messages"' in text


# --------------------------------------------------------------------------- fetching

def share_id(url: str) -> str:
    m = SHARE_ID.search(url)
    if m:
        return m.group(1)
    if "/chat/" in url:
        raise SystemExit("That is a private claude.ai/chat/... URL, which only loads for its owner. "
                         "Ask for a share link (Share -> Create public link).")
    raise SystemExit(f"Not a claude.ai share link: {url}")


def fetch(url: str, browser_session: str, timeout: float) -> str:
    sid = share_id(url)
    req = urllib.request.Request(SNAPSHOT_API.format(sid), headers={
        "User-Agent": UA, "Accept": "application/json", "Referer": SHARE_PAGE.format(sid)})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            log("snapshot: fetched directly")
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        if e.code in (404, 410):
            raise SystemExit(f"HTTP {e.code}: no such share - it may have been unshared or deleted.")
        if e.code != 403:
            raise SystemExit(f"HTTP {e.code} fetching the snapshot of {url}")
    log("snapshot: the API answered 403 (Cloudflare bot check); opening a browser window to fetch it")
    return fetch_with_browser(sid, browser_session, timeout)


def fetch_with_browser(sid: str, session: str, timeout: float) -> str:
    """Load the share page in a visible playwright-cli browser and keep the snapshot it requests."""
    if not shutil.which("playwright-cli"):
        raise SystemExit(
            "playwright-cli is not installed, and the snapshot API only answers a real browser. "
            f"Open {SNAPSHOT_API.format(sid)} in a browser, save the JSON it shows, and pass that "
            "file instead of the link.")
    script = BROWSER_FETCH % {"id": sid, "page": SHARE_PAGE.format(sid),
                              "timeout_ms": int(timeout * 1000)}
    # playwright-cli writes snapshots and logs into its working directory, so give it a throwaway one.
    with tempfile.TemporaryDirectory(prefix="chat2md-") as work:
        def cli(*args, limit):
            return subprocess.run(["playwright-cli", f"-s={session}", *args], cwd=work,
                                  capture_output=True, text=True, timeout=limit)
        opened = cli("open", "--headed", limit=120)
        if opened.returncode != 0:
            raise SystemExit(f"could not open browser session {session}:\n{opened.stdout}{opened.stderr}")
        try:
            done = cli("--raw", "run-code", script, limit=timeout + 120)
        finally:
            cli("close", limit=60)
    lines = [ln for ln in done.stdout.splitlines() if ln.startswith("{")]
    try:
        got = json.loads(lines[-1])
    except (IndexError, json.JSONDecodeError):
        raise SystemExit(f"the browser fetch returned no result:\n{done.stdout}{done.stderr}")
    if got.get("status") == 200:
        log("snapshot: fetched through the browser")
        return got["body"]
    if got.get("status") in (404, 410):
        raise SystemExit(f"HTTP {got['status']}: no such share - it may have been unshared or deleted.")
    if got.get("status"):
        raise SystemExit(f"the snapshot API answered HTTP {got['status']} in the browser too")
    raise SystemExit(f"no snapshot within {timeout:.0f}s; the browser was left at {got.get('page')} "
                     f"({got.get('title')!r}). If that is a Cloudflare check, run again and click it "
                     "in the window, or save the API response by hand (see SKILL.md).")


# ------------------------------------------------------------------------ message model

def when(stamp) -> dt.datetime | None:
    if not stamp:
        return None
    return dt.datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(dt.timezone.utc)


def _label(text: str) -> str:
    return re.sub(r"\s+", " ", str(text)).replace("]", ")").strip()


def _citation_links(cit: dict) -> list[tuple[str, str]]:
    """(label, url) pairs for one citation: its sources, else the citation's own url."""
    links = []
    for src in cit.get("sources") or []:
        if src.get("url"):
            links.append((src.get("source") or src.get("title") or src["url"], src["url"]))
    if not links and cit.get("url"):
        meta = cit.get("metadata") or {}
        links.append((meta.get("site_name") or meta.get("site_domain") or cit.get("title") or cit["url"],
                      cit["url"]))
    return [(_label(lab), url) for lab, url in links]


def _anchor(text: str, end: int, paragraph_end: bool) -> tuple[int, bool]:
    """Where a citation's links go, and whether they need a paragraph of their own.

    claude.ai shows a citation chip at the end of the cited span, or at the end of its paragraph
    when the block says citations_grouping_mode == "paragraph_end". Links appended to a table row,
    a code fence or an indented line would break that construct, so those get their own paragraph.
    """
    end = max(0, min(end, len(text)))
    if paragraph_end:
        brk = text.find("\n\n", end)
        end = len(text) if brk < 0 else brk
        while end > 0 and text[end - 1] in " \t\n":
            end -= 1
    line = text[text.rfind("\n", 0, end) + 1:end]
    return end, line.lstrip().startswith(("|", "```", "~~~")) or line.startswith("    ")


def merge_text(parts: list[dict], counters: dict) -> tuple[str, list[str]]:
    """Consecutive text blocks joined as claude.ai displays them, with citations as links.

    Returns the rendered text and the original text cut at every insertion point: those pieces are
    what the verbatim check looks for in the file, so the check is against Claude's own words and
    not against text this function produced.
    """
    raw, inserts = "", {}
    for part in parts:
        base = len(raw)
        raw += part.get("text") or ""
        paragraph_end = part.get("citations_grouping_mode") == "paragraph_end"
        for cit in part.get("citations") or []:
            links = _citation_links(cit)
            if not links:
                counters["citations_without_links"] = counters.get("citations_without_links", 0) + 1
                continue
            end = cit.get("end_index")
            end = base + end if isinstance(end, int) else len(raw)
            at, own_paragraph = _anchor(raw, end, paragraph_end)
            slot = inserts.setdefault(at, {"links": [], "own": False})
            slot["own"] = slot["own"] or own_paragraph
            for link in links:
                if link not in slot["links"]:
                    slot["links"].append(link)
            counters["citations_linked"] = counters.get("citations_linked", 0) + len(links)

    out, pieces, last = [], [], 0
    for at in sorted(inserts):
        slot = inserts[at]
        links = ", ".join(f"[{lab}]({url})" for lab, url in slot["links"])
        out += [raw[last:at], f"\n\nSources: {links}" if slot["own"] else f" ({links})"]
        pieces.append(raw[last:at])
        last = at
    out.append(raw[last:])
    pieces.append(raw[last:])
    return "".join(out).strip(), [p.strip() for p in pieces if p.strip()]


def _generic_body(value) -> str:
    return fenced(value if isinstance(value, str) else json.dumps(value, indent=1, ensure_ascii=False),
                  "" if isinstance(value, str) else "json")


def tool_use_act(block: dict, counters: dict) -> dict:
    name, inp = block.get("name") or "tool", block.get("input") or {}
    if name.startswith("web_search") and isinstance(inp, dict) and inp.get("query"):
        return {"kind": "act", "text": f"web search: {inp['query']}"}
    counters.setdefault("generic", []).append(f"tool_use:{name}")
    if name == "web_fetch" and isinstance(inp, dict) and set(inp) == {"url"}:
        return {"kind": "act", "text": f"fetched: {inp['url']}"}
    # Unverified tool: short scalar inputs inline, anything long or multi-line written out in full.
    inline, bodies = [], []
    for key, val in (inp.items() if isinstance(inp, dict) else [("input", inp)]):
        if isinstance(val, str) and ("\n" in val or len(val) > 200):
            bodies.append(f"{key}:\n\n{fenced(val)}")
        elif isinstance(val, (str, int, float, bool)) or val is None:
            inline.append(f"{key}={val}".replace("`", "'"))
        else:
            bodies.append(f"{key}:\n\n{_generic_body(val)}")
    act = {"kind": "act", "text": f"tool {name}" + (": " + ", ".join(inline) if inline else "")}
    if bodies:
        act["body"] = details(f"{name} input", "\n\n".join(bodies))
    return act


def tool_result_act(block: dict, counters: dict) -> dict | None:
    name, items = block.get("name") or "tool", block.get("content")
    error = " (error)" if block.get("is_error") else ""
    if name.startswith("web_search") and isinstance(items, list) and not error and \
            all(isinstance(i, dict) and i.get("url") for i in items):
        links = "; ".join(f"[{_label(i.get('title') or i['url'])}]({i['url']})" for i in items)
        return {"kind": "act", "text": f"{len(items)} results: {links}" if items else "no results"}
    counters.setdefault("generic", []).append(f"tool_result:{name}")
    if not items and not error:
        return {"kind": "act", "text": f"{name} returned nothing"}
    parts = []
    for item in items if isinstance(items, list) else [items]:
        if isinstance(item, dict) and item.get("type") == "text" and set(item) <= {"type", "text", "uuid"}:
            parts.append(fenced(item.get("text") or ""))
        else:
            parts.append(_generic_body(item))
    return {"kind": "act", "text": f"{name} result{error}",
            "body": details(f"{name} result{error}", "\n\n".join(parts))}


def build_blocks(snap: dict, counters: dict) -> list[dict]:
    blocks: list[dict] = []
    for m in sorted(snap.get("chat_messages") or [], key=lambda m: m.get("index", 0)):
        sender, stamp, content = m.get("sender"), when(m.get("created_at")), m.get("content") or []
        if not content and m.get("text"):
            content = [{"type": "text", "text": m["text"]}]     # older snapshots: text on the message

        if m.get("compaction_summary"):
            blocks.append({"kind": "act", "text": "earlier messages compacted into a summary",
                           "body": details("compaction summary", _generic_body(m["compaction_summary"]))})
            counters.setdefault("generic", []).append("compaction_summary")

        if sender == "human":
            texts = []
            for c in content:
                if c.get("type") == "text":
                    texts.append(c.get("text") or "")
                else:
                    counters.setdefault("generic", []).append(f"human:{c.get('type')}")
                    texts.append(f"*[{c.get('type')} block]*\n\n{_generic_body(c)}")
            attachments = [{"name": a.get("file_name") or "attachment",
                            "content": a.get("extracted_content")}
                           for a in m.get("attachments") or []]
            attachments += [{"name": f.get("file_name") or f.get("file_kind") or "file"}
                            for f in m.get("files") or []]
            hidden = (m.get("file_count") or 0) - len(attachments)
            if hidden > 0:
                attachments.append({"name": f"{hidden} file{'s' if hidden > 1 else ''}, "
                                            "hidden when shared"})
                counters["hidden_files"] = counters.get("hidden_files", 0) + hidden
            blocks.append({"kind": "user", "text": "\n\n".join(texts).strip(), "time": stamp,
                           "attachments": attachments})
            continue

        pending_text: list[dict] = []

        def flush_text():
            if pending_text:
                text, pieces = merge_text(pending_text, counters)
                if text:
                    blocks.append({"kind": "assistant", "text": text, "verbatim": pieces,
                                   "time": stamp})
                pending_text.clear()

        for c in content:
            kind = c.get("type")
            if kind == "text":
                pending_text.append(c)
                continue
            flush_text()
            if kind == "thinking":
                summaries = [s.get("summary") for s in c.get("summaries") or [] if s.get("summary")]
                act = {"kind": "act", "text": "thinking" + (": " + "; ".join(summaries) if summaries else "")}
                if (c.get("thinking") or "").strip():
                    act["body"] = details("thinking", c["thinking"].strip())
                blocks.append(act)
                counters.setdefault("generic", []).append("thinking")
            elif kind == "tool_use":
                blocks.append(tool_use_act(c, counters))
            elif kind == "tool_result":
                act = tool_result_act(c, counters)
                if act:
                    blocks.append(act)
            else:
                counters.setdefault("generic", []).append(str(kind))
                blocks.append({"kind": "act", "text": f"{kind} block",
                               "body": details(f"{kind} block", _generic_body(c))})
        flush_text()
        if m.get("truncated"):
            blocks.append({"kind": "act", "text": "this reply is marked truncated in the share"})
    return blocks


# -------------------------------------------------------------------------------- entry

def load(source: str, is_url: bool, raw_out: str | None, browser_session: str = "",
         timeout: float = 180) -> tuple[dict, list[dict], object, list[str]]:
    """(header info, blocks, snapshot, notes for the report) for a share link or saved snapshot."""
    if is_url:
        session = browser_session or \
            f"chat2md-{(os.environ.get('CLAUDE_CODE_SESSION_ID') or str(os.getpid()))[:8]}"
        text = fetch(source, session, timeout)
    else:
        text = open(source, encoding="utf-8").read()
    if raw_out:
        open(raw_out, "w", encoding="utf-8").write(text)
    snap = json.loads(text)
    if "chat_messages" not in snap:
        raise SystemExit("the snapshot has no chat_messages - keep it with --save-raw and inspect it")
    counters: dict = {}
    blocks = build_blocks(snap, counters)
    info = {"title": snap.get("snapshot_name") or snap.get("name"), "model": snap.get("model"),
            "url": SHARE_PAGE.format(snap["uuid"]) if snap.get("uuid") else (source if is_url else "")}
    notes = []
    if counters.get("citations_linked"):
        notes.append(f"{counters['citations_linked']} citation link(s) kept")
    if counters.get("citations_without_links"):
        notes.append(f"{counters['citations_without_links']} citation(s) had no url and were left out")
    if counters.get("hidden_files"):
        notes.append(f"{counters['hidden_files']} user attachment(s) are hidden by the share itself; "
                     "the file notes them, but their content is not available")
    if counters.get("generic"):
        seen = sorted(set(counters["generic"]))
        notes.append("rendered by the generic path, shape not yet checked against a real share - "
                     "read these parts of the file: " + ", ".join(seen))
    return info, blocks, snap, notes
