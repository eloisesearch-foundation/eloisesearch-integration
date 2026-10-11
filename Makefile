.DEFAULT_GOAL := help
.PHONY: help changelog-check check

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

changelog-check: ## Validate CHANGELOG.md structure
	scripts/check-changelog.sh

check: changelog-check ## What CI runs
