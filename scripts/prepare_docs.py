#!/usr/bin/env python3
"""Build a disposable MkDocs source tree without changing original notes."""

from __future__ import annotations

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
COPY_EXTENSIONS = MARKDOWN_EXTENSIONS | HTML_EXTENSIONS | ASSET_EXTENSIONS
COPY_FILENAMES = {"CNAME", "LICENSE", "NOTICE"}
NAVIGATION_EXTENSIONS = MARKDOWN_EXTENSIONS | HTML_EXTENSIONS | {
    ".doc", ".docx", ".odt", ".pdf", ".ppt", ".pptx", ".pps", ".ppsx", ".rtf",
}

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
    """Return whether a directory is generated, metadata, or a build cache."""
    name = relative_path.name
    return name in EXCLUDED_DIRECTORY_NAMES or name.startswith("bazel-")


def should_copy(relative_path: Path) -> bool:
    """Select documentation and resources while omitting site infrastructure."""
    if relative_path in EXCLUDED_FILES:
        return False
    return (
        relative_path.suffix.lower() in COPY_EXTENSIONS
        or relative_path.name in COPY_FILENAMES
    )


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
    if path.suffix.lower() not in MARKDOWN_EXTENSIONS:
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
        if child.is_dir() or (
            child.suffix.lower() in NAVIGATION_EXTENSIONS
            and not (
                child.suffix.lower() in MARKDOWN_EXTENSIONS
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
    if path.suffix.lower() in MARKDOWN_EXTENSIONS:
        return markdown_title(path)
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
            if not should_copy(relative_path):
                continue

            destination = GENERATED_DOCS / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination, follow_symlinks=True)

            suffix = source.suffix.lower()
            if suffix in MARKDOWN_EXTENSIONS:
                counts["Markdown"] += 1
            elif suffix in HTML_EXTENSIONS:
                counts["HTML"] += 1
            else:
                counts["static assets"] += 1

    counts["HTML directory indexes"] = generate_html_directory_indexes()
    generate_notes_navigation()

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
        for label in ("Markdown", "HTML", "static assets", "HTML directory indexes")
    )
    print(f"Prepared {summary} in {GENERATED_DOCS.relative_to(REPOSITORY_ROOT)}/")


if __name__ == "__main__":
    main()
