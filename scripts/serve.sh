#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPOSITORY_ROOT=$(dirname -- "$SCRIPT_DIR")

cd "$REPOSITORY_ROOT"
python3 scripts/prepare_docs.py
exec npm run docs:dev -- --host 127.0.0.1 --port 5173
