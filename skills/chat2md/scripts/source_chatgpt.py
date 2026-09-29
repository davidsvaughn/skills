"""ChatGPT share links (chatgpt.com/share/<id>): fetch the page, decode the conversation out of it.

chatgpt.com's JSON endpoints answer 403 to anything that is not a browser, while the share *page*
returns fine and carries the whole conversation in its React Router stream payload. That payload is
a flat pool of values addressed by index, so it has to be decoded before any message text can be
read. A page saved by a browser works the same way as a fetched one.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import urllib.error
import urllib.request

from chat2md_common import UA, log

NAME = "ChatGPT"
# ChatGPT marks citations with private-use code points (U+E200..U+E206) around an opaque id. The
# sources behind those ids live in the message's content_references, so a transcript can keep the
# links by rendering the references and only then clearing whatever markers are left over.
CITE_MARKER = re.compile("[-][^-]*[-]|[-]")


def handles_url(url: str) -> bool:
    return bool(re.match(r"https?://(?:chat\.openai\.com|chatgpt\.com)/", url))


def handles_file(text: str) -> bool:
    return text.lstrip()[:1] == "<"


# --------------------------------------------------------------------------- fetching

def fetch(url: str, timeout: float = 60) -> str:
    if "/share/" not in url:
        log("warning: that does not look like a share link; a chatgpt.com/c/... URL is private "
            "and will not load here")
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        raise SystemExit(
            f"HTTP {e.code} fetching {url}\n{body}\n\n"
            "If this is 403, the page is behind a bot check from here: open the link in a browser, "
            "save the page as HTML, and pass the saved file instead of the link."
        )


def page_url(html: str) -> str:
    """The share link a saved page came from, so a transcript made from a file still names it."""
    m = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+/share/[^"]+)"', html)
    return m.group(1) if m else ""


# --------------------------------------------------------------------- payload extraction

def _js_strings_after(html: str, needle: str) -> list[str]:
    """Every JS string literal that follows an occurrence of `needle`, unescaped."""
    out = []
    for m in re.finditer(re.escape(needle), html):
        i = m.end()
        while i < len(html) and html[i] not in '"\'':
            if html[i] in ");\n":
                break
            i += 1
        if i >= len(html) or html[i] not in '"\'':
            continue
        quote = html[i]
        j = i + 1
        buf = []
        while j < len(html):
            c = html[j]
            if c == "\\":
                buf.append(html[j:j + 2])
                j += 2
                continue
            if c == quote:
                break
            buf.append(c)
            j += 1
        raw = "".join(buf)
        try:
            out.append(json.loads('"' + raw.replace('\\\'', "'") + '"'))
        except json.JSONDecodeError:
            continue
    return out


def decode_turbo_stream(payload: str):
    """Decode react-router's streamed format: a pool where objects address keys/values by index."""
    pool, _ = json.JSONDecoder().raw_decode(payload, 0)
    memo: dict[int, object] = {}

    def res(i):
        if isinstance(i, int) and i < 0:
            return None                      # undefined / null / NaN sentinels
        if i in memo:
            return memo[i]
        v = pool[i]
        if isinstance(v, dict):
            out: dict = {}
            memo[i] = out
            for k, val in v.items():
                key = res(int(k[1:])) if isinstance(k, str) and k.startswith("_") else k
                out[key] = res(val) if isinstance(val, int) else val
            return out
        if isinstance(v, list):
            arr: list = []
            memo[i] = arr
            for e in v:
                arr.append(res(e) if isinstance(e, int) else e)
            return arr
        memo[i] = v
        return v

    return res(0)


def find_conversation(obj) -> dict | None:
    """Depth-first search for the conversation dict, tolerating the payload's cycles."""
    seen: set[int] = set()
    stack = [obj]
    while stack:
        o = stack.pop()
        if id(o) in seen:
            continue
        if isinstance(o, (dict, list)):
            seen.add(id(o))
        if isinstance(o, dict):
            if "linear_conversation" in o or ("mapping" in o and "current_node" in o):
                return o
            stack.extend(o.values())
        elif isinstance(o, list):
            stack.extend(o)
    return None


def extract_conversation(html: str) -> dict:
    """Try the formats ChatGPT has used for share pages, newest first."""
    chunks = _js_strings_after(html, "streamController.enqueue(")
    if chunks:
        try:
            conv = find_conversation(decode_turbo_stream("".join(chunks)))
            if conv:
                log(f"payload: react-router stream ({len(chunks)} chunk(s))")
                return conv
        except (json.JSONDecodeError, IndexError, RecursionError) as e:
            log(f"stream payload did not decode ({e}); trying other formats")
    m = re.search(r'<script[^>]+id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if m:
        conv = find_conversation(json.loads(m.group(1)))
        if conv:
            log("payload: __NEXT_DATA__")
            return conv
    for m in re.finditer(r'<script[^>]*type="application/json"[^>]*>(.*?)</script>', html, re.S):
        try:
            conv = find_conversation(json.loads(m.group(1)))
        except json.JSONDecodeError:
            continue
        if conv:
            log("payload: embedded application/json script")
            return conv
    raise SystemExit(
        "No conversation found in the page. Either the link is not a public share link "
        "(a chatgpt.com/c/... URL is private and only loads for its owner), or ChatGPT changed the "
        "page format - keep the page with --save-raw and look for 'linear_conversation'."
    )


# ------------------------------------------------------------------------ message model

def ordered_nodes(conv: dict) -> list[dict]:
    """The messages in display order: the share's own list, or the mapping walked from the leaf."""
    lin = conv.get("linear_conversation")
    if lin:
        return lin
    mapping, node = conv.get("mapping") or {}, conv.get("current_node")
    chain = []
    while node and node in mapping:
        chain.append(mapping[node])
        node = mapping[node].get("parent")
    return list(reversed(chain))


def _ref_links(ref: dict) -> list[tuple[str, str]]:
    """The (label, url) pairs one citation reference stands for, in order, deduplicated."""
    links: list[tuple[str, str]] = []
    item = ref.get("item")
    if isinstance(item, dict) and item.get("url"):
        links.append((ref.get("title") or item.get("title") or item.get("attribution") or item["url"],
                      item["url"]))
    for it in (ref.get("items") or ref.get("fallback_items") or ref.get("sources") or []):
        if isinstance(it, dict) and it.get("url"):
            links.append((it.get("attribution") or it.get("title") or it["url"], it["url"]))
    seen, out = set(), []
    for label, url in links:
        if url in seen:
            continue
        seen.add(url)
        out.append((re.sub(r"\s+", " ", str(label)).replace("]", ")").strip(), url))
    return out


def apply_citations(text: str, refs: list, counters: dict) -> str:
    """Replace citation markers with the links they stand for, so no source is lost.

    Each reference carries the span it covers, and splicing by span (right to left, so earlier
    offsets stay valid) is the only placement that survives the two things a plain string replace
    gets wrong: the same marker appearing several times, and the end-of-message sources footnote,
    whose 'matched text' is a single space that matches almost anywhere.

    The footnote is the source list ChatGPT shows below the message, so it always goes to the
    closing `Sources:` line. Its `start_idx` is usually past the end of the text, but when the
    message closes with suggested follow-up prompts it points inside the text at a character that
    is not its space (seen 2026-09-26: a newline), and a text search for the space then spliced it
    after the message's first word. A whitespace marker is therefore never searched for by text.
    """
    tail: list[str] = []
    spans = []
    for ref in refs or []:
        marker = ref.get("matched_text") or ""
        start, end = ref.get("start_idx"), ref.get("end_idx")
        links = _ref_links(ref)
        if links:
            counters["citations_linked"] = counters.get("citations_linked", 0) + len(links)
        if ref.get("type") == "sources_footnote" or (isinstance(start, int) and start >= len(text)):
            if links:
                tail.append(", ".join(f"[{lab}]({url})" for lab, url in links))
            continue
        if isinstance(start, int) and isinstance(end, int) and text[start:end] == marker:
            spans.append((start, end, ref, links))
        elif not marker.strip():
            if links:
                tail.append(", ".join(f"[{lab}]({url})" for lab, url in links))
                counters["citations_to_tail"] = counters.get("citations_to_tail", 0) + 1
        elif marker in text:
            at = text.index(marker)
            spans.append((at, at + len(marker), ref, links))
            counters["citations_by_text"] = counters.get("citations_by_text", 0) + 1
        elif marker.strip():
            counters["citations_unplaced"] = counters.get("citations_unplaced", 0) + 1

    for start, end, ref, links in sorted(spans, key=lambda s: -s[0]):
        if not links:
            # A link-less reference is removed only when it is a marker or a UI payload: `type`
            # `hidden` (a `genui` blob wrapped in the U+E2xx glyphs), or a span that is whitespace or
            # starts with a private-use glyph. ChatGPT's suggested follow-up prompts (`type`
            # `followup_a`, seen 2026-09-24) are link-less spans over the model's own bullet text and
            # must stay, or the bullets are silently lost.
            span = text[start:end].strip()
            is_marker = not span or 0xE000 <= ord(span[0]) <= 0xF8FF
            if ref.get("type") != "hidden" and not is_marker:
                continue
            rendered = ""
        elif ref.get("type") == "url" and len(links) == 1:
            rendered = f"[{links[0][0]}]({links[0][1]})"
        else:
            rendered = " (" + ", ".join(f"[{lab}]({url})" for lab, url in links) + ")"
        text = text[:start] + rendered + text[end:]

    if tail:
        text = text.rstrip() + "\n\nSources: " + "; ".join(tail)
    return text


def clean(text: str, counters: dict) -> str:
    cleaned = CITE_MARKER.sub("", text)
    if cleaned != text:
        counters["citation_markers"] = counters.get("citation_markers", 0) + 1
    return cleaned.strip()


def part_text(part, counters: dict) -> str:
    """Text of one content part; non-text parts become a visible placeholder, never a silent drop."""
    if isinstance(part, str):
        return part
    if isinstance(part, dict):
        kind = part.get("content_type") or part.get("type") or "attachment"
        counters.setdefault("non_text_parts", []).append(kind)
        name = part.get("name") or part.get("asset_pointer") or ""
        return f"*[{kind}{': ' + str(name) if name else ''}]*"
    counters.setdefault("non_text_parts", []).append(type(part).__name__)
    return f"*[{type(part).__name__} part]*"


def build_blocks(conv: dict, counters: dict) -> list[dict]:
    """Flatten the nodes into ordered blocks: user / assistant messages and activity notes."""
    blocks: list[dict] = []
    for node in ordered_nodes(conv):
        m = node.get("message")
        if not m:
            continue
        meta = m.get("metadata") or {}
        if meta.get("is_visually_hidden_from_conversation"):
            continue
        role = (m.get("author") or {}).get("role")
        content = m.get("content") or {}
        ctype, recipient = content.get("content_type"), (m.get("recipient") or "")
        parts = content.get("parts") or []
        text = "\n".join(part_text(p, counters) for p in parts)
        text = clean(apply_citations(text, meta.get("content_references") or [], counters), counters)

        if role in ("user", "assistant") and ctype in ("text", "multimodal_text") and \
                recipient in ("", "all") and text:
            stamp = m.get("create_time")
            attach = [{"name": a["name"]} for a in (meta.get("attachments") or []) if a.get("name")]
            blocks.append({"kind": role, "text": text, "attachments": attach,
                           "time": dt.datetime.fromtimestamp(float(stamp), dt.timezone.utc)
                           if stamp else None})
        elif role == "assistant" and recipient.startswith("web"):
            queries = [q.get("q") or q.get("pattern") or json.dumps(q)
                       for q in (meta.get("search_queries") or [])]
            if queries:
                blocks.append({"kind": "act", "text": "web search: " + "; ".join(queries)})
            elif text:
                blocks.append({"kind": "act", "text": f"{recipient}: {text}"})
        elif role == "assistant" and ctype == "code" and recipient:
            cmd = (content.get("text") or "").strip().replace("`", "'")
            if cmd:
                blocks.append({"kind": "act", "text": f"ran in {recipient}: `{cmd}`"})
        elif role == "assistant" and ctype == "thoughts":
            summaries = [t.get("summary") for t in (content.get("thoughts") or []) if t.get("summary")]
            if summaries:
                blocks.append({"kind": "act", "text": "thinking: " + "; ".join(summaries)})
        elif role == "assistant" and ctype == "reasoning_recap":
            recap = (content.get("content") or "").strip()
            if recap:
                blocks.append({"kind": "act", "text": recap})
        # Tool result messages are skipped: a share publishes the call, not its output (container
        # results come through as "redacted"), and the transcript is about the conversation.
    return blocks


# -------------------------------------------------------------------------------- entry

def load(source: str, is_url: bool, raw_out: str | None) -> tuple[dict, list[dict], object, list[str]]:
    """(header info, blocks, decoded conversation, notes for the report) for a link or saved page."""
    html = fetch(source) if is_url else open(source, encoding="utf-8", errors="replace").read()
    if raw_out:
        open(raw_out, "w", encoding="utf-8").write(html)
    conv = extract_conversation(html)
    counters: dict = {}
    blocks = build_blocks(conv, counters)
    info = {"title": conv.get("title"), "model": conv.get("default_model_slug"),
            "url": source if is_url else page_url(html)}
    notes = []
    if counters.get("citation_markers"):
        notes.append(f"stripped ChatGPT citation markers from {counters['citation_markers']} message(s)")
    if counters.get("citations_by_text"):
        notes.append(f"{counters['citations_by_text']} citation(s) placed by text search, their span did not match")
    if counters.get("citations_to_tail"):
        notes.append(f"{counters['citations_to_tail']} whitespace-marker citation(s) moved to the Sources line")
    if counters.get("citations_unplaced"):
        notes.append(f"{counters['citations_unplaced']} citation(s) could not be placed and are NOT in the file")
    if counters.get("non_text_parts"):
        kinds = ", ".join(sorted(set(counters["non_text_parts"])))
        notes.append(f"{len(counters['non_text_parts'])} non-text part(s) kept as placeholders ({kinds})")
    return info, blocks, conv, notes
