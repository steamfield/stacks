# R12 site search

stacks-api merge `d9d74d6`, nav tests `5f5b1e1`, fixes `0d71dbf`. `/search/` reads `#q=` only
(no page query string), runs on submit, keeps Back history, moves focus to Results and offers
browse links (`/browse/newest/`, `/fragments/`) for no match, failure and JavaScript off. The
home page has a search field; every page's Main nav links Search.

Review changes: the fallback links pointed at `/browse/`, which no build produces; they now go to
`/browse/newest/`. The browser spec (3 tests) passed locally; the delegate couldn't run it because
the stacks-api guard refused any `test:browser` run, fixed in `95ec146`.

## Queries (local API and site, 21-day sample)

| Query | Top stacks (tier) | Top fragments (tier) | Assessment |
| --- | --- | --- | --- |
| python api with a react dashboard | python-react (strong), react-router, astro-api (partial) | rest-api, effect (partial) | Right first stack |
| go cli | go-cli (strong), typescript-cli (partial) | goreleaser (strong) | Right |
| typescript api | python-react, typescript-api, astro-api (strong) | rest-api (partial) | Wrong first stack (R13 limit) |
| add CI to my repo | three stacks (weak) | ci-github (strong) | Right fragment; now listed first |
| !!! | none | none | No-match text and browse links |
| mobile app | mobile-expo (strong) | clerk (weak) | Right |
| blog | astro-blog (strong) | posthog (weak) | Right |
