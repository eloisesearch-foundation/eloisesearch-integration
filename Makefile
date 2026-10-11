.DEFAULT_GOAL := help
.PHONY: help test contracts-check changelog-check check \
	reference-up reference-test reference-report reference-down eloisesearch-test

# Which references the reference-* targets use: REF=elasticsearch or REF=opensearch.
REF ?= elasticsearch opensearch
COMPOSE := docker compose -f compose.reference.yml

help: ## List available targets
	@grep -E '^[a-zA-Z_-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

test: ## Unit tests of the harness (no engine needed)
	node --test 'test/*.test.mjs'

contracts-check: ## Validate case files and the divergence register
	node harness/validate.mjs

changelog-check: ## Validate CHANGELOG.md structure
	scripts/check-changelog.sh

check: test contracts-check changelog-check ## What CI runs on every change

reference-up: ## Start the pinned references (REF=...) and wait until ready
	$(COMPOSE) up -d $(REF)
	@for engine in $(REF); do node harness/wait.mjs --engine $$engine || exit 1; done

reference-test: ## Run every case against each reference (REF=...)
	@status=0; for engine in $(REF); do node harness/run.mjs --engine $$engine || status=1; done; exit $$status

reference-report: ## Write reports/summary.md from the latest reports
	node harness/report.mjs

reference-down: ## Stop the references and remove their data
	$(COMPOSE) down -v --remove-orphans

eloisesearch-test: ## Run the cases against Eloisesearch on :7700 (report only)
	node harness/run.mjs --engine eloisesearch
