PYTHON ?= python3
NPM ?= npm

.PHONY: install prepare serve build preview clean

install:
	$(NPM) ci

prepare:
	$(PYTHON) scripts/prepare_docs.py

serve: prepare
	$(NPM) run docs:dev -- --host 127.0.0.1 --port 5173

build: prepare
	$(NPM) run docs:build

preview: build
	$(NPM) run docs:preview -- --host 127.0.0.1 --port 4173

clean:
	rm -rf -- "$(abspath .generated_docs)" "$(abspath .generated_public)" "$(abspath .generated_vitepress)" "$(abspath .vitepress/cache)" "$(abspath dist)"
