UUID := dev-hop@zarrx
ZIP := build/$(UUID).shell-extension.zip

.PHONY: schemas pack install lint test nested

schemas:
	glib-compile-schemas --strict extension/schemas

pack: schemas
	@# gnome-extensions 46 segfaults if --out-dir is missing, so create it first.
	mkdir -p $(CURDIR)/build
	gnome-extensions pack $(CURDIR)/extension --extra-source=$(CURDIR)/extension/src --force --out-dir=$(CURDIR)/build

install: pack
	gnome-extensions install --force $(ZIP)

lint:
	npx --yes @biomejs/biome check extension tests

test:
	gjs -m tests/run.js

nested:
	bash scripts/nested.sh
