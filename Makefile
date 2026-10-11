.DEFAULT_GOAL := help
.PHONY: help test changelog-check check

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

test: ## Unit tests of the harness (no engine needed)
	node --test 'test/*.test.mjs'

changelog-check: ## Validate CHANGELOG.md structure
	scripts/check-changelog.sh

check: test changelog-check ## What CI runs on every change
