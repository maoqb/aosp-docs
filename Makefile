PYTHON ?= python3

.PHONY: prepare serve build sites-dist clean

prepare:
	$(PYTHON) scripts/prepare_docs.py

serve: prepare
	$(PYTHON) -m mkdocs serve --dev-addr 127.0.0.1:8000

build: prepare
	$(PYTHON) -m mkdocs build --strict

sites-dist: build
	$(PYTHON) scripts/prepare_sites_dist.py

clean:
	rm -rf -- "$(abspath .generated_docs)" "$(abspath site)" "$(abspath dist)"
