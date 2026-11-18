# Workspace commands. Each target runs a part's own command inside that part: backend/ through
# its Makefile, frontend/ through bun run. The cross-part targets (api-client, check-api-copy,
# check-api-client, check-pair) are the only logic here. Run `make help` for the list.

# The root .env reaches both parts only through this file's export. A name already exported in
# the shell keeps its value: it is marked override before .env is read, so .env can't replace it.
ENV_NAMES := $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env 2>/dev/null)
$(foreach name,$(ENV_NAMES),$(if $(filter environment,$(origin $(name))),$(eval override $(name) := $$($(name)))))
-include .env
PORT_API ?= 8000
PORT_WEB ?= 4173
export $(ENV_NAMES) PORT_API PORT_WEB

MAKEFLAGS += --no-print-directory
FRONTEND := cd frontend &&

.DEFAULT_GOAL := help
.PHONY: help install lint format typecheck test coverage build e2e dev openapi check-openapi \
	api-client check-api-copy check-api-client check-pair check-docs check clean

help: ## List targets
	@grep -E '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

install: ## Install both parts, then the root git hooks outside CI
	$(MAKE) -C backend install
	$(FRONTEND) bun install $(if $(CI),--frozen-lockfile)
	@if [ -z "$(CI)" ] && [ -f lefthook.yml ] && command -v lefthook >/dev/null 2>&1; then lefthook install; fi

lint: ## Lint both parts, each inside its own directory
	$(MAKE) -C backend lint
	$(FRONTEND) bun run lint

format: ## Format both parts
	$(MAKE) -C backend format
	$(FRONTEND) bun run format

typecheck: ## Typecheck both parts
	$(MAKE) -C backend typecheck
	$(FRONTEND) bun run typecheck

test: ## Both parts' tests
	$(MAKE) -C backend test
	$(FRONTEND) bun run test

coverage: ## Both parts' tests with coverage
	$(MAKE) -C backend coverage
	$(FRONTEND) bun run coverage

build: ## Build the frontend
	$(FRONTEND) bun run build

e2e: ## The frontend's Playwright tests
	$(FRONTEND) bun run e2e

dev: ## Both dev servers; the frontend proxies /api to the API
	@trap 'kill 0' INT TERM; \
	$(MAKE) -C backend dev & \
	($(FRONTEND) bun run dev --port $(PORT_WEB) --strictPort) & \
	wait

openapi: ## Write backend/openapi.json
	$(MAKE) -C backend openapi

check-openapi: ## Fail when backend/openapi.json is stale
	$(MAKE) -C backend check-openapi

api-client: openapi ## Dump the backend's OpenAPI document, copy it to frontend/openapi.json and regenerate the client
	cp backend/openapi.json frontend/openapi.json
	$(FRONTEND) bun run generate:api

check-api-copy: ## Fail when frontend/openapi.json differs from backend/openapi.json
	@cmp -s backend/openapi.json frontend/openapi.json \
		|| { echo "frontend/openapi.json differs from backend/openapi.json: run make api-client"; exit 1; }

check-api-client: check-openapi check-api-copy ## The whole contract chain, backend document to generated client
	$(FRONTEND) bun run check:api

check-pair: ## Start the API and the frontend's dev server and send one request per resource through the proxy
	@bash scripts/check-pair.sh

check-docs: ## Fail on unfilled root docs or a root AGENTS.md missing its links
	@! grep -n 'stacks:fill' README.md docs/ARCHITECTURE.md AGENTS.md \
		|| { echo "fill the stacks:fill markers above"; exit 1; }
	@for doc in docs/ARCHITECTURE.md backend/AGENTS.md frontend/AGENTS.md; do \
		test -s "$$doc" || { echo "$$doc is missing or empty"; exit 1; }; \
		grep -q "$$doc" AGENTS.md || { echo "AGENTS.md doesn't link $$doc"; exit 1; }; \
	done

check: lint typecheck coverage e2e check-api-client check-pair ## The full check, every part's checks and both cross-part checks

clean: ## Both parts' generated output
	$(MAKE) -C backend clean
	$(FRONTEND) bun run clean
