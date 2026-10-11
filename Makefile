.DEFAULT_GOAL := help
.PHONY: help test contracts-check changelog-check check

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

test: ## Unit tests of the harness (no engine needed)
	node --test 'test/*.test.mjs'

contracts-check: ## Validate case files and the divergence register
	node harness/validate.mjs

changelog-check: ## Validate CHANGELOG.md structure
	scripts/check-changelog.sh

check: test contracts-check changelog-check ## What CI runs on every change
