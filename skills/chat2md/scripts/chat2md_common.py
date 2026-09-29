"""Small helpers shared by chat2md.py and the per-site source modules."""
from __future__ import annotations

import re
import sys

UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/140.0.0.0 Safari/537.36")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def fenced(body: str, lang: str = "") -> str:
    """A code fence one backtick longer than any backtick run inside, so no content can close it."""
    longest = max((len(m) for m in re.findall(r"`+", body)), default=0)
    fence = "`" * max(3, longest + 1)
    return f"{fence}{lang}\n{body.rstrip(chr(10))}\n{fence}"


def details(summary: str, body: str) -> str:
    """A collapsed section: full content kept in the file, folded away when the markdown renders."""
    return f"<details><summary>{summary}</summary>\n\n{body}\n\n</details>"
