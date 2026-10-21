#!/usr/bin/env python3
"""Prepare the Notes submodule as a disposable VitePress source tree."""

from __future__ import annotations

import base64
import json
import re
import shutil
from collections import Counter
from dataclasses import dataclass, field
from html import escape, unescape
from pathlib import Path
from urllib.parse import quote


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
NOTES_DIRECTORY = REPOSITORY_ROOT / "Notes"
GENERATED_DOCS = REPOSITORY_ROOT / ".generated_docs"
GENERATED_PUBLIC = REPOSITORY_ROOT / ".generated_public"
GENERATED_DATA = REPOSITORY_ROOT / ".generated_vitepress"

MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdown", ".mkdn", ".mkd"}
DRAWDOC_EXTENSION = ".drawdoc"
MARKDOWN_SOURCE_EXTENSIONS = MARKDOWN_EXTENSIONS | {DRAWDOC_EXTENSION}
HTML_EXTENSIONS = {".html", ".htm"}
ASSET_EXTENSIONS = {
    # Images and diagrams
    ".apng", ".avif", ".bmp", ".drawio", ".gif", ".ico", ".jpeg", ".jpg",
    ".pdf", ".plantuml", ".puml", ".png", ".svg", ".webp",
    # Documents and browser resources
    ".doc", ".docx", ".odt", ".ppt", ".pptx", ".pps", ".ppsx", ".rtf",
    ".css", ".csv", ".eot", ".js", ".json", ".json5", ".map", ".mjs",
    ".otf", ".toml", ".tsv", ".ttf", ".wasm", ".woff", ".woff2", ".xml",
    ".yaml", ".yml",
    # Media, archives, and source attachments
    ".gz", ".mp3", ".mp4", ".ogg", ".tar", ".wav", ".webm", ".zip",
    ".aidl", ".bp", ".c", ".cc", ".conf", ".cpp", ".diff", ".go", ".gradle",
    ".h", ".hpp", ".ini", ".java", ".kt", ".kts", ".log", ".mk", ".patch",
    ".properties", ".proto", ".py", ".rc", ".rs", ".sh", ".sql", ".textproto",
    ".txt",
}
COPY_EXTENSIONS = MARKDOWN_SOURCE_EXTENSIONS | HTML_EXTENSIONS | ASSET_EXTENSIONS
NAVIGATION_EXTENSIONS = MARKDOWN_SOURCE_EXTENSIONS | HTML_EXTENSIONS | {
    ".doc", ".docx", ".odt", ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".rtf",
}
EXCLUDED_DIRECTORY_NAMES = {
    ".docforge", ".git", ".github", ".gradle", ".idea", ".mypy_cache",
    ".pytest_cache", ".repo", ".tox", ".venv", ".vscode", "__pycache__",
}

DRAWDOC_MACRO_PATTERN = re.compile(
    r"^```(?P<kind>drawio|excalidraw|mermaid|mindmap)(?P<params>[^\r\n]*)\r?\n"
    r"(?P<body>.*?)(?:\r?\n)?^```[ \t]*$",
    re.MULTILINE | re.DOTALL,
)

BRAND_LOGO = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="15" fill="#0b8f55"/>
  <path d="M18 45 29.8 16h4.4L46 45h-7.1l-2.5-6.7h-9L24.9 45H18Zm11.6-12.8h4.8L32 25.3l-2.4 6.9Z" fill="#fff"/>
  <circle cx="49" cy="16" r="4" fill="#b8f5d2"/>
</svg>
"""


def reset_directory(path: Path, expected_name: str) -> None:
    """Recreate one known repository-local generated directory."""
    if path.parent != REPOSITORY_ROOT or path.name != expected_name:
        raise RuntimeError(f"Refusing to clean unexpected path: {path}")
    shutil.rmtree(path, ignore_errors=True)
    path.mkdir()


def is_excluded(path: Path) -> bool:
    return any(part in EXCLUDED_DIRECTORY_NAMES for part in path.parts)


def is_shadowed_by_drawdoc(path: Path) -> bool:
    """Prefer a DrawDoc source when a legacy Markdown export has the same stem."""
    return (
        path.suffix.lower() in MARKDOWN_EXTENSIONS
        and path.with_suffix(DRAWDOC_EXTENSION).is_file()
    )


def published_relative_path(path: Path) -> Path:
    relative = path.relative_to(NOTES_DIRECTORY)
    return relative.with_suffix(".md") if path.suffix.lower() == DRAWDOC_EXTENSION else relative


def drawdoc_layout(kind: str, parameters: str) -> tuple[str, str]:
    """Return safe wrapper classes and a width style from DrawDocs fence params."""
    width_match = re.search(r"(?:^|\s)width=(\d+)(?:\s|$)", parameters)
    align_match = re.search(r"(?:^|\s)align=(left|center|right)(?:\s|$)", parameters)
    classes = ["drawdoc-diagram", f"drawdoc-{kind}"]
    if align_match:
        classes.append(f"drawdoc-align-{align_match.group(1)}")
    width = int(width_match.group(1)) if width_match else 0
    style = f' style="--drawdoc-width: {min(width, 2400)}px"' if width else ""
    return " ".join(classes), style


def excalidraw_svg(payload: str) -> str:
    """Render common Excalidraw scene elements as a static, accessible SVG."""
    if not payload.strip():
        return '<p class="drawdoc-placeholder">空白 Excalidraw 白板</p>'
    try:
        scene = json.loads(payload)
    except json.JSONDecodeError:
        return '<p class="drawdoc-error">Excalidraw 数据无法解析。</p>'

    if not isinstance(scene, dict):
        return '<p class="drawdoc-error">Excalidraw 数据格式不正确。</p>'
    scene_elements = scene.get("elements")
    elements = (
        [
            element
            for element in scene_elements
            if isinstance(element, dict) and not element.get("isDeleted")
        ]
        if isinstance(scene_elements, list)
        else []
    )
    if not elements:
        return '<p class="drawdoc-placeholder">空白 Excalidraw 白板</p>'

    def number(value: object, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    bounds = []
    for element in elements:
        x = number(element.get("x"))
        y = number(element.get("y"))
        bounds.append((x, y, x + number(element.get("width")), y + number(element.get("height"))))
    min_x = min(item[0] for item in bounds) - 24
    min_y = min(item[1] for item in bounds) - 24
    max_x = max(item[2] for item in bounds) + 24
    max_y = max(item[3] for item in bounds) + 24

    shapes = [
        '<defs><marker id="drawdoc-arrow" markerWidth="8" markerHeight="8" '
        'refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" '
        'fill="context-stroke"/></marker></defs>'
    ]
    for element in elements:
        kind = str(element.get("type", ""))
        x = number(element.get("x"))
        y = number(element.get("y"))
        width = number(element.get("width"))
        height = number(element.get("height"))
        stroke = escape(str(element.get("strokeColor") or "#1b1b1f"), quote=True)
        background = str(element.get("backgroundColor") or "transparent")
        fill = "none" if background == "transparent" else escape(background, quote=True)
        stroke_width = max(1.0, number(element.get("strokeWidth"), 1.0))
        opacity = min(1.0, max(0.0, number(element.get("opacity"), 100.0) / 100.0))
        common = f'stroke="{stroke}" stroke-width="{stroke_width:g}" opacity="{opacity:g}"'

        if kind == "rectangle":
            radius = min(12.0, width / 10, height / 10) if element.get("roundness") else 0
            shapes.append(
                f'<rect x="{x:g}" y="{y:g}" width="{width:g}" height="{height:g}" '
                f'rx="{radius:g}" fill="{fill}" {common}/>'
            )
        elif kind == "ellipse":
            shapes.append(
                f'<ellipse cx="{x + width / 2:g}" cy="{y + height / 2:g}" '
                f'rx="{width / 2:g}" ry="{height / 2:g}" fill="{fill}" {common}/>'
            )
        elif kind == "diamond":
            points = (
                f"{x + width / 2:g},{y:g} {x + width:g},{y + height / 2:g} "
                f"{x + width / 2:g},{y + height:g} {x:g},{y + height / 2:g}"
            )
            shapes.append(f'<polygon points="{points}" fill="{fill}" {common}/>')
        elif kind in {"line", "arrow", "freedraw"}:
            points = element.get("points") or []
            coordinates = " ".join(
                f"{x + number(point[0]):g},{y + number(point[1]):g}"
                for point in points
                if isinstance(point, list) and len(point) >= 2
            )
            marker = ' marker-end="url(#drawdoc-arrow)"' if kind == "arrow" else ""
            if coordinates:
                shapes.append(f'<polyline points="{coordinates}" fill="none" {common}{marker}/>')
        elif kind == "text":
            text = str(element.get("text") or element.get("originalText") or "")
            font_size = max(8.0, number(element.get("fontSize"), 20.0))
            lines = text.splitlines() or [""]
            tspans = "".join(
                f'<tspan x="{x:g}" dy="{0 if index == 0 else font_size * 1.25:g}">{escape(line)}</tspan>'
                for index, line in enumerate(lines)
            )
            shapes.append(
                f'<text x="{x:g}" y="{y + font_size:g}" fill="{stroke}" '
                f'font-size="{font_size:g}" font-family="sans-serif" opacity="{opacity:g}">{tspans}</text>'
            )

    app_state = scene.get("appState")
    background_color = app_state.get("viewBackgroundColor") if isinstance(app_state, dict) else None
    background = escape(str(background_color or "#ffffff"), quote=True)
    return (
        f'<svg class="drawdoc-excalidraw-svg" viewBox="{min_x:g} {min_y:g} '
        f'{max_x - min_x:g} {max_y - min_y:g}" role="img" aria-label="Excalidraw 图">'
        f'<rect x="{min_x:g}" y="{min_y:g}" width="{max_x - min_x:g}" '
        f'height="{max_y - min_y:g}" fill="{background}"/>'
        + "".join(shapes)
        + "</svg>"
    )


def mindmap_tree(payload: str) -> str:
    """Render mind-elixir JSON as a nested semantic tree."""
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return '<p class="drawdoc-error">思维导图数据无法解析。</p>'
    root = data.get("nodeData") if isinstance(data, dict) else None
    if not isinstance(root, dict):
        return '<p class="drawdoc-error">思维导图缺少根节点。</p>'

    def render_node(node: dict[str, object]) -> str:
        topic = escape(str(node.get("topic") or "未命名节点"))
        children_value = node.get("children")
        children = (
            [child for child in children_value if isinstance(child, dict)]
            if isinstance(children_value, list)
            else []
        )
        nested = ""
        if children:
            nested = "<ul>" + "".join(f"<li>{render_node(child)}</li>" for child in children) + "</ul>"
        return f'<span class="drawdoc-mindmap-node">{topic}</span>{nested}'

    return f'<div class="drawdoc-mindmap-tree"><ul><li>{render_node(root)}</li></ul></div>'


def render_drawdoc_macro(match: re.Match[str]) -> str:
    """Convert one DrawDocs fence to browser-renderable HTML."""
    kind = match.group("kind")
    payload = match.group("body").strip()
    classes, style = drawdoc_layout(kind, match.group("params"))

    if kind == "drawio":
        configuration = json.dumps(
            {
                "highlight": "#f75357",
                "nav": True,
                "resize": True,
                "toolbar": "zoom layers lightbox",
                "dark-mode": "auto",
                "xml": payload,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        body = (
            f'<div class="mxgraph" data-mxgraph="{escape(configuration, quote=True)}">'
            '<p class="drawdoc-placeholder">正在加载 draw.io 图表…</p></div>'
        )
    elif kind == "mermaid":
        encoded = base64.b64encode(payload.encode("utf-8")).decode("ascii")
        body = (
            f'<div class="mermaid" data-mermaid-source="{encoded}">'
            '<p class="drawdoc-placeholder">正在加载 Mermaid 图表…</p></div>'
        )
    elif kind == "excalidraw":
        body = excalidraw_svg(payload)
    else:
        body = mindmap_tree(payload)
    return f'\n<div class="{classes}"{style}>\n{body}\n</div>\n'


def normalize_headings(content: str) -> str:
    """Keep one document title and demote later H1 sections to H2."""
    output: list[str] = []
    in_fence = False
    title_seen = False
    for line in content.splitlines(keepends=True):
        stripped = line.lstrip()
        if stripped.startswith("```"):
            in_fence = not in_fence
        if not in_fence and re.match(r"^#\s+", stripped):
            if title_seen:
                prefix_length = len(line) - len(stripped)
                line = line[:prefix_length] + "#" + stripped
            else:
                title_seen = True
        output.append(line)
    return "".join(output)


def convert_drawdoc(content: str) -> str:
    """Convert DrawDocs' Markdown superset into VitePress-compatible Markdown."""
    return DRAWDOC_MACRO_PATTERN.sub(render_drawdoc_macro, normalize_headings(content))


@dataclass
class NotesEntry:
    path: Path
    children: list["NotesEntry"] = field(default_factory=list)


def build_notes_entry(path: Path) -> NotesEntry:
    if path.is_file():
        return NotesEntry(path)
    directory_order = {"binder": 0, "servicemanager": 1, "aosp": 2, "cpp": 3}

    def sort_key(item: Path) -> tuple[int, int, str]:
        if item.is_dir():
            return (0, directory_order.get(item.name.casefold(), 50), item.name.casefold())
        return (1, 0, item.name.casefold())

    children = [
        build_notes_entry(child)
        for child in sorted(path.iterdir(), key=sort_key)
        if (
            child.is_dir()
            and not is_excluded(child.relative_to(NOTES_DIRECTORY))
        ) or (
            child.is_file()
            and child.suffix.lower() in NAVIGATION_EXTENSIONS
            and not is_shadowed_by_drawdoc(child)
            and not (
                child.suffix.lower() in MARKDOWN_SOURCE_EXTENSIONS
                and child.stem.casefold() in {"index", "readme"}
            )
        )
    ]
    return NotesEntry(path, [entry for entry in children if entry.path.is_file() or entry.children])


def markdown_title(path: Path) -> str:
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^#\s+(.+?)\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else path.stem


def html_title(path: Path) -> str:
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"<title\b[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
    if not match:
        return path.stem.replace("_", " ").replace("-", " ")
    title = re.sub(r"<[^>]+>", "", match.group(1))
    return unescape(" ".join(title.split())) or path.stem


def pretty_name(path: Path) -> str:
    aliases = {
        "aosp": "AOSP",
        "binder": "Binder",
        "cpp": "C / C++",
        "release_config": "Release Config",
        "servicemanager": "ServiceManager",
    }
    return aliases.get(path.name.casefold(), path.name.replace("_", " ").replace("-", " "))


def notes_label(path: Path) -> str:
    if path.is_dir():
        return pretty_name(path)
    if path.suffix.lower() in HTML_EXTENSIONS:
        return html_title(path)
    if path.suffix.lower() in MARKDOWN_SOURCE_EXTENSIONS:
        return markdown_title(path)
    return path.name


def notes_url(path: Path) -> str:
    """Return a root-relative URL; VitePress applies the configured base path."""
    relative = Path("Notes") / path.relative_to(NOTES_DIRECTORY)
    suffix = path.suffix.lower()
    if suffix in MARKDOWN_SOURCE_EXTENSIONS:
        if path.stem.casefold() in {"index", "readme"}:
            relative = relative.parent / "index.html"
        else:
            relative = relative.with_suffix(".html")
    # Ampersands are valid path characters. Encoding them as %26 breaks Vite's
    # static preview routing even though the file itself contains a literal `&`.
    return "/" + quote(relative.as_posix(), safe="/-._~&")


def sidebar_item(entry: NotesEntry, depth: int = 0) -> dict[str, object]:
    if entry.path.is_file():
        return {"text": notes_label(entry.path), "link": notes_url(entry.path)}
    return {
        "text": notes_label(entry.path),
        "collapsed": depth > 0,
        "items": [sidebar_item(child, depth + 1) for child in entry.children],
    }


def markdown_excerpt(path: Path) -> str:
    """Return the first readable paragraph without leaking source HTML."""
    content = path.read_text(encoding="utf-8", errors="replace")
    in_code_block = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if not stripped or in_code_block or stripped.startswith(("#", "|", "!", "<")):
            continue
        plain_text = re.sub(r"^>\s*", "", stripped)
        plain_text = re.sub(r"^(?:[-*+] |\d+[.)]\s+)", "", plain_text)
        plain_text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", plain_text)
        plain_text = re.sub(r"<[^>]+>", " ", plain_text)
        plain_text = unescape(re.sub(r"[`*_~]", "", plain_text))
        plain_text = " ".join(plain_text.split())
        if plain_text:
            return plain_text[:150].rstrip() + ("…" if len(plain_text) > 150 else "")
    return f"关于 {notes_label(path)} 的技术笔记。"


def html_excerpt(path: Path) -> str:
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(
        r'<meta\b[^>]*\bname=["\']description["\'][^>]*\bcontent=["\'](.*?)["\']',
        content,
        re.IGNORECASE | re.DOTALL,
    )
    if match:
        return unescape(" ".join(match.group(1).split()))
    for tag_name in ("blockquote", "p"):
        match = re.search(
            rf"<{tag_name}\b[^>]*>(.*?)</{tag_name}>",
            content,
            re.IGNORECASE | re.DOTALL,
        )
        if match:
            text = unescape(re.sub(r"<[^>]+>", " ", match.group(1)))
            text = " ".join(text.split())
            if text:
                return text[:150].rstrip() + ("…" if len(text) > 150 else "")
    return f"关于 {notes_label(path)} 的 HTML 技术笔记。"


def notes_excerpt(path: Path) -> str:
    return html_excerpt(path) if path.suffix.lower() in HTML_EXTENSIONS else markdown_excerpt(path)


def documents_under(entry: NotesEntry) -> list[Path]:
    if entry.path.is_file():
        return [entry.path]
    documents: list[Path] = []
    for child in entry.children:
        documents.extend(documents_under(child))
    return documents


def generate_site_data(root: NotesEntry) -> dict[str, object]:
    sidebar = [sidebar_item(entry) for entry in root.children]
    topics: list[dict[str, object]] = []
    ungrouped: list[Path] = []
    for entry in root.children:
        if entry.path.is_file():
            ungrouped.append(entry.path)
            continue
        articles = [
            {
                "title": notes_label(path),
                "excerpt": notes_excerpt(path),
                "link": notes_url(path),
            }
            for path in documents_under(entry)
        ]
        if articles:
            topics.append({"title": notes_label(entry.path), "articles": articles})
    if ungrouped:
        topics.append(
            {
                "title": "其他",
                "articles": [
                    {
                        "title": notes_label(path),
                        "excerpt": notes_excerpt(path),
                        "link": notes_url(path),
                    }
                    for path in ungrouped
                ],
            }
        )

    first_article = next(
        (
            article["link"]
            for topic in topics
            for article in topic["articles"]  # type: ignore[index]
        ),
        "/",
    )
    data = {"sidebar": sidebar, "topics": topics, "firstArticle": first_article}
    (GENERATED_DATA / "site-data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return data


def generate_home_page() -> None:
    content = """---
layout: home
title: AOSP 源码笔记
titleTemplate: Android Framework
hero:
  name: AOSP 源码笔记
  tagline: 从源码出发，梳理 Android Framework 的设计、调用链与实现细节。
---

<HomeIndex />
"""
    (GENERATED_DOCS / "index.md").write_text(content, encoding="utf-8")


def generate_legacy_redirect(path: Path) -> None:
    if path.stem.casefold() in {"index", "readme"}:
        return
    relative = path.relative_to(NOTES_DIRECTORY).with_suffix("")
    destination = GENERATED_PUBLIC / "Notes" / relative / "index.html"
    destination.parent.mkdir(parents=True, exist_ok=True)
    target = "../" + quote(relative.name + ".html", safe="-._~&")
    destination.write_text(
        "<!doctype html>\n"
        '<html lang="zh-CN"><head><meta charset="utf-8">\n'
        f'<meta http-equiv="refresh" content="0; url={escape(target, quote=True)}">\n'
        '<meta name="robots" content="noindex">\n'
        f'<title>页面已迁移</title></head><body><p>页面已迁移：'
        f'<a href="{escape(target, quote=True)}">继续阅读</a></p>\n'
        f'<script>location.replace({json.dumps(target)} + location.search + location.hash)</script>\n'
        "</body></html>\n",
        encoding="utf-8",
    )


def prepare_docs() -> Counter[str]:
    if not NOTES_DIRECTORY.is_dir():
        raise RuntimeError("Notes submodule is required. Run git submodule update --init.")

    reset_directory(GENERATED_DOCS, ".generated_docs")
    reset_directory(GENERATED_PUBLIC, ".generated_public")
    reset_directory(GENERATED_DATA, ".generated_vitepress")
    counts: Counter[str] = Counter()

    for source in sorted(NOTES_DIRECTORY.rglob("*")):
        if not source.is_file():
            continue
        relative = source.relative_to(NOTES_DIRECTORY)
        suffix = source.suffix.lower()
        if is_excluded(relative) or suffix not in COPY_EXTENSIONS or is_shadowed_by_drawdoc(source):
            continue

        if suffix in MARKDOWN_SOURCE_EXTENSIONS:
            destination = GENERATED_DOCS / "Notes" / published_relative_path(source)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if suffix == DRAWDOC_EXTENSION:
                destination.write_text(
                    convert_drawdoc(source.read_text(encoding="utf-8", errors="replace")),
                    encoding="utf-8",
                )
                counts["DrawDoc"] += 1
            else:
                shutil.copy2(source, destination)
                counts["Markdown"] += 1
            generate_legacy_redirect(source)
            continue

        public_destination = GENERATED_PUBLIC / "Notes" / relative
        public_destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, public_destination)

        if suffix in ASSET_EXTENSIONS:
            docs_destination = GENERATED_DOCS / "Notes" / relative
            docs_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, docs_destination)
            counts["static assets"] += 1
        elif suffix in HTML_EXTENSIONS:
            counts["HTML"] += 1

    (GENERATED_PUBLIC / "logo.svg").write_text(BRAND_LOGO, encoding="utf-8")
    social_image = REPOSITORY_ROOT / "assets" / "images" / "og-aosp-notes.png"
    if social_image.is_file():
        shutil.copy2(social_image, GENERATED_PUBLIC / social_image.name)

    root_entry = build_notes_entry(NOTES_DIRECTORY)
    generate_site_data(root_entry)
    generate_home_page()

    if not any((GENERATED_DOCS / "Notes").rglob("*.md")):
        raise RuntimeError("No Markdown or DrawDoc documents were found in Notes/.")
    return counts


def main() -> None:
    counts = prepare_docs()
    summary = ", ".join(
        f"{counts[label]} {label}"
        for label in ("Markdown", "DrawDoc", "HTML", "static assets")
    )
    print(f"Prepared {summary} for VitePress.")


if __name__ == "__main__":
    main()
