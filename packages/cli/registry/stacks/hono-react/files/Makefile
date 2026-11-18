# Workspace commands. Each part keeps its own package scripts: backend/ (the Hono API) and
# frontend/ (the React app). These targets run them inside the part, so each part's own
# biome.json, tsconfig.json and node_modules apply; never run Biome from this directory.
# The cross-part targets (api-client, check-openapi-copy, smoke, check) are the only logic here.

# Ports: a value exported in the shell wins, then .env, then the default. A plain
# `include .env` would override the shell, so the shell's values are kept before it is read.
shell_PORT_API := $(PORT_API)
shell_PORT_WEB := $(PORT_WEB)
shell_PORT_E2E := $(PORT_E2E)
-include .env
PORT_API := $(or $(shell_PORT_API),$(PORT_API),3000)
PORT_WEB := $(or $(shell_PORT_WEB),$(PORT_WEB),4173)
PORT_E2E := $(or $(shell_PORT_E2E),$(PORT_E2E),4180)
export PORT_API PORT_WEB PORT_E2E

.DEFAULT_GOAL := help
.PHONY: help install dev lint format typecheck test coverage build e2e api-client \
	check-openapi-copy check-api-client smoke check clean

help: ## List targets
	@grep -E '^[a-zA-Z0-9_%-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-20s %s\n", $$1, $$2}'

install: ## Install both parts' dependencies, then the git hooks at the root
	cd backend && bun install $(if $(CI),--frozen-lockfile)
	cd frontend && bun install $(if $(CI),--frozen-lockfile)
	@test -n "$(CI)" || ! test -f lefthook.yml || ! command -v lefthook >/dev/null || lefthook install

dev: ## Both dev servers: the API on PORT_API, Vite on PORT_WEB proxying /api to it
	@trap 'kill 0' INT TERM EXIT; \
	(cd backend && bun run dev) & \
	(cd frontend && bun run dev --port $(PORT_WEB) --strictPort) & \
	wait

lint: ## Biome in each part
	cd backend && bun run lint
	cd frontend && bun run lint

format: ## Biome fixes in each part
	cd backend && bun run format
	cd frontend && bun run format

typecheck: ## tsc in each part
	cd backend && bun run typecheck
	cd frontend && bun run typecheck

test: ## Vitest in each part (neither needs the other running)
	cd backend && bun run test
	cd frontend && bun run test

coverage: ## Vitest with coverage in each part
	cd backend && bun run coverage
	cd frontend && bun run coverage

build: ## The API bundle and the static frontend
	cd backend && bun run build
	cd frontend && bun run build

e2e: ## The frontend's Playwright tests on PORT_E2E (the API is routed in the browser)
	cd frontend && bun run e2e

api-client: ## Write backend/openapi.json, copy it to frontend/ and regenerate the client
	cd backend && bun run openapi
	cp backend/openapi.json frontend/openapi.json
	cd frontend && bun run generate:api

check-openapi-copy: ## Fail if frontend/openapi.json isn't a copy of backend/openapi.json
	@test -f backend/openapi.json || { echo "backend/openapi.json is missing: run make api-client" >&2; exit 1; }
	@cmp -s backend/openapi.json frontend/openapi.json || { echo "frontend/openapi.json differs from backend/openapi.json: run make api-client" >&2; exit 1; }

check-api-client: check-openapi-copy ## Fail if the API's document, its copy or the generated client is stale
	cd backend && bun run check:openapi
	cd frontend && bun run check:api

smoke: ## Build and start both parts, then send requests through the frontend's proxy to the API
	@bash scripts/smoke.sh

check: ## Each part's own check, the contract checks, then the smoke
	cd backend && bun run check
	cd frontend && bun run check
	@$(MAKE) --no-print-directory check-api-client smoke

clean: ## Each part's build, test and coverage output
	cd backend && bun run clean
	cd frontend && bun run clean

backend-%: ## Any backend script: make backend-<script> runs bun run <script> in backend/
	cd backend && bun run $*

frontend-%: ## Any frontend script: make frontend-<script> runs bun run <script> in frontend/
	cd frontend && bun run $*
