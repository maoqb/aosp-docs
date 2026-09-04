#!/usr/bin/env python3
"""Package the validated MkDocs output in the layout expected by Sites."""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
DIST = ROOT / "dist"
WORKER = ROOT / "worker" / "index.js"


def main() -> None:
    if not (SITE / "index.html").is_file():
        raise RuntimeError("Run the MkDocs build before preparing the Sites bundle.")
    if DIST.parent != ROOT or DIST.name != "dist":
        raise RuntimeError(f"Refusing to replace unexpected path: {DIST}")

    shutil.rmtree(DIST, ignore_errors=True)
    shutil.copytree(SITE, DIST / "client")
    (DIST / "server").mkdir(parents=True)
    shutil.copy2(WORKER, DIST / "server" / "index.js")
    print(f"Prepared Sites bundle in {DIST.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
