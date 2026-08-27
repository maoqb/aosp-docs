PYTHON ?= python3

.PHONY: prepare serve build clean

prepare:
	$(PYTHON) scripts/prepare_docs.py

serve: prepare
	$(PYTHON) -m mkdocs serve --dev-addr 127.0.0.1:8000

build: prepare
	$(PYTHON) -m mkdocs build --strict

clean:
	rm -rf -- "$(abspath .generated_docs)" "$(abspath site)"
