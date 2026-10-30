# search

Find stacks and fragments for what you want to build:

```sh
stacks search "an iOS health app" --json
stacks search go cli --kind stack --limit 3
```

The request is one or more positional words, joined with spaces and trimmed, from 1 to 500
characters. `--kind stack|fragment` selects one list; `--limit` sets the maximum hits in each
list (default 5, range 1 to 20). `--local` keeps the request on this machine;
`--offline` is also accepted as a shared flag.

When an API endpoint is configured, search sends the request to `GET /v1/search` while ranking
the visible registry locally. API hits replace bundled and cached-index copies; project and
user overrides keep their local ranking. A missing API hit stays available locally.
The API has one attempt and an 800 ms deadline, including reading its response. A failed call
falls back to local ranking and backs off for ten minutes. Only endpoint URLs and expiry times
are saved under `$XDG_CACHE_HOME/stacks/search/backoff.json`; no request or response is cached.
Search stores no request text in logs and never calls a model. Cached statistics and last-run
evidence are optional; search never fetches statistics or refreshes the registry index.

The endpoint is the hosted API at `https://stacks.steamfield.io`. Source builds can point at a
loopback `STACKS_DEV_API_URL` instead; release builds ignore that variable.
`--local`, `--offline`, `STACKS_OFFLINE=1` and `DO_NOT_TRACK` (except empty, `0` or `false`)
each prevent the API call.

`--json` returns `SearchResult`: `ranking: "api" | "local"`, the request, recognized vocabulary and
unmatched content words under `understood`, `noStrongMatch`, and separate `stacks` and
`fragments` lists. Each list contains only hits with a positive score and a `why` reason other
than a request constraint or the bare word `add`, and may be shorter than `--limit` or empty. A list with strong or partial hits includes at most
two weak hits after them; a list with only weak hits keeps up to `--limit` candidates.
Scores and coverage are rounded to three decimal places after sorting; hits whose scores round
to zero are omitted. `remote` is `used`, `off` or `unavailable`; when off, `remoteReason` is
`local_flag`, `offline`, `do_not_track`, `backoff` or `no_endpoint`. API results also include
`method` (`lexical` or `hybrid`). Text output says when ranking ran locally.
When shown hits include statistics, `statsPopulation` identifies the source population when
available: `"stacks projects"` or `"seeded development data"`. API statistics use the API's
population; locally cached statistics use the cached summary's. If both sources supply shown
statistics and either is seeded, the result is seeded. The field is absent when no shown hit has
statistics, or when any shown source has no population and none is seeded. Text evidence adds
`seeded` after the sample when the result is seeded.
Run `stacks schema search` for the JSON Schema.

`understood.unmatched` lists request words no entry's strong metadata fields matched. A word
listed here may still appear in entry bodies, which provide weaker evidence of a fit.

Each hit includes its origin and trust, absolute `score` from 0 to 1, strong-field `coverage`,
`tier` (`strong`, `partial`, `weak`), matching fields and words under `why`, `penalties`, optional
caveats and cached evidence. Fragments also carry `appliesTo`. Cached statistics reorder hits
only within a tier. A hit's quality adjustment ranges from -0.018 to +0.022, so two hits can
differ by at most 0.040 from this evidence; project counts contribute at most 0.01.
`statsPopulation` identifies seeded development data when that is the source; seeded data
still participates in ordering. A failed last run adjusts comparison by -0.002 and a passing
one by +0.002. Untrusted entries cannot be strong. A strong hit needs an id, name or facet
reason. When a request names a stack, other stacks can be at most partial.
Text output prints nonempty fragment targets as `Applies to: <ids>` after `Why:`. It omits
body-only `Why:` reasons when other fields explain the same hit.
Each penalty is `{ kind, request, entry }`: `kind` is `platform`, `language`, `productKind`,
`notFor` or `untrusted`; `request` names the triggering phrase (with its normalized vocabulary
value for facet mismatches), and `entry` lists the conflicting facets or the matched `notFor`
text. An untrusted penalty has an empty `request` and the entry's origin. Fragment platform
and language conflicts list the facets of their applicable stacks. Penalties remain a nested
array per hit, including in the API's single `penalties` column.
Penalties apply after lexical score squashing. The strongest factor applies in full; each
additional factor applies at its square root. Named exclusions use `notFor` with `entry:
"excluded by name in the request"`; fragment fit uses `notFor` with `entry: "applies to <ids>"`.
A request about an existing repository (a leading `add`, "existing … app", "my repo", or
"add … to my app") gives stack scaffolds an existing-repository constraint reason and penalty.

Compare strong matches using `why` and `evidence`, and read caveats before choosing. When
`noStrongMatch` is true, tell the user nothing fits well and confirm before using a weak match.
Never pick an untrusted entry unless the user named it. Text output ends with the next action,
using the first trusted stack when one is available.

Exit 0 means the search ran, including empty results and no strong match. Exit 2 means invalid
input, 6 means an unreadable registry, and 130 means interruption.
