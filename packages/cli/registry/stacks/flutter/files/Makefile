# Every project task. `make help` lists them; verify and CI call these targets.
SHELL := /bin/bash
.DEFAULT_GOAL := help
# macOS ships GNU Make 3.81, which ignores .SHELLFLAGS, so each piped recipe starts with this
# line itself. Without pipefail a failed simulator lookup piped into tail exits 0.
STRICT := set -euo pipefail;

FLUTTER ?= flutter
DART ?= dart
DART_SOURCES := lib test integration_test tool
# Minimum line coverage of lib/ under unit and widget tests, in percent.
COVERAGE_MIN ?= 80

.PHONY: help install fmt lint-fix fmt-check analyze test coverage simulator test-ios build-ios build-android audit ci clean

help: ## List the targets
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z_-]+:.*## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Check ios/ and android/ exist, then fetch packages
	@test -d ios && test -d android || { echo "ios/ or android/ is missing: generate them with flutter create (STACK Setup, docs/DEVELOPMENT.md)" >&2; exit 1; }
	$(FLUTTER) pub get

fmt: ## Format Dart sources
	$(DART) format $(DART_SOURCES)

lint-fix: ## Apply dart fix's safe fixes for analyzer findings, then format
	$(DART) fix --apply
	$(DART) format $(DART_SOURCES)

fmt-check: ## Fail if dart format would change any file
	$(DART) format --output=none --set-exit-if-changed $(DART_SOURCES)

analyze: ## Static analysis with analysis_options.yaml; infos fail too
	$(FLUTTER) analyze

test: ## Unit and widget tests (no device)
	$(FLUTTER) test

coverage: ## Unit and widget tests with lcov output; fails below COVERAGE_MIN
	$(FLUTTER) test --coverage
	@awk -F: -v min=$(COVERAGE_MIN) ' \
		/^LF:/ { total += $$2 } /^LH:/ { hit += $$2 } \
		END { \
			if (total == 0) { print "coverage: coverage/lcov.info has no lines" > "/dev/stderr"; exit 1 } \
			pct = 100 * hit / total; \
			printf "coverage: lib/ %.1f%% of %d lines (minimum %s%%)\n", pct, total, min; \
			if (pct < min) { printf "coverage: below the %s%% floor; add tests or lower COVERAGE_MIN in the Makefile\n", min > "/dev/stderr"; exit 1 } \
		}' coverage/lcov.info

simulator: ## Print the iPhone simulator the iOS targets use, booting it if needed
	@$(STRICT) $(DART) run tool/ios_simulator.dart | tail -n 1

test-ios: ## Integration tests on an iPhone simulator
	@$(STRICT) device=$$($(DART) run tool/ios_simulator.dart | tail -n 1) && test -n "$$device" && \
		echo "flutter test integration_test -d $$device" && \
		$(FLUTTER) test integration_test -d "$$device"

build-ios: ## Debug build for the iOS simulator, unsigned
	$(FLUTTER) build ios --simulator --debug --no-codesign

build-android: ## Debug APK (needs the Android SDK)
	$(FLUTTER) build apk --debug

audit: ## Check pubspec.lock for known vulnerabilities (osv-scanner; needs the network)
	@command -v osv-scanner >/dev/null || { echo "osv-scanner not found. Install it: https://google.github.io/osv-scanner/installation/" >&2; exit 1; }
	osv-scanner scan source -L pubspec.lock

ci: fmt-check analyze coverage build-ios test-ios ## Everything verify runs on a Mac

clean: ## Remove build output
	$(FLUTTER) clean
