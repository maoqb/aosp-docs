#!/usr/bin/env python3
"""Build a disposable MkDocs source tree without changing original notes."""

from __future__ import annotations

import json
import os
import re
import shutil
from collections import Counter
from dataclasses import dataclass, field
from html import escape
from html import unescape
from pathlib import Path
from urllib.parse import quote


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
GENERATED_DOCS = REPOSITORY_ROOT / ".generated_docs"
GENERATED_OVERRIDES = REPOSITORY_ROOT / ".generated_overrides"
NOTES_DIRECTORY = REPOSITORY_ROOT / "Notes"

# MkDocs renders Markdown and copies every other selected file unchanged.  The
# broad asset list covers normal web dependencies plus diagrams, media and AOSP
# source snippets that a note may expose as a download.
MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdown", ".mkdn", ".mkd"}
DRAWDOC_EXTENSION = ".drawdoc"
MARKDOWN_SOURCE_EXTENSIONS = MARKDOWN_EXTENSIONS | {DRAWDOC_EXTENSION}
HTML_EXTENSIONS = {".html", ".htm"}
ASSET_EXTENSIONS = {
    # Images and diagrams
    ".apng", ".avif", ".bmp", ".drawio", ".gif", ".ico", ".jpeg", ".jpg",
    ".pdf", ".plantuml", ".puml", ".png", ".svg", ".webp",
    # Documents that should remain available as downloadable or browser-viewed notes
    ".doc", ".docx", ".odt", ".ppt", ".pptx", ".pps", ".ppsx", ".rtf",
    # Browser resources and structured data
    ".css", ".csv", ".eot", ".js", ".json", ".json5", ".map", ".mjs",
    ".otf", ".toml", ".tsv", ".ttf", ".wasm", ".woff", ".woff2", ".xml",
    ".yaml", ".yml",
    # Audio, video and downloadable archives
    ".gz", ".mp3", ".mp4", ".ogg", ".tar", ".wav", ".webm", ".zip",
    # Common source/config attachments used by Android/AOSP notes
    ".aidl", ".bp", ".c", ".cc", ".conf", ".cpp", ".diff", ".go", ".gradle",
    ".h", ".hpp", ".ini", ".java", ".kt", ".kts", ".log", ".mk", ".patch",
    ".properties", ".proto", ".py", ".rc", ".rs", ".sh", ".sql", ".textproto",
    ".txt",
}
COPY_EXTENSIONS = MARKDOWN_SOURCE_EXTENSIONS | HTML_EXTENSIONS | ASSET_EXTENSIONS
COPY_FILENAMES = {"CNAME", "LICENSE", "NOTICE"}
NAVIGATION_EXTENSIONS = MARKDOWN_SOURCE_EXTENSIONS | HTML_EXTENSIONS | {
    ".doc", ".docx", ".odt", ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".rtf",
}

DRAWDOC_MACRO_PATTERN = re.compile(
    r"^```(?P<kind>drawio|excalidraw|mermaid|mindmap)(?P<params>[^\r\n]*)\r?\n"
    r"(?P<body>.*?)(?:\r?\n)?^```[ \t]*$",
    re.MULTILINE | re.DOTALL,
)

EXCLUDED_DIRECTORY_NAMES = {
    ".generated_docs",
    ".generated_overrides",
    ".docforge",
    ".git",
    ".github",
    ".openai",
    ".playwright-cli",
    ".gradle",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    ".repo",
    ".tox",
    ".venv",
    ".vscode",
    "__pycache__",
    "dist",
    "hooks",
    "node_modules",
    "out",
    "overrides",
    "site",
    "venv",
    "worker",
}
EXCLUDED_FILES = {
    Path(".gitignore"),
    Path("Makefile"),
    Path("mkdocs.yml"),
    Path("requirements.txt"),
    Path("scripts/prepare_docs.py"),
    Path("scripts/prepare_sites_dist.py"),
    Path("scripts/serve.sh"),
}


def is_excluded_directory(relative_path: Path) -> bool:
    """Return whether a path is inside generated, metadata, or cache directories."""
    return any(
        part in EXCLUDED_DIRECTORY_NAMES or part.startswith("bazel-")
        for part in relative_path.parts
    )


def should_copy(relative_path: Path) -> bool:
    """Select documentation and resources while omitting site infrastructure."""
    if relative_path in EXCLUDED_FILES:
        return False
    return (
        relative_path.suffix.lower() in COPY_EXTENSIONS
        or relative_path.name in COPY_FILENAMES
    )


def is_shadowed_by_drawdoc(path: Path) -> bool:
    """Prefer a DrawDoc source when a legacy Markdown export has the same stem."""
    return (
        path.suffix.lower() in MARKDOWN_EXTENSIONS
        and path.with_suffix(DRAWDOC_EXTENSION).is_file()
    )


def published_relative_path(relative_path: Path) -> Path:
    """Map a DrawDoc source to the Markdown path consumed by MkDocs."""
    if relative_path.suffix.lower() == DRAWDOC_EXTENSION:
        return relative_path.with_suffix(".md")
    return relative_path


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
    background_color = (
        app_state.get("viewBackgroundColor")
        if isinstance(app_state, dict)
        else None
    )
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
    """Convert a DrawDocs macro fence to browser-renderable HTML."""
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
        body = f'<pre class="mermaid"><code>{escape(payload)}</code></pre>'
    elif kind == "excalidraw":
        body = excalidraw_svg(payload)
    else:
        body = mindmap_tree(payload)
    return f'\n<div class="{classes}"{style}>\n{body}\n</div>\n'


def convert_drawdoc(content: str) -> str:
    """Convert DrawDocs' Markdown superset into Markdown/HTML understood by MkDocs."""
    return DRAWDOC_MACRO_PATTERN.sub(render_drawdoc_macro, content)


def reset_generated_docs() -> None:
    """Safely recreate only the repository-local generated docs directory."""
    if GENERATED_DOCS.parent != REPOSITORY_ROOT or GENERATED_DOCS.name != ".generated_docs":
        raise RuntimeError(f"Refusing to clean unexpected path: {GENERATED_DOCS}")
    shutil.rmtree(GENERATED_DOCS, ignore_errors=True)
    GENERATED_DOCS.mkdir()


def reset_generated_overrides() -> None:
    """Copy template overrides and add the navigation generated from Notes/."""
    if GENERATED_OVERRIDES.parent != REPOSITORY_ROOT:
        raise RuntimeError(f"Refusing to clean unexpected path: {GENERATED_OVERRIDES}")
    shutil.rmtree(GENERATED_OVERRIDES, ignore_errors=True)
    shutil.copytree(REPOSITORY_ROOT / "overrides", GENERATED_OVERRIDES)


@dataclass
class NotesEntry:
    """A Notes directory or file used to build the site drawer."""

    path: Path
    children: list["NotesEntry"] = field(default_factory=list)


def notes_url(path: Path) -> str:
    """Return the final site URL for a source file relative to the repository."""
    relative_path = path.relative_to(REPOSITORY_ROOT)
    if path.suffix.lower() not in MARKDOWN_SOURCE_EXTENSIONS:
        return quote(relative_path.as_posix(), safe="/-._~")

    stem = relative_path.with_suffix("")
    if path.stem.lower() in {"index", "readme"}:
        stem = stem.parent
    return quote(stem.as_posix().rstrip("/") + "/", safe="/-._~")


def build_notes_entry(path: Path) -> NotesEntry:
    """Recursively collect every Notes file while preserving directory order."""
    if path.is_file():
        return NotesEntry(path)
    children = [
        build_notes_entry(child)
        for child in sorted(path.iterdir(), key=lambda item: (item.is_file(), item.name.lower()))
        if (
            child.is_dir()
            and not is_excluded_directory(child.relative_to(REPOSITORY_ROOT))
        ) or (
            child.suffix.lower() in NAVIGATION_EXTENSIONS
            and not is_shadowed_by_drawdoc(child)
            and not (
                child.suffix.lower() in MARKDOWN_SOURCE_EXTENSIONS
                and child.stem.lower() in {"index", "readme"}
            )
        )
    ]
    return NotesEntry(path, [entry for entry in children if entry.children or entry.path.is_file()])


def markdown_title(path: Path) -> str:
    """Read the first top-level heading for a Markdown navigation label."""
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"^#\s+(.+?)\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else path.stem


def notes_label(path: Path) -> str:
    """Return a reader-friendly label for a Notes file or directory."""
    if path.suffix.lower() in HTML_EXTENSIONS:
        return html_title(path)
    if path.suffix.lower() in MARKDOWN_SOURCE_EXTENSIONS:
        title = markdown_title(path)
        order = re.match(r"(\d{2})-", path.stem)
        return f"{order.group(1)} - {title}" if order else title
    return path.name


def render_notes_entry(entry: NotesEntry, current_path: str, depth: int = 0) -> str:
    """Render an accessible nested list for the Notes drawer partial."""
    label = escape(notes_label(entry.path))
    if entry.path.is_file():
        url = notes_url(entry.path)
        active = ' class="is-active"' if url == current_path else ""
        return f'<li class="notes-file"><a href="{{{{ \'{url}\' | url }}}}"{active}>{label}</a></li>'

    children = "\n".join(render_notes_entry(child, current_path, depth + 1) for child in entry.children)
    open_attribute = " open" if depth < 2 else ""
    return f"<li><details{open_attribute}><summary>{label}</summary><ul>{children}</ul></details></li>"


def generate_notes_navigation() -> None:
    """Create the drawer partial from the complete source tree under Notes/."""
    if not NOTES_DIRECTORY.is_dir():
        raise RuntimeError("Notes directory is required to build the documentation drawer.")

    root_entry = build_notes_entry(NOTES_DIRECTORY)
    navigation = "\n".join(
        render_notes_entry(entry, "") for entry in root_entry.children
    )
    output = GENERATED_OVERRIDES / "partials" / "notes_navigation.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(f'<ul class="notes-tree">{navigation}</ul>\n', encoding="utf-8")


def html_title(path: Path) -> str:
    """Read a useful navigation label from an HTML document's title."""
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(r"<title\b[^>]*>(.*?)</title>", content, re.IGNORECASE | re.DOTALL)
    if not match:
        return path.stem.replace("_", " ").replace("-", " ")
    title = re.sub(r"<[^>]+>", "", match.group(1))
    return unescape(" ".join(title.split())) or path.stem


def markdown_excerpt(path: Path) -> str:
    """Return the first readable paragraph from a Markdown note."""
    content = path.read_text(encoding="utf-8", errors="replace")
    in_code_block = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code_block = not in_code_block
            continue
        if not stripped or in_code_block or stripped.startswith("#") or stripped.startswith(("|", "!")):
            continue
        plain_text = re.sub(r"^>\s*", "", stripped)
        plain_text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", plain_text)
        plain_text = re.sub(r"[`*_]", "", plain_text)
        if plain_text:
            return plain_text[:180].rstrip() + ("…" if len(plain_text) > 180 else "")
    return "Markdown 技术笔记。"


def html_excerpt(path: Path) -> str:
    """Read an HTML description meta tag when one is present."""
    content = path.read_text(encoding="utf-8", errors="replace")
    match = re.search(
        r'<meta\b[^>]*\bname=["\']description["\'][^>]*\bcontent=["\'](.*?)["\']',
        content,
        re.IGNORECASE | re.DOTALL,
    )
    return unescape(" ".join(match.group(1).split())) if match else "HTML 技术笔记。"


def notes_post_excerpt(path: Path) -> str:
    """Return a concise homepage excerpt for a Markdown or HTML note."""
    return html_excerpt(path) if path.suffix.lower() in HTML_EXTENSIONS else markdown_excerpt(path)


def notes_category(path: Path) -> str:
    """Return a reader-facing homepage category from a note's location."""
    categories = {
        "cpp": "C++ / Native",
        "release_config": "Build System",
        "AI-Generated": "Android Framework",
    }
    return categories.get(path.parent.name, path.parent.name)


def notes_tags(path: Path) -> list[str]:
    """Derive concise topic tags from the note title and location."""
    title = notes_label(path).lower()
    if path.parent.name == "cpp":
        tags = ["C++", "Android Native"]
        topic_tags = (
            ("jni", "JNI"),
            ("binder", "Binder"),
            ("aidl", "AIDL"),
            ("refbase", "RefBase"),
            ("bufferqueue", "Graphics"),
            ("surfaceflinger", "SurfaceFlinger"),
            ("线程", "Concurrency"),
            ("智能指针", "Ownership"),
        )
        for keyword, tag in topic_tags:
            if keyword in title:
                tags.append(tag)
        return tags
    if "release_config" in title:
        return ["AOSP", "Build System", "Release Config"]
    if "wms" in title or "systemserver" in title:
        return ["AOSP", "WMS", "SystemServer"]
    if "窗口" in title or "app" in title:
        return ["Android", "WMS", "多窗口"]
    return ["AOSP", "Android Framework"]


def generate_notes_posts() -> None:
    """Create homepage cards by scanning all Markdown, DrawDoc, and HTML notes."""
    documents = sorted(
        (
            path
            for path in NOTES_DIRECTORY.rglob("*")
            if path.is_file()
            and path.suffix.lower() in MARKDOWN_SOURCE_EXTENSIONS | HTML_EXTENSIONS
            and not is_excluded_directory(path.relative_to(REPOSITORY_ROOT))
            and not is_shadowed_by_drawdoc(path)
            and path.stem.lower() not in {"index", "readme"}
        ),
        key=lambda path: notes_label(path).casefold(),
    )
    cards: list[str] = []
    for path in documents:
        title = escape(notes_label(path))
        excerpt = escape(notes_post_excerpt(path))
        url = notes_url(path)
        category = escape(notes_category(path))
        tags = "".join(
            f'<span class="post-tag">{escape(tag)}</span>'
            for tag in notes_tags(path)
        )
        cards.append(
            "<article class=\"index-post\">"
            f"<a class=\"abstract-title\" href=\"{{{{ '{url}' | url }}}}\">"
            f"<span class=\"abstract-title-text\">{title}</span></a>"
            f"<div class=\"abstract-content\"><p>{excerpt}</p></div>"
            "<div class=\"abstract-post-meta\">"
            f"<span class=\"post-category\">⌁ {category}</span>"
            f"<div class=\"abstract-tags\">{tags}</div>"
            "</div></article>"
        )

    output = GENERATED_OVERRIDES / "partials" / "notes_posts.html"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        '<div class="notes-posts">'
        + '\n<div class="index-post-divider"></div>\n'.join(cards)
        + "</div>\n",
        encoding="utf-8",
    )


def generate_html_directory_indexes() -> int:
    """Expose HTML-only directories in MkDocs' Markdown-based navigation."""
    generated_count = 0
    directories = [GENERATED_DOCS]
    directories.extend(path for path in GENERATED_DOCS.rglob("*") if path.is_dir())

    for directory in sorted(directories):
        html_files = sorted(
            path
            for path in directory.iterdir()
            if path.is_file() and path.suffix.lower() in HTML_EXTENSIONS
        )
        if not html_files:
            continue

        has_index = any(
            path.is_file()
            and path.suffix.lower() in MARKDOWN_EXTENSIONS
            and path.stem.lower() in {"index", "readme"}
            for path in directory.iterdir()
        )
        if has_index:
            continue

        relative_directory = directory.relative_to(GENERATED_DOCS)
        directory_title = relative_directory.name if relative_directory.parts else "HTML 页面"
        lines = [
            f"# {directory_title}",
            "",
            "本目录包含以下 HTML 技术笔记：",
            "",
        ]
        for html_file in html_files:
            label = html_title(html_file).replace("[", "\\[").replace("]", "\\]")
            lines.append(f"- [{label}]({quote(html_file.name, safe='-._~')})")
        lines.append("")

        (directory / "README.md").write_text("\n".join(lines), encoding="utf-8")
        generated_count += 1

    return generated_count


def prepare_docs() -> Counter[str]:
    """Copy selected files into the generated tree, preserving relative paths."""
    reset_generated_docs()
    reset_generated_overrides()
    counts: Counter[str] = Counter()

    for current_root, directory_names, file_names in os.walk(
        REPOSITORY_ROOT, followlinks=False
    ):
        source_directory = Path(current_root)
        relative_directory = source_directory.relative_to(REPOSITORY_ROOT)
        directory_names[:] = sorted(
            name
            for name in directory_names
            if not is_excluded_directory(relative_directory / name)
        )

        for file_name in sorted(file_names):
            source = source_directory / file_name
            relative_path = source.relative_to(REPOSITORY_ROOT)
            if not should_copy(relative_path) or is_shadowed_by_drawdoc(source):
                continue

            destination = GENERATED_DOCS / published_relative_path(relative_path)
            destination.parent.mkdir(parents=True, exist_ok=True)

            suffix = source.suffix.lower()
            if suffix == DRAWDOC_EXTENSION:
                content = source.read_text(encoding="utf-8", errors="replace")
                destination.write_text(convert_drawdoc(content), encoding="utf-8")
                counts["DrawDoc"] += 1
            else:
                shutil.copy2(source, destination, follow_symlinks=True)

            if suffix in MARKDOWN_EXTENSIONS:
                counts["Markdown"] += 1
            elif suffix in HTML_EXTENSIONS:
                counts["HTML"] += 1
            elif suffix != DRAWDOC_EXTENSION:
                counts["static assets"] += 1

    counts["HTML directory indexes"] = generate_html_directory_indexes()
    generate_notes_navigation()
    generate_notes_posts()

    if not any(
        path.is_file() and path.suffix.lower() in MARKDOWN_EXTENSIONS
        for path in GENERATED_DOCS.rglob("*")
    ):
        raise RuntimeError("No Markdown documents were found; MkDocs needs a home page.")
    return counts


def main() -> None:
    counts = prepare_docs()
    summary = ", ".join(
        f"{counts[label]} {label}"
        for label in ("Markdown", "DrawDoc", "HTML", "static assets", "HTML directory indexes")
    )
    print(f"Prepared {summary} in {GENERATED_DOCS.relative_to(REPOSITORY_ROOT)}/")


if __name__ == "__main__":
    main()
