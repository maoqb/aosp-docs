"""Add standalone HTML notes to MkDocs Material's search index."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path


class VisibleTextParser(HTMLParser):
    """Collect a document title and searchable body text, excluding code assets."""

    SKIPPED_TAGS = {"script", "style", "svg", "noscript", "template"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_body = False
        self.in_title = False
        self.skip_depth = 0
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "body":
            self.in_body = True
        elif tag == "title":
            self.in_title = True
        if self.in_body and (self.skip_depth or tag in self.SKIPPED_TAGS):
            self.skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if self.skip_depth:
            self.skip_depth -= 1
        if tag == "body":
            self.in_body = False
        elif tag == "title":
            self.in_title = False

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.title_parts.append(data)
        elif self.in_body and not self.skip_depth:
            self.text_parts.append(data)


def compact(parts: list[str]) -> str:
    return re.sub(r"\s+", " ", " ".join(parts)).strip()


def on_post_build(config, **kwargs) -> None:
    """Append raw HTML documents after the standard search plugin finishes."""
    docs_dir = Path(config.docs_dir)
    search_index = Path(config.site_dir) / "search" / "search_index.json"
    if not search_index.is_file():
        return

    index = json.loads(search_index.read_text(encoding="utf-8"))
    indexed_locations = {entry.get("location", "").split("#", 1)[0] for entry in index["docs"]}

    for source in sorted(docs_dir.rglob("*.html")):
        location = source.relative_to(docs_dir).as_posix()
        if location in indexed_locations:
            continue

        parser = VisibleTextParser()
        parser.feed(source.read_text(encoding="utf-8", errors="replace"))
        title = compact(parser.title_parts) or source.stem.replace("_", " ").replace("-", " ")
        text = compact(parser.text_parts)
        if text:
            index["docs"].append({"location": location, "title": title, "text": text})

    search_index.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
