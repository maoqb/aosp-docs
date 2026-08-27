#!/usr/bin/env python3
"""Build a disposable MkDocs source tree without changing original notes."""

from __future__ import annotations

import os
import shutil
from collections import Counter
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
GENERATED_DOCS = REPOSITORY_ROOT / ".generated_docs"

# MkDocs renders Markdown and copies every other selected file unchanged.  The
# broad asset list covers normal web dependencies plus diagrams, media and AOSP
# source snippets that a note may expose as a download.
MARKDOWN_EXTENSIONS = {".md", ".markdown", ".mdown", ".mkdn", ".mkd"}
HTML_EXTENSIONS = {".html", ".htm"}
ASSET_EXTENSIONS = {
    # Images and diagrams
    ".apng", ".avif", ".bmp", ".drawio", ".gif", ".ico", ".jpeg", ".jpg",
    ".pdf", ".plantuml", ".puml", ".png", ".svg", ".webp",
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

EXCLUDED_DIRECTORY_NAMES = {
    ".generated_docs",
    ".git",
    ".github",
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
    "node_modules",
    "out",
    "site",
    "venv",
}
EXCLUDED_FILES = {
    Path(".gitignore"),
    Path("Makefile"),
    Path("mkdocs.yml"),
    Path("requirements.txt"),
    Path("scripts/prepare_docs.py"),
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


def prepare_docs() -> Counter[str]:
    """Copy selected files into the generated tree, preserving relative paths."""
    reset_generated_docs()
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

    if not any(
        path.is_file() and path.suffix.lower() in MARKDOWN_EXTENSIONS
        for path in GENERATED_DOCS.rglob("*")
    ):
        raise RuntimeError("No Markdown documents were found; MkDocs needs a home page.")
    return counts


def main() -> None:
    counts = prepare_docs()
    summary = ", ".join(
        f"{counts[label]} {label}" for label in ("Markdown", "HTML", "static assets")
    )
    print(f"Prepared {summary} in {GENERATED_DOCS.relative_to(REPOSITORY_ROOT)}/")


if __name__ == "__main__":
    main()
