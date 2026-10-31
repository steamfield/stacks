# Search lexical evaluation, 2026-10-28

Baseline after merging main and resolving the discovery conflicts in e0bd75b. All 36
first-result judgments and all four no-match judgments pass. The golden gate is now
`{ "mrr": 1, "recallAt3": 0.98, "fragmentRecallAt5": 1 }`, this ranking's first passing numbers.

The bundled cards were approved by a maintainer. The subsequent AI-chat request added to
react-router's card is pending renewed approval (`reviewedAt: null`); this run neither
approves nor restamps it. Registry content is unchanged by this follow-up.

The commands below make no model calls. Metrics use the full ranking; each query shows its
first five hits per kind. The real `--embeddings` comparison remains a maintainer step
requiring their provider key. Automated embedding checks use local fake providers only,
including a regression with more than twenty stacks.

With sidecars, MRR is 1.0000 versus 0.8563 without; recall@3 is 0.9800 versus 0.8833;
fragment recall@5 is 1.0000 in both. First-result checks improve from 30/36 to 36/36, and
no-match checks from 3/4 to 4/4.

## With sidecars

```text
$ bun scripts/search-eval.ts
Lexical: MRR 1.0000 | recall@3 0.9800 | fragment recall@5 1.0000 | first 36/36 | no-match 4/4

Pool | metrics
--- | ---
tune | MRR 1.0000 | recall@3 0.9667 | fragment recall@5 1.0000 | first 22/22 | no-match 3/3
holdout | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 1.0000 | first 14/14 | no-match 1/1
platform | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 0.0000 | first 6/6 | no-match 0/0
product | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 1.0000 | first 5/5 | no-match 0/0
paraphrase | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 0.0000 | first 4/4 | no-match 0/0
trap | MRR 1.0000 | recall@3 0.8333 | fragment recall@5 0.0000 | first 1/1 | no-match 0/0
fragment | MRR 0.0000 | recall@3 0.0000 | fragment recall@5 1.0000 | first 14/14 | no-match 0/0
combined | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 1.0000 | first 6/6 | no-match 0/0
no-match | MRR 1.0000 | recall@3 0.0000 | fragment recall@5 0.0000 | first 0/0 | no-match 4/4

Holdout paraphrase: MRR 1.0000 | recall@3 1.0000 | fragment recall@5 0.0000 | first 2/2 | no-match 0/0
platform-phone-backend: an iPhone and Android app with a backend
Lexical stacks: mobile-expo (strong, 0.949), python-react (partial, 0.932), react-router (partial, 0.911), astro-api (partial, 0.901), typescript-api (partial, 0.879)
Lexical fragments: docker-deploy (weak, 0.186), postgres (weak, 0.166), ci-github (weak, 0.014), rr (weak, 0.013), clerk (weak, 0.012)

platform-macos: a macOS desktop app
Lexical stacks: tauri-react (strong, 0.978), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: bun-release (weak, 0.177), goreleaser (weak, 0.109), agent-ops (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)

platform-go: a command line tool in Go
Lexical stacks: go-cli (strong, 0.986), typescript-cli (partial, 0.909), python-react (weak, 0.235), typescript-api (weak, 0.032), mobile-expo (weak, 0.021)
Lexical fragments: goreleaser (partial, 0.515), rr (partial, 0.328), agent-ops (partial, 0.297), claude-harness (weak, 0.114), openrouter-chat-cli (weak, 0.111)

platform-go-short: go cli
Lexical stacks: go-cli (strong, 0.982), typescript-cli (partial, 0.887), mobile-expo (weak, 0.016), typescript-api (weak, 0.014), tauri-react (weak, 0.013)
Lexical fragments: goreleaser (strong, 0.508), openrouter-chat-cli (weak, 0.131), agent-ops (weak, 0.020), ci-github (weak, 0.011), ce-plugin (weak, 0.009)

platform-typescript-terminal: a command line tool in TypeScript
Lexical stacks: typescript-cli (strong, 0.978), go-cli (partial, 0.926), typescript-api (partial, 0.788), python-react (partial, 0.713), tauri-react (partial, 0.701)
Lexical fragments: claude-harness (partial, 0.500), rr (partial, 0.331), openrouter-chat-cli (partial, 0.321), agent-ops (partial, 0.303), effect-schema (weak, 0.165)

platform-worker: a React website running on Cloudflare Workers with server rendering
Lexical stacks: cloudflare-react-router (strong, 0.987), react-router (strong, 0.978), astro-api (strong, 0.967), python-react (strong, 0.949), astro-blog (partial, 0.905)
Lexical fragments: cloudflare-d1 (partial, 0.627), cloudflare-pages (partial, 0.537), openrouter-chat (partial, 0.398), openrouter-ai (partial, 0.281), agent-ops (partial, 0.270)

product-mdx-blog: a personal blog with MDX posts
Lexical stacks: astro-blog (strong, 0.984), python-react (weak, 0.149), astro-api (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: rr (partial, 0.253), posthog (weak, 0.033), cloudflare-pages (weak, 0.017), agent-ops (weak, 0.017), ce-plugin (weak, 0.016)

product-typescript-rest: a REST API in TypeScript
Lexical stacks: typescript-api (strong, 0.978), astro-api (strong, 0.965), python-react (strong, 0.964), cloudflare-react-router (strong, 0.846), react-router (strong, 0.844)
Lexical fragments: rest-api (strong, 0.643), claude-harness (partial, 0.429), effect (partial, 0.377), effect-schema (weak, 0.168), openrouter-ai (weak, 0.157)

product-ai-chat: an AI chat web app
Lexical stacks: react-router (strong, 0.969), cloudflare-react-router (partial, 0.952), python-react (partial, 0.860), astro-blog (partial, 0.839), astro-api (partial, 0.787)
Lexical fragments: openrouter-chat (strong, 0.655), openrouter-ai (partial, 0.414), posthog (partial, 0.410), openrouter-chat-cli (partial, 0.348), bun-release (weak, 0.019)

product-fastapi-spa: a FastAPI backend and a React single page app
Lexical stacks: python-react (strong, 0.978), react-router (strong, 0.978), cloudflare-react-router (strong, 0.960), astro-api (partial, 0.938), typescript-api (partial, 0.879)
Lexical fragments: cloudflare-pages (partial, 0.309), docker-deploy (weak, 0.208), posthog (weak, 0.204), ci-github (weak, 0.190), postgres (weak, 0.186)

product-astro-effect: an Astro site with React islands and a separate Effect API
Lexical stacks: astro-api (strong, 0.988), python-react (partial, 0.977), react-router (partial, 0.973), typescript-api (partial, 0.970), cloudflare-react-router (partial, 0.951)
Lexical fragments: effect (partial, 0.657), rest-api (partial, 0.456), effect-schema (partial, 0.425), postgres (partial, 0.318), cloudflare-pages (weak, 0.249)

paraphrase-workouts: something people install on their phone to log workouts
Lexical stacks: mobile-expo (partial, 0.908), typescript-api (partial, 0.778), react-router (partial, 0.778), typescript-cli (partial, 0.689), astro-api (weak, 0.077)
Lexical fragments: clerk (partial, 0.394), bun-release (partial, 0.381), git-hooks (weak, 0.209), rr (weak, 0.197), docker-deploy (weak, 0.012)

paraphrase-rename: a tool I run in my terminal to rename files
Lexical stacks: go-cli (strong, 0.934), typescript-cli (partial, 0.926), astro-blog (partial, 0.785), python-react (partial, 0.559), typescript-api (partial, 0.423)
Lexical fragments: openrouter-chat-cli (partial, 0.472), git-hooks (partial, 0.459), rr (partial, 0.375), ci-github (partial, 0.328), claude-harness (partial, 0.294)

paraphrase-brochure: mostly prebuilt pages, a few interactive widgets, and a typed Node backend they can call
Lexical stacks: astro-api (strong, 0.979), react-router (strong, 0.967), python-react (strong, 0.958), cloudflare-react-router (strong, 0.943), typescript-api (partial, 0.962)
Lexical fragments: cloudflare-d1 (partial, 0.418), posthog (partial, 0.351), cloudflare-pages (partial, 0.307), openrouter-chat (partial, 0.304), docker-deploy (weak, 0.229)

paraphrase-computer: an installable window on my computer with Rust doing the work behind the buttons
Lexical stacks: tauri-react (strong, 0.980), mobile-expo (partial, 0.754), cloudflare-react-router (partial, 0.638), go-cli (partial, 0.621), python-react (weak, 0.114)
Lexical fragments: agent-ops (weak, 0.214), rr (weak, 0.132), goreleaser (weak, 0.093), clerk (weak, 0.051), ce-plugin (weak, 0.050)

paraphrase-server-pages: render pages on a Node server and handle form submissions in the same React project
Lexical stacks: react-router (strong, 0.985), cloudflare-react-router (strong, 0.981), python-react (strong, 0.957), astro-api (strong, 0.955), typescript-api (partial, 0.940)
Lexical fragments: openrouter-chat (partial, 0.412), openrouter-ai (partial, 0.382), effect-schema (partial, 0.318), cloudflare-pages (partial, 0.307), agent-ops (weak, 0.244)

trap-ios-health: an iOS health app
Lexical stacks: mobile-expo (strong, 0.903), react-router (weak, 0.075), python-react (weak, 0.069), typescript-api (weak, 0.067), astro-api (weak, 0.037)
Lexical fragments: cloudflare-d1 (weak, 0.047), docker-deploy (weak, 0.013), clerk (weak, 0.013), postgres (weak, 0.004), openrouter-chat (weak, 0.003)

trap-monitoring: a monitoring dashboard
Lexical stacks: cloudflare-react-router (strong, 0.770), react-router (strong, 0.770), python-react (strong, 0.713), astro-api (weak, 0.000), astro-blog (weak, 0.000)
Lexical fragments: cloudflare-pages (weak, 0.038), agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)

trap-student-tests: a test prep app for students
Lexical stacks: cloudflare-react-router (strong, 0.846), go-cli (strong, 0.714), python-react (strong, 0.639), typescript-cli (strong, 0.554), mobile-expo (partial, 0.575)
Lexical fragments: rr (partial, 0.338), postgres (partial, 0.328), git-hooks (partial, 0.265), effect (partial, 0.262), claude-harness (partial, 0.255)

fragment-mobile-signin: sign-in for my mobile app
Lexical stacks: mobile-expo (strong, 0.967), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: clerk (strong, 0.513), posthog (weak, 0.094), agent-ops (weak, 0.019), bun-release (weak, 0.000), ce-plugin (weak, 0.000)

fragment-fastapi-postgres: a Postgres database for my FastAPI app
Lexical stacks: mobile-expo (strong, 0.939), python-react (partial, 0.904), typescript-api (weak, 0.150), astro-api (weak, 0.000), astro-blog (weak, 0.000)
Lexical fragments: postgres (strong, 0.732), cloudflare-d1 (partial, 0.413), ce-plugin (weak, 0.019), docker-deploy (weak, 0.018), agent-ops (weak, 0.013)

fragment-go-release: release binaries for my Go CLI
Lexical stacks: go-cli (strong, 0.982), typescript-cli (partial, 0.888), mobile-expo (weak, 0.026), tauri-react (weak, 0.023), typescript-api (weak, 0.021)
Lexical fragments: goreleaser (strong, 0.735), bun-release (partial, 0.469), openrouter-chat-cli (weak, 0.134), agent-ops (weak, 0.027), docker-deploy (weak, 0.025)

fragment-analytics: product analytics
Lexical stacks: python-react (partial, 0.280), tauri-react (partial, 0.253), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000)
Lexical fragments: posthog (strong, 0.712), cloudflare-d1 (weak, 0.021), ce-plugin (weak, 0.020), agent-ops (weak, 0.000), bun-release (weak, 0.000)

fragment-ci-hooks: run tests on GitHub pull requests and check my code before commits
Lexical stacks: typescript-api (partial, 0.947), python-react (partial, 0.933), tauri-react (partial, 0.899), react-router (partial, 0.888), astro-blog (partial, 0.887)
Lexical fragments: ci-github (strong, 0.810), git-hooks (strong, 0.751), rr (strong, 0.605), cloudflare-pages (partial, 0.570), claude-harness (partial, 0.451)

fragment-agent-guidance: shared project instructions for coding agents and guards against destructive shell commands
Lexical stacks: go-cli (partial, 0.946), typescript-cli (partial, 0.942), mobile-expo (partial, 0.919), astro-api (partial, 0.820), tauri-react (partial, 0.814)
Lexical fragments: agent-ops (strong, 0.808), claude-harness (partial, 0.756), rest-api (partial, 0.526), effect (partial, 0.494), rr (partial, 0.472)

fragment-claude-harness: reusable TypeScript hooks and review commands for Claude Code
Lexical stacks: typescript-cli (partial, 0.969), mobile-expo (partial, 0.954), python-react (partial, 0.933), typescript-api (partial, 0.927), tauri-react (partial, 0.925)
Lexical fragments: claude-harness (strong, 0.817), ce-plugin (strong, 0.749), agent-ops (strong, 0.713), git-hooks (partial, 0.500), rr (partial, 0.441)

fragment-essentials: enable Claude Essentials skills for debugging and code review in this project
Lexical stacks: react-router (partial, 0.822), tauri-react (partial, 0.817), astro-api (partial, 0.802), typescript-cli (partial, 0.736), typescript-api (partial, 0.387)
Lexical fragments: ce-plugin (strong, 0.852), claude-harness (partial, 0.680), agent-ops (partial, 0.606), rest-api (partial, 0.340), clerk (partial, 0.280)

fragment-boundary-schema: use Effect schemas to validate config and generate JSON Schema for tools
Lexical stacks: typescript-cli (partial, 0.951), typescript-api (partial, 0.933), cloudflare-react-router (partial, 0.929), mobile-expo (partial, 0.918), go-cli (partial, 0.904)
Lexical fragments: effect-schema (strong, 0.820), effect (partial, 0.569), openrouter-chat-cli (partial, 0.385), postgres (partial, 0.354), openrouter-chat (weak, 0.186)

fragment-virtual-time: test Effect services with isolated layers and virtual time
Lexical stacks: react-router (partial, 0.951), typescript-api (partial, 0.946), typescript-cli (partial, 0.937), astro-api (partial, 0.895), cloudflare-react-router (partial, 0.869)
Lexical fragments: effect (strong, 0.828), postgres (partial, 0.564), effect-schema (partial, 0.527), cloudflare-d1 (partial, 0.459), rr (partial, 0.340)

fragment-remote-checks: offload my tests and builds to another machine over SSH
Lexical stacks: typescript-cli (partial, 0.862), cloudflare-react-router (partial, 0.850), astro-api (partial, 0.732), go-cli (partial, 0.728), astro-blog (partial, 0.694)
Lexical fragments: rr (strong, 0.707), docker-deploy (partial, 0.356), goreleaser (partial, 0.356), postgres (partial, 0.328), bun-release (partial, 0.292)

fragment-bun-binaries: ship my Bun compiled CLI with a checksum verified installer and self update
Lexical stacks: typescript-cli (partial, 0.975), go-cli (partial, 0.948), tauri-react (partial, 0.743), astro-api (partial, 0.665), mobile-expo (partial, 0.594)
Lexical fragments: bun-release (strong, 0.813), goreleaser (partial, 0.436), openrouter-chat-cli (partial, 0.354), claude-harness (partial, 0.297), clerk (weak, 0.064)

fragment-provider: add OpenRouter model discovery and provider configuration to my TypeScript API
Lexical stacks: typescript-api (partial, 0.973), astro-api (partial, 0.966), python-react (partial, 0.965), typescript-cli (partial, 0.896), mobile-expo (partial, 0.889)
Lexical fragments: openrouter-ai (strong, 0.809), openrouter-chat (partial, 0.643), claude-harness (partial, 0.460), rest-api (partial, 0.453), effect (partial, 0.429)

fragment-rest-conventions: consistent resource URLs, status codes and cursor pagination for my API
Lexical stacks: typescript-api (strong, 0.976), astro-api (partial, 0.967), python-react (partial, 0.959), react-router (partial, 0.912), cloudflare-react-router (partial, 0.907)
Lexical fragments: rest-api (strong, 0.828), ce-plugin (partial, 0.389), effect (partial, 0.365), agent-ops (partial, 0.361), git-hooks (partial, 0.344)

fragment-worker-database: local SQLite storage with migrations for my Cloudflare Worker
Lexical stacks: cloudflare-react-router (strong, 0.980), astro-blog (partial, 0.850), react-router (partial, 0.675), mobile-expo (weak, 0.190), tauri-react (weak, 0.137)
Lexical fragments: cloudflare-d1 (strong, 0.785), postgres (strong, 0.600), cloudflare-pages (partial, 0.537), openrouter-ai (partial, 0.327), clerk (partial, 0.327)

combined-blog-pages: a static blog deployed to Cloudflare
Lexical stacks: astro-blog (strong, 0.974), cloudflare-react-router (partial, 0.944), astro-api (partial, 0.941), react-router (weak, 0.112), typescript-cli (weak, 0.104)
Lexical fragments: cloudflare-pages (strong, 0.683), cloudflare-d1 (partial, 0.489), posthog (weak, 0.018), agent-ops (weak, 0.017), effect (weak, 0.012)

combined-go-release: a Go command line tool with tagged cross platform binary releases
Lexical stacks: go-cli (strong, 0.986), typescript-cli (strong, 0.974), mobile-expo (partial, 0.713), typescript-api (partial, 0.659), python-react (partial, 0.514)
Lexical fragments: goreleaser (strong, 0.791), bun-release (strong, 0.769), rr (partial, 0.328), openrouter-chat-cli (partial, 0.318), claude-harness (partial, 0.301)

combined-worker-d1: a React app on Cloudflare Workers backed by D1
Lexical stacks: cloudflare-react-router (strong, 0.983), react-router (partial, 0.961), python-react (partial, 0.949), tauri-react (partial, 0.945), mobile-expo (partial, 0.871)
Lexical fragments: cloudflare-d1 (strong, 0.741), cloudflare-pages (partial, 0.537), openrouter-chat-cli (weak, 0.021), postgres (weak, 0.014), docker-deploy (weak, 0.011)

combined-python-database: a Python FastAPI and React app with Postgres and database migrations
Lexical stacks: python-react (strong, 0.982), react-router (partial, 0.879), mobile-expo (partial, 0.854), tauri-react (partial, 0.837), cloudflare-react-router (partial, 0.834)
Lexical fragments: postgres (strong, 0.774), cloudflare-d1 (partial, 0.285), docker-deploy (weak, 0.063), ce-plugin (weak, 0.045), agent-ops (weak, 0.033)

combined-node-container: a standalone TypeScript HTTP API published as a Docker image to GHCR
Lexical stacks: typescript-api (partial, 0.982), astro-api (partial, 0.971), python-react (partial, 0.965), react-router (partial, 0.899), mobile-expo (partial, 0.890)
Lexical fragments: docker-deploy (partial, 0.756), rest-api (partial, 0.590), claude-harness (partial, 0.428), effect (partial, 0.382), postgres (partial, 0.339)

combined-terminal-chat: an AI chat tool in my terminal with a TypeScript codebase
Lexical stacks: typescript-cli (strong, 0.967), react-router (partial, 0.855), typescript-api (partial, 0.789), go-cli (partial, 0.764), tauri-react (partial, 0.698)
Lexical fragments: openrouter-chat-cli (strong, 0.696), openrouter-ai (partial, 0.426), claude-harness (partial, 0.425), openrouter-chat (partial, 0.321), effect-schema (weak, 0.165)

nomatch-firmware: firmware for a microcontroller
Lexical stacks: astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000), mobile-expo (weak, 0.000)
Lexical fragments: agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000), claude-harness (weak, 0.000)

nomatch-unity: a Unity game
Lexical stacks: astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000), mobile-expo (weak, 0.000)
Lexical fragments: agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000), claude-harness (weak, 0.000)

nomatch-kotlin: an Android-only app in Kotlin
Lexical stacks: mobile-expo (partial, 0.723), tauri-react (partial, 0.256), typescript-cli (weak, 0.002), typescript-api (weak, 0.002), react-router (weak, 0.002)
Lexical fragments: ci-github (partial, 0.278), agent-ops (weak, 0.001), git-hooks (weak, 0.001), ce-plugin (weak, 0.001), rr (weak, 0.001)

nomatch-swiftui: a native SwiftUI iPhone app
Lexical stacks: mobile-expo (partial, 0.739), tauri-react (partial, 0.266), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000)
Lexical fragments: bun-release (weak, 0.007), openrouter-chat-cli (weak, 0.002), openrouter-chat (weak, 0.001), agent-ops (weak, 0.000), ce-plugin (weak, 0.000)

nomatch-tui-cli: a cli with a good TUI experience
Lexical stacks: typescript-cli (partial, 0.915), go-cli (partial, 0.900), mobile-expo (weak, 0.052), astro-api (weak, 0.000), astro-blog (weak, 0.000)
Lexical fragments: openrouter-chat-cli (partial, 0.407), bun-release (weak, 0.032), effect (weak, 0.015), goreleaser (weak, 0.014), effect-schema (weak, 0.011)

nomatch-python-cli: a command line tool in Python
Lexical stacks: go-cli (partial, 0.926), python-react (partial, 0.907), typescript-cli (partial, 0.891), mobile-expo (weak, 0.021), typescript-api (weak, 0.019)
Lexical fragments: rr (partial, 0.330), claude-harness (partial, 0.308), agent-ops (partial, 0.305), bun-release (weak, 0.146), openrouter-chat-cli (weak, 0.114)

nomatch-gpu-training: train a neural network on a GPU cluster
Lexical stacks: astro-api (weak, 0.231), cloudflare-react-router (weak, 0.219), typescript-api (weak, 0.163), python-react (weak, 0.149), astro-blog (weak, 0.000)
Lexical fragments: clerk (weak, 0.173), bun-release (weak, 0.021), agent-ops (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)
```

## Without sidecars

```text
$ bun scripts/search-eval.ts --without-sidecars
Lexical: MRR 0.8563 | recall@3 0.8833 | fragment recall@5 1.0000 | first 30/36 | no-match 3/4

Pool | metrics
--- | ---
tune | MRR 0.8519 | recall@3 0.9167 | fragment recall@5 1.0000 | first 18/22 | no-match 2/3
holdout | MRR 0.8636 | recall@3 0.8333 | fragment recall@5 1.0000 | first 12/14 | no-match 1/1
platform | MRR 0.9167 | recall@3 1.0000 | fragment recall@5 0.0000 | first 5/6 | no-match 0/0
product | MRR 0.8667 | recall@3 1.0000 | fragment recall@5 1.0000 | first 4/5 | no-match 0/0
paraphrase | MRR 0.6000 | recall@3 0.7000 | fragment recall@5 0.0000 | first 1/4 | no-match 0/0
trap | MRR 0.8333 | recall@3 0.5278 | fragment recall@5 0.0000 | first 1/1 | no-match 0/0
fragment | MRR 0.0000 | recall@3 0.0000 | fragment recall@5 1.0000 | first 13/14 | no-match 0/0
combined | MRR 1.0000 | recall@3 1.0000 | fragment recall@5 1.0000 | first 6/6 | no-match 0/0
no-match | MRR 0.8750 | recall@3 0.0000 | fragment recall@5 0.0000 | first 0/0 | no-match 3/4

Holdout paraphrase: MRR 0.2500 | recall@3 0.5000 | fragment recall@5 0.0000 | first 0/2 | no-match 0/0
platform-phone-backend: an iPhone and Android app with a backend
Lexical stacks: python-react (strong, 0.819), mobile-expo (weak, 0.234), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000)
Lexical fragments: postgres (weak, 0.021), ci-github (weak, 0.014), docker-deploy (weak, 0.013), rr (weak, 0.013), clerk (weak, 0.012)

platform-macos: a macOS desktop app
Lexical stacks: tauri-react (strong, 0.929), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: goreleaser (weak, 0.023), agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)

platform-go: a command line tool in Go
Lexical stacks: go-cli (strong, 0.965), typescript-cli (partial, 0.742), typescript-api (partial, 0.268), mobile-expo (weak, 0.196), tauri-react (weak, 0.182)
Lexical fragments: goreleaser (partial, 0.259), claude-harness (weak, 0.135), openrouter-chat-cli (weak, 0.128), agent-ops (weak, 0.120), rr (weak, 0.113)

platform-go-short: go cli
Lexical stacks: go-cli (strong, 0.970), typescript-cli (strong, 0.940), mobile-expo (weak, 0.155), typescript-api (weak, 0.132), tauri-react (weak, 0.123)
Lexical fragments: openrouter-chat-cli (partial, 0.335), goreleaser (partial, 0.266), agent-ops (weak, 0.020), effect (weak, 0.015), bun-release (weak, 0.012)

platform-typescript-terminal: a command line tool in TypeScript
Lexical stacks: typescript-cli (strong, 0.945), go-cli (strong, 0.883), typescript-api (partial, 0.911), tauri-react (partial, 0.472), astro-api (partial, 0.470)
Lexical fragments: claude-harness (partial, 0.289), openrouter-chat-cli (weak, 0.158), agent-ops (weak, 0.116), rr (weak, 0.107), openrouter-chat (weak, 0.050)

platform-worker: a React website running on Cloudflare Workers with server rendering
Lexical stacks: cloudflare-react-router (strong, 0.971), react-router (partial, 0.922), tauri-react (partial, 0.921), python-react (partial, 0.920), astro-api (partial, 0.789)
Lexical fragments: cloudflare-d1 (partial, 0.478), cloudflare-pages (partial, 0.443), openrouter-ai (weak, 0.202), openrouter-chat (weak, 0.196), postgres (weak, 0.029)

product-mdx-blog: a personal blog with MDX posts
Lexical stacks: astro-blog (strong, 0.969), python-react (weak, 0.149), astro-api (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: posthog (weak, 0.033), rr (weak, 0.033), cloudflare-pages (weak, 0.017), agent-ops (weak, 0.017), ce-plugin (weak, 0.016)

product-typescript-rest: a REST API in TypeScript
Lexical stacks: typescript-api (strong, 0.961), typescript-cli (partial, 0.936), astro-api (partial, 0.929), mobile-expo (partial, 0.898), python-react (partial, 0.881)
Lexical fragments: rest-api (strong, 0.521), claude-harness (weak, 0.203), effect (weak, 0.163), clerk (weak, 0.102), effect-schema (weak, 0.049)

product-ai-chat: an AI chat web app
Lexical stacks: typescript-api (partial, 0.765), astro-blog (partial, 0.579), react-router (partial, 0.558), astro-api (partial, 0.556), python-react (partial, 0.550)
Lexical fragments: openrouter-chat (strong, 0.554), openrouter-chat-cli (strong, 0.520), openrouter-ai (partial, 0.317), posthog (weak, 0.221), bun-release (weak, 0.019)

product-fastapi-spa: a FastAPI backend and a React single page app
Lexical stacks: python-react (strong, 0.965), react-router (partial, 0.921), tauri-react (partial, 0.917), cloudflare-react-router (partial, 0.912), astro-blog (partial, 0.787)
Lexical fragments: cloudflare-pages (partial, 0.453), postgres (weak, 0.030), agent-ops (weak, 0.026), rr (weak, 0.025), docker-deploy (weak, 0.024)

product-astro-effect: an Astro site with React islands and a separate Effect API
Lexical stacks: astro-api (strong, 0.981), astro-blog (partial, 0.962), react-router (partial, 0.949), python-react (partial, 0.948), typescript-api (partial, 0.945)
Lexical fragments: effect (partial, 0.475), effect-schema (partial, 0.388), rest-api (weak, 0.237), cloudflare-pages (weak, 0.179), postgres (weak, 0.178)

paraphrase-workouts: something people install on their phone to log workouts
Lexical stacks: react-router (strong, 0.791), typescript-cli (strong, 0.790), typescript-api (strong, 0.744), astro-api (weak, 0.217), cloudflare-react-router (weak, 0.185)
Lexical fragments: docker-deploy (weak, 0.012), openrouter-chat-cli (weak, 0.011), openrouter-chat (weak, 0.010), effect (weak, 0.010), rr (weak, 0.009)

paraphrase-rename: a tool I run in my terminal to rename files
Lexical stacks: go-cli (strong, 0.764), typescript-api (strong, 0.710), react-router (partial, 0.386), typescript-cli (partial, 0.277), astro-api (weak, 0.235)
Lexical fragments: git-hooks (weak, 0.249), postgres (weak, 0.140), ci-github (weak, 0.106), cloudflare-pages (weak, 0.103), rr (weak, 0.101)

paraphrase-brochure: mostly prebuilt pages, a few interactive widgets, and a typed Node backend they can call
Lexical stacks: python-react (strong, 0.917), astro-api (strong, 0.911), typescript-api (partial, 0.817), react-router (partial, 0.782), cloudflare-react-router (partial, 0.775)
Lexical fragments: cloudflare-pages (partial, 0.455), posthog (weak, 0.109), cloudflare-d1 (weak, 0.102), postgres (weak, 0.058), git-hooks (weak, 0.032)

paraphrase-computer: an installable window on my computer with Rust doing the work behind the buttons
Lexical stacks: tauri-react (strong, 0.925), mobile-expo (strong, 0.748), python-react (partial, 0.300), react-router (weak, 0.243), cloudflare-react-router (weak, 0.241)
Lexical fragments: clerk (weak, 0.151), ce-plugin (weak, 0.050), ci-github (weak, 0.026), goreleaser (weak, 0.022), openrouter-chat (weak, 0.021)

paraphrase-server-pages: render pages on a Node server and handle form submissions in the same React project
Lexical stacks: python-react (strong, 0.941), astro-api (strong, 0.888), react-router (partial, 0.929), tauri-react (partial, 0.927), cloudflare-react-router (partial, 0.921)
Lexical fragments: cloudflare-pages (partial, 0.457), openrouter-chat (weak, 0.219), openrouter-ai (weak, 0.211), docker-deploy (weak, 0.043), postgres (weak, 0.037)

trap-ios-health: an iOS health app
Lexical stacks: mobile-expo (partial, 0.473), react-router (weak, 0.213), python-react (weak, 0.197), typescript-api (weak, 0.194), astro-api (weak, 0.113)
Lexical fragments: postgres (weak, 0.014), docker-deploy (weak, 0.013), clerk (weak, 0.013), cloudflare-d1 (weak, 0.011), openrouter-chat (weak, 0.009)

trap-monitoring: a monitoring dashboard
Lexical stacks: astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000), mobile-expo (weak, 0.000)
Lexical fragments: cloudflare-pages (weak, 0.038), agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)

trap-student-tests: a test prep app for students
Lexical stacks: typescript-cli (strong, 0.554), cloudflare-react-router (strong, 0.549), go-cli (strong, 0.527), tauri-react (partial, 0.495), mobile-expo (weak, 0.025)
Lexical fragments: postgres (weak, 0.081), claude-harness (weak, 0.070), openrouter-ai (weak, 0.070), effect (weak, 0.067), git-hooks (weak, 0.063)

fragment-mobile-signin: sign-in for my mobile app
Lexical stacks: mobile-expo (strong, 0.898), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000)
Lexical fragments: clerk (weak, 0.207), posthog (weak, 0.025), agent-ops (weak, 0.019), bun-release (weak, 0.000), ce-plugin (weak, 0.000)

fragment-fastapi-postgres: a Postgres database for my FastAPI app
Lexical stacks: python-react (partial, 0.822), mobile-expo (partial, 0.815), typescript-api (weak, 0.150), astro-api (weak, 0.000), astro-blog (weak, 0.000)
Lexical fragments: postgres (strong, 0.528), cloudflare-d1 (partial, 0.264), ce-plugin (weak, 0.019), docker-deploy (weak, 0.018), agent-ops (weak, 0.013)

fragment-go-release: release binaries for my Go CLI
Lexical stacks: go-cli (strong, 0.970), typescript-cli (partial, 0.941), mobile-expo (weak, 0.231), tauri-react (weak, 0.205), typescript-api (weak, 0.192)
Lexical fragments: bun-release (strong, 0.589), goreleaser (partial, 0.477), openrouter-chat-cli (partial, 0.340), agent-ops (weak, 0.027), postgres (weak, 0.019)

fragment-analytics: product analytics
Lexical stacks: python-react (partial, 0.280), tauri-react (partial, 0.253), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000)
Lexical fragments: posthog (partial, 0.440), cloudflare-d1 (weak, 0.021), ce-plugin (weak, 0.020), agent-ops (weak, 0.000), bun-release (weak, 0.000)

fragment-ci-hooks: run tests on GitHub pull requests and check my code before commits
Lexical stacks: tauri-react (partial, 0.823), typescript-api (partial, 0.817), astro-blog (partial, 0.791), cloudflare-react-router (partial, 0.687), go-cli (partial, 0.629)
Lexical fragments: ci-github (partial, 0.589), git-hooks (partial, 0.466), cloudflare-pages (partial, 0.317), rr (partial, 0.303), goreleaser (partial, 0.265)

fragment-agent-guidance: shared project instructions for coding agents and guards against destructive shell commands
Lexical stacks: tauri-react (partial, 0.814), go-cli (partial, 0.766), mobile-expo (partial, 0.757), typescript-cli (partial, 0.741), astro-api (partial, 0.723)
Lexical fragments: agent-ops (strong, 0.627), claude-harness (partial, 0.454), rr (weak, 0.200), clerk (weak, 0.177), ce-plugin (weak, 0.177)

fragment-claude-harness: reusable TypeScript hooks and review commands for Claude Code
Lexical stacks: typescript-cli (partial, 0.946), typescript-api (partial, 0.913), mobile-expo (partial, 0.785), go-cli (partial, 0.771), astro-blog (partial, 0.562)
Lexical fragments: claude-harness (strong, 0.621), ce-plugin (partial, 0.451), git-hooks (partial, 0.434), agent-ops (partial, 0.428), rr (partial, 0.281)

fragment-essentials: enable Claude Essentials skills for debugging and code review in this project
Lexical stacks: typescript-api (partial, 0.387), astro-blog (partial, 0.321), typescript-cli (partial, 0.304), go-cli (partial, 0.290), astro-api (weak, 0.248)
Lexical fragments: ce-plugin (strong, 0.686), claude-harness (partial, 0.512), agent-ops (partial, 0.323), rr (weak, 0.236), rest-api (weak, 0.134)

fragment-boundary-schema: use Effect schemas to validate config and generate JSON Schema for tools
Lexical stacks: typescript-cli (strong, 0.930), typescript-api (partial, 0.901), react-router (partial, 0.875), astro-api (partial, 0.863), go-cli (partial, 0.856)
Lexical fragments: effect-schema (strong, 0.673), effect (partial, 0.428), openrouter-chat-cli (partial, 0.262), openrouter-chat (weak, 0.186), cloudflare-pages (weak, 0.131)

fragment-virtual-time: test Effect services with isolated layers and virtual time
Lexical stacks: typescript-cli (partial, 0.926), react-router (partial, 0.916), typescript-api (partial, 0.869), astro-api (partial, 0.862), mobile-expo (partial, 0.768)
Lexical fragments: effect (strong, 0.620), effect-schema (partial, 0.448), postgres (partial, 0.351), cloudflare-d1 (partial, 0.307), openrouter-chat-cli (weak, 0.149)

fragment-remote-checks: offload my tests and builds to another machine over SSH
Lexical stacks: typescript-cli (partial, 0.652), cloudflare-react-router (partial, 0.577), go-cli (partial, 0.563), tauri-react (partial, 0.547), astro-api (partial, 0.331)
Lexical fragments: rr (partial, 0.475), goreleaser (weak, 0.172), docker-deploy (weak, 0.163), postgres (weak, 0.081), clerk (weak, 0.079)

fragment-bun-binaries: ship my Bun compiled CLI with a checksum verified installer and self update
Lexical stacks: typescript-cli (strong, 0.963), go-cli (partial, 0.926), mobile-expo (partial, 0.830), astro-api (partial, 0.776), tauri-react (partial, 0.583)
Lexical fragments: bun-release (strong, 0.610), openrouter-chat-cli (partial, 0.354), claude-harness (weak, 0.218), goreleaser (weak, 0.213), effect (weak, 0.048)

fragment-provider: add OpenRouter model discovery and provider configuration to my TypeScript API
Lexical stacks: typescript-api (partial, 0.955), typescript-cli (partial, 0.939), astro-api (partial, 0.929), mobile-expo (partial, 0.898), python-react (partial, 0.887)
Lexical fragments: openrouter-ai (strong, 0.650), openrouter-chat (partial, 0.471), openrouter-chat-cli (partial, 0.378), rest-api (weak, 0.238), claude-harness (weak, 0.204)

fragment-rest-conventions: consistent resource URLs, status codes and cursor pagination for my API
Lexical stacks: typescript-api (strong, 0.944), astro-api (partial, 0.927), mobile-expo (partial, 0.897), python-react (partial, 0.881), cloudflare-react-router (partial, 0.805)
Lexical fragments: rest-api (strong, 0.616), agent-ops (weak, 0.228), ce-plugin (weak, 0.157), effect (weak, 0.130), rr (weak, 0.126)

fragment-worker-database: local SQLite storage with migrations for my Cloudflare Worker
Lexical stacks: cloudflare-react-router (strong, 0.963), react-router (weak, 0.229), mobile-expo (weak, 0.190), tauri-react (weak, 0.137), typescript-cli (weak, 0.116)
Lexical fragments: cloudflare-d1 (strong, 0.592), cloudflare-pages (partial, 0.443), postgres (weak, 0.246), effect-schema (weak, 0.188), openrouter-chat (weak, 0.132)

combined-blog-pages: a static blog deployed to Cloudflare
Lexical stacks: astro-blog (strong, 0.961), cloudflare-react-router (partial, 0.906), astro-api (partial, 0.753), react-router (weak, 0.112), typescript-cli (weak, 0.104)
Lexical fragments: cloudflare-pages (strong, 0.530), cloudflare-d1 (partial, 0.441), posthog (weak, 0.018), agent-ops (weak, 0.017), effect (weak, 0.012)

combined-go-release: a Go command line tool with tagged cross platform binary releases
Lexical stacks: go-cli (partial, 0.965), typescript-cli (partial, 0.887), typescript-api (partial, 0.865), tauri-react (partial, 0.474), astro-api (partial, 0.438)
Lexical fragments: bun-release (strong, 0.653), goreleaser (strong, 0.593), effect-schema (weak, 0.162), openrouter-chat-cli (weak, 0.161), claude-harness (weak, 0.135)

combined-worker-d1: a React app on Cloudflare Workers backed by D1
Lexical stacks: cloudflare-react-router (strong, 0.971), react-router (partial, 0.922), python-react (partial, 0.919), tauri-react (partial, 0.917), astro-blog (partial, 0.774)
Lexical fragments: cloudflare-d1 (strong, 0.652), cloudflare-pages (partial, 0.443), openrouter-chat-cli (weak, 0.021), postgres (weak, 0.014), docker-deploy (weak, 0.011)

combined-python-database: a Python FastAPI and React app with Postgres and database migrations
Lexical stacks: python-react (strong, 0.967), react-router (partial, 0.919), tauri-react (partial, 0.916), cloudflare-react-router (partial, 0.910), mobile-expo (partial, 0.861)
Lexical fragments: postgres (strong, 0.572), cloudflare-d1 (partial, 0.372), docker-deploy (weak, 0.063), ce-plugin (weak, 0.045), agent-ops (weak, 0.033)

combined-node-container: a standalone TypeScript HTTP API published as a Docker image to GHCR
Lexical stacks: typescript-api (partial, 0.967), astro-api (partial, 0.939), typescript-cli (partial, 0.937), astro-blog (partial, 0.904), mobile-expo (partial, 0.903)
Lexical fragments: docker-deploy (partial, 0.641), rest-api (partial, 0.378), postgres (weak, 0.213), claude-harness (weak, 0.203), effect (weak, 0.163)

combined-terminal-chat: an AI chat tool in my terminal with a TypeScript codebase
Lexical stacks: typescript-cli (partial, 0.937), typescript-api (partial, 0.911), astro-blog (partial, 0.512), react-router (partial, 0.504), astro-api (partial, 0.464)
Lexical fragments: openrouter-chat-cli (strong, 0.534), openrouter-chat (partial, 0.479), openrouter-ai (partial, 0.334), claude-harness (weak, 0.201), effect (weak, 0.059)

nomatch-firmware: firmware for a microcontroller
Lexical stacks: astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000), mobile-expo (weak, 0.000)
Lexical fragments: agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000), claude-harness (weak, 0.000)

nomatch-unity: a Unity game
Lexical stacks: astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000), go-cli (weak, 0.000), mobile-expo (weak, 0.000)
Lexical fragments: agent-ops (weak, 0.000), bun-release (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000), claude-harness (weak, 0.000)

nomatch-kotlin: an Android-only app in Kotlin
Lexical stacks: tauri-react (strong, 0.793), mobile-expo (weak, 0.247), typescript-cli (weak, 0.023), typescript-api (weak, 0.023), react-router (weak, 0.023)
Lexical fragments: claude-harness (weak, 0.001), docker-deploy (weak, 0.001), agent-ops (weak, 0.001), effect (weak, 0.001), git-hooks (weak, 0.001)

nomatch-swiftui: a native SwiftUI iPhone app
Lexical stacks: mobile-expo (partial, 0.694), tauri-react (partial, 0.282), astro-api (weak, 0.000), astro-blog (weak, 0.000), cloudflare-react-router (weak, 0.000)
Lexical fragments: bun-release (weak, 0.023), openrouter-chat-cli (weak, 0.021), openrouter-chat (weak, 0.010), agent-ops (weak, 0.000), ce-plugin (weak, 0.000)

nomatch-tui-cli: a cli with a good TUI experience
Lexical stacks: typescript-cli (strong, 0.941), go-cli (strong, 0.925), mobile-expo (weak, 0.155), astro-api (weak, 0.000), astro-blog (weak, 0.000)
Lexical fragments: openrouter-chat-cli (partial, 0.407), bun-release (weak, 0.032), effect (weak, 0.015), goreleaser (weak, 0.014), effect-schema (weak, 0.011)

nomatch-python-cli: a command line tool in Python
Lexical stacks: go-cli (strong, 0.883), python-react (partial, 0.932), typescript-cli (partial, 0.731), mobile-expo (weak, 0.196), typescript-api (weak, 0.176)
Lexical fragments: claude-harness (weak, 0.135), openrouter-chat-cli (weak, 0.128), agent-ops (weak, 0.121), rr (weak, 0.107), ce-plugin (weak, 0.024)

nomatch-gpu-training: train a neural network on a GPU cluster
Lexical stacks: astro-api (weak, 0.231), cloudflare-react-router (weak, 0.219), typescript-api (weak, 0.163), python-react (weak, 0.149), astro-blog (weak, 0.000)
Lexical fragments: clerk (weak, 0.173), bun-release (weak, 0.021), agent-ops (weak, 0.000), ce-plugin (weak, 0.000), ci-github (weak, 0.000)
```

