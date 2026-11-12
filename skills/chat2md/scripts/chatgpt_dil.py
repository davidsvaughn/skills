"""ChatGPT "dil-v2" answers (seen 2026-11-12): put the links and citations back into the markdown copy.

Since November 2026 a share page publishes each genui answer twice (see NOTES.md, "octane" page):

- `content` / `dil.fallbackMarkdown`: the answer as plain markdown, ChatGPT's own conversion. It is
  complete as prose, tables and code, but every inline component is gone from it: a `Link` leaves no
  text at all, a `Cite` (the source chips after a sentence) and a `MemoryCite` vanish, an
  `AsyncImage` vanishes.
- `dil.code`: the answer as a compiled JSX program, `__dil.jsx(tag, props, ...children)`, whose text
  sits in `dil.constants` (`__dilConstants["<n>"]`) and whose components are resolved in
  `dil.appData.opGenui.componentResults`, keyed by the `__resolutionId` in each component's props.

The markdown copy is kept as the body, verbatim, and each component is spliced into it at the place
its neighbours in the program put it: the program's text constants are found in the markdown in
document order, and a component goes right after the text before it in its own parent element, or,
when it opens its parent, right before the text after it. Text the program shows but the markdown
copy does not hold is reported, never dropped silently.

Only the subset of JavaScript the generator emits is parsed: `__dil.jsx(...)` calls, constants,
string literals and `__dilSafe(()=>(...),fallback)` wrappers. Any other expression (a `.map` over an
inline array, a ternary, a template literal) is kept as an opaque node, and the `__dil.jsx(...)`
calls inside it are still parsed, so their text and components are not lost either.
"""
from __future__ import annotations

import json
import re
import urllib.parse

JSX = "__dil.jsx("
SAFE = "__dilSafe(()=>("
CONST = re.compile(r'__dilConstants\["(\d+)"\]')
IDENT = re.compile(r"[A-Za-z_$][\w$.]*")


class Parser:
    """A recursive-descent reader for the generated program; positions index into `src`."""

    def __init__(self, src: str, constants: dict):
        self.src = src
        self.constants = constants
        self.data: dict[str, str] = {}       # `const name = __dilSafe(()=>(<data>),undefined)`
        for m in re.finditer(r"const (\w+) = " + re.escape(SAFE), src):
            self.data[m.group(1)] = src[m.end():self.scan(m.end())]

    # -- scanning helpers
    def ws(self, i: int) -> int:
        while i < len(self.src) and self.src[i] in " \t\r\n":
            i += 1
        return i

    def string_end(self, i: int) -> int:
        """Index just past the string literal opening at i ("...", '...' or `...`)."""
        quote, j = self.src[i], i + 1
        while j < len(self.src):
            c = self.src[j]
            if c == "\\":
                j += 2
                continue
            if c == quote:
                return j + 1
            j += 1
        return j

    def matching(self, i: int) -> int:
        """Index of the bracket closing the one at i."""
        depth, j = 0, i
        while j < len(self.src):
            c = self.src[j]
            if c in "\"'`":
                j = self.string_end(j)
                continue
            if c in "([{":
                depth += 1
            elif c in ")]}":
                depth -= 1
                if depth == 0:
                    return j
            j += 1
        return j

    def scan(self, i: int) -> int:
        """Index of the top-level `,` or closing bracket ending the expression that starts at i."""
        depth, j = 0, i
        while j < len(self.src):
            c = self.src[j]
            if c in "\"'`":
                j = self.string_end(j)
                continue
            if c in "([{":
                depth += 1
            elif c in ")]}":
                if depth == 0:
                    return j
                depth -= 1
            elif c == "," and depth == 0:
                return j
            j += 1
        return j

    # -- expressions
    def expr(self, i: int) -> tuple[dict, int]:
        """One argument expression starting at i: (node, index of the `,` or `)` after it)."""
        i = self.ws(i)
        end = self.scan(i)
        if self.src.startswith(JSX, i):
            node, j = self.jsx(i + len(JSX))
            if self.ws(j) == end:
                return node, end
        elif self.src.startswith(SAFE, i):
            inner, j = self.expr(i + len(SAFE))
            j = self.ws(j)
            if j < len(self.src) and self.src[j] == ")":
                return inner, end          # the wrapper's fallback value is not shown
        else:
            m = CONST.match(self.src, i)
            if m and self.ws(m.end()) == end:
                value = self.constants.get(m.group(1))
                if isinstance(value, str):
                    return {"t": "text", "value": value, "const": m.group(1)}, end
                return {"t": "value", "value": value, "const": m.group(1)}, end
            if self.src[i:i + 1] == '"' and self.ws(self.string_end(i)) == end:
                try:
                    return {"t": "text", "value": json.loads(self.src[i:self.string_end(i)])}, end
                except json.JSONDecodeError:
                    pass
        return self.opaque(i, end), end

    def opaque(self, i: int, end: int) -> dict:
        """An expression outside the subset; the jsx calls inside it are still read, in order."""
        children, j = [], i
        while True:
            k = self.src.find(JSX, j, end)
            if k < 0:
                break
            node, j = self.jsx(k + len(JSX))
            children.append(node)
        literals = []
        for m in re.finditer(r'"((?:[^"\\]|\\.)*)"', self.src[i:end]):
            try:
                literals.append(json.loads(m.group(0)))
            except json.JSONDecodeError:
                pass
        node = {"t": "opaque", "code": self.src[i:end], "children": children, "literals": literals}
        # `(<array or const name>).map((x)=>...)`: a chart, grid or list drawn from inline data
        m = re.match(r"[\s(]*(\w+)\s*\)?\.map\(", self.src[i:end])
        if m and m.group(1) in self.data:
            node["data"] = self.data[m.group(1)]
        elif self.src[i:end].lstrip("( ").startswith("["):
            k = i + len(self.src[i:end]) - len(self.src[i:end].lstrip("( "))
            close = self.matching(k)
            if self.src.startswith("]", close) and re.match(r"[\s)]*\.map\(", self.src[close + 1:end]):
                node["data"] = self.src[k:close + 1]
        return node

    def jsx(self, i: int) -> tuple[dict, int]:
        """The call whose arguments start at i (just after `__dil.jsx(`): (element, index past `)`)."""
        i = self.ws(i)
        if self.src[i] == '"':
            j = self.string_end(i)
            tag = json.loads(self.src[i:j])
        else:
            m = IDENT.match(self.src, i)
            tag = m.group(0) if m else ""
            j = m.end() if m else self.scan(i)
        node = {"t": "el", "tag": tag, "props": "", "children": []}
        j = self.ws(j)
        if j < len(self.src) and self.src[j] == ",":
            p = self.ws(j + 1)
            j = self.scan(p)
            node["props"] = self.src[p:j]
        while j < len(self.src) and self.src[j] == ",":
            child, j = self.expr(j + 1)
            node["children"].append(child)
        if j < len(self.src) and self.src[j] == ")":
            j += 1
        return node, j


def parse(code: str, constants: dict) -> dict | None:
    """The element tree the program returns, or None when its body cannot be found."""
    k = code.find("return " + JSX)
    if k < 0:
        return None
    node, _ = Parser(code, constants).jsx(k + len("return " + JSX))
    return node


# ------------------------------------------------------------------------------- props

def prop(node: dict, name: str, constants: dict):
    """A prop's value when it is a literal or a constant; None for anything computed."""
    m = re.search(r'"?' + re.escape(name) + r'"?\s*:\s*(__dilConstants\["(\d+)"\]|"(?:[^"\\]|\\.)*")',
                  node.get("props") or "")
    if not m:
        return None
    if m.group(2) is not None:
        return constants.get(m.group(2))
    return json.loads(m.group(1))


def is_thumbnail(url: str) -> bool:
    return urllib.parse.urlsplit(url).netloc == "images.openai.com"


def render_component(node: dict, constants: dict, results: dict, counters: dict) -> str | None:
    """Markdown for one inline component, or None when it is not one this knows how to write."""
    tag = node["tag"]
    res = results.get(prop(node, "__resolutionId", constants) or "") or {}
    state = res.get("state") or {}
    if tag == "Link":
        url = prop(node, "url", constants) or state.get("url")
        title = prop(node, "title", constants) or state.get("title") or url
        if not url:
            return None
        counters["dil_links"] = counters.get("dil_links", 0) + 1
        return f"[{str(title).replace(']', ')')}]({url})"
    if tag == "Cite":
        items = [it for it in state.get("items") or []
                 if isinstance(it, dict) and it.get("url") and not is_thumbnail(it["url"])]
        if not items:
            counters["dil_cites_unresolved"] = counters.get("dil_cites_unresolved", 0) + 1
            refs = prop(node, "refs", constants) or prop(node, "ref", constants) or []
            return "*[citation: " + ", ".join(map(str, refs if isinstance(refs, list) else [refs])) + "]*"
        seen, links = set(), []
        for it in items:
            if it["url"] in seen:
                continue
            seen.add(it["url"])
            label = re.sub(r"\s+", " ", str(it.get("title") or it["url"])).replace("]", ")").strip()
            links.append(f"[{label}]({it['url']})")
        counters["dil_cites"] = counters.get("dil_cites", 0) + 1
        counters["citations_linked"] = counters.get("citations_linked", 0) + len(links)
        return "(" + ", ".join(links) + ")"
    if tag == "MemoryCite":
        counters["dil_memory_cites"] = counters.get("dil_memory_cites", 0) + 1
        return "*[memory citation]*"
    if tag == "AsyncImage":
        query = prop(node, "query", constants) or ""
        pages = [im.get("url") for im in state.get("images") or []
                 if isinstance(im, dict) and im.get("url") and not is_thumbnail(im["url"])]
        where = f" from [{urllib.parse.urlsplit(pages[0]).netloc}]({pages[0]})" if pages else ""
        counters["dil_images"] = counters.get("dil_images", 0) + 1
        return f"*[image: {query}{where}]*"
    return None


# ----------------------------------------------------------------------------- placing

def text_pattern(text: str) -> re.Pattern:
    """`text` as the markdown copy may write it: punctuation possibly backslash-escaped, any spacing."""
    out = []
    for c in text.strip():
        if c.isspace():
            if not out or out[-1] != r"\s+":
                out.append(r"\s+")
        elif c.isalnum():
            out.append(re.escape(c))
        else:
            out.append(r"\\?" + re.escape(c))
    return re.compile("".join(out))


def leaves(node: dict, parent: int, out: list, counter: list, tags: tuple = ()) -> None:
    """Document-order leaves: ("text", value, parent id, tags) and ("comp", element, parent id, tags).

    String literals inside an opaque expression are not leaves: most are prop values ("md",
    "100%"), and matching them against the markdown would move the cursor to a random place.
    """
    if node["t"] == "text":
        out.append(("text", node["value"], parent, tags))
    elif node["t"] == "opaque":
        my = counter[0] = counter[0] + 1
        if node.get("data"):
            out.append(("data", node["data"], parent, tags))
            tags = tags + ("data",)
        for child in node["children"]:
            leaves(child, my, out, counter, tags)
    elif node["t"] == "el":
        if node["tag"][:1].isupper():
            out.append(("comp", node, parent, tags))
            return
        my = counter[0] = counter[0] + 1
        for child in node["children"]:
            leaves(child, my, out, counter, tags + (node["tag"],))


CLOSERS = re.compile(r"[*_`~]+")


def page_only(texts: list[tuple[str, tuple]]) -> str:
    """A run of program text the markdown copy lacks, written where it stands on the page."""
    lines = []
    for value, tags in texts:
        if "data-block" in tags:
            fence = "`" * max([3] + [len(r) + 1 for r in re.findall(r"`{3,}", value)])
            lines.append(f"Drawn on the page from this data:\n\n{fence}js\n{value}\n{fence}")
            continue
        value = value.strip()
        lines.append(("- " + value) if "list-item" in tags else value)
    return "*[shown on the page, not in ChatGPT's markdown copy:]*\n\n" + "\n\n".join(lines)


def splice(markdown: str, tree: dict, constants: dict, results: dict, counters: dict
           ) -> tuple[str, list[str], list[str]]:
    """(markdown with the components spliced in, verbatim pieces, program text the copy lacks).

    Program text that cannot be found in the markdown copy is written in at the place it stands on
    the page, under a marker line, so the transcript shows everything the page shows.
    """
    items: list = []
    leaves(tree, 0, items, [0])
    inserts: list[tuple[int, int, str]] = []   # (offset in markdown, order, rendered text)
    missing: list[tuple[str, tuple]] = []      # every text not found, in order
    run: list[tuple[str, tuple]] = []          # the current run of them, written at the cursor
    cursor = 0
    last_end = {}                              # parent id -> end of the last text placed in it
    pending: list[str] = []                    # components waiting for the next placed text

    def add(at: int, text: str) -> None:
        inserts.append((at, len(inserts), text))

    def flush_run(at: int) -> None:
        if run:                              # a paragraph of its own, without doubling blank lines
            after = "" if markdown.startswith("\n", at) else "\n\n"
            add(at, "\n\n" + page_only(run) + after)
            run.clear()

    shown_data = False
    for kind, value, parent, tags in items:
        if kind == "data":
            words = [w for w in re.findall(r'"((?:[^"\\]|\\.)*)"', value) if re.search(r"[A-Za-z]{3}", w)]
            shown_data = bool(words) and not all(text_pattern(w).search(markdown) for w in words)
            if shown_data:
                run.append((value, ("data-block",)))
                counters["dil_data_blocks"] = counters.get("dil_data_blocks", 0) + 1
            continue
        if "data" not in tags:
            shown_data = False
        if kind == "text":
            if shown_data:
                continue                     # a template label of the data block just written
            if not value.strip():
                continue
            m = text_pattern(value).search(markdown, cursor)
            if m and len(value.strip()) < 4 and re.search(r"[A-Za-z]", markdown[cursor:m.start()]):
                m = None                     # a separator like " · " must not jump over prose
            if not m:
                missing.append((value, tags))
                run.append((value, tags))
                continue
            flush_run(cursor)
            at = m.start()                   # before the text's own opening markup, not inside it
            while at > cursor and markdown[at - 1] in "*_`~":
                at -= 1
            for rendered in pending:
                add(at, rendered + " ")
            pending.clear()
            cursor = m.end()
            last_end[parent] = cursor
        else:
            rendered = render_component(value, constants, results, counters)
            if rendered is None:
                counters.setdefault("dil_unknown", []).append(value["tag"])
                continue
            if run:                          # it belongs with page-only text: keep it there
                run.append((rendered, tags))
            elif parent in last_end:
                at = last_end[parent]
                closer = CLOSERS.match(markdown, at)
                if closer:
                    at = closer.end()
                gap = "" if at and markdown[at - 1].isspace() else " "
                add(at, gap + rendered)
                last_end[parent] = at
            else:
                pending.append(rendered)
    flush_run(len(markdown))
    for rendered in pending:                 # nothing followed them: they close the message
        add(len(markdown), " " + rendered)
        counters["dil_at_end"] = counters.get("dil_at_end", 0) + 1

    out, pieces, prev = [], [], 0
    for at, _, rendered in sorted(inserts):
        out.append(markdown[prev:at])
        pieces.append(markdown[prev:at])
        out.append(rendered)
        prev = at
    out.append(markdown[prev:])
    pieces.append(markdown[prev:])
    if missing:
        counters["dil_page_only"] = counters.get("dil_page_only", 0) + len(missing)
    return "".join(out).strip(), [p.strip() for p in pieces if p.strip()], [v for v, _ in missing]
