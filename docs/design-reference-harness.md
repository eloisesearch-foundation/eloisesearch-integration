# Design: reference harness

- **Status:** Draft
- **Date:** 2026-10-11
- **Roadmap:** Phase 0, "Reference harness" and the fixture items
  ([ROADMAP-MVP.md](https://github.com/eloisesearch-foundation/eloisesearch-workspace/blob/main/docs/ROADMAP-MVP.md))

## Objective

A team moving its movie search from Elasticsearch or OpenSearch to Eloisesearch
needs a verifiable answer to three questions:

1. Which requests does Eloisesearch promise to support?
2. How does each reference engine actually answer those requests?
3. Which differences are intentional, and where are they written down?

Today the answer lives in prose: the
[compatibility matrix](https://github.com/eloisesearch-foundation/eloisesearch/blob/main/docs/api-contract.md)
lists features as Planned, and the movie behavior is described in the
[quality plan](https://github.com/eloisesearch-foundation/eloisesearch/blob/main/docs/quality-plan.md).
Nothing runs.

This design adds a harness that sends the same HTTP requests to Elasticsearch
9.5.4, OpenSearch 3.9.0 and Eloisesearch, checks each response against
expectations written by a person, and writes a report per engine and version.
Once it exists:

- the references are exercised first, so the cases, the corpus and the expected
  results are confirmed before Eloisesearch implements anything;
- every row of the matrix can point at the cases that prove it;
- an Eloisesearch feature moves to Supported only when its cases pass.

## Method

### Current state

- This repository has only its scaffold (README, AGENTS.md, CHANGELOG, CI running
  the changelog check).
- The shared contract of the earlier movie-search prototypes (12 behavior cases
  and 3 malformed queries over a 12-document corpus) is the functional starting
  point. It tests the prototypes' own HTTP endpoints and response envelopes, so
  it cannot be reused as is: its cases are rewritten here as requests in the
  compatible API (see "Adapting the prototype cases").
- The references are pinned in the matrix: Elasticsearch 9.5.4 and OpenSearch
  3.9.0.

### Terms

| Term | Meaning |
| --- | --- |
| **Engine** | A server under test: `elasticsearch`, `opensearch` or `eloisesearch`. |
| **Case** | One behavior, as one or more HTTP steps with expectations. |
| **Step** | One request and the expectations on its response. |
| **Fixture** | A named corpus (mapping plus documents) loaded into a fresh index before the cases that need it. |
| **Run** | One execution of the cases against one engine; it has a random run id. |
| **Divergence** | A recorded difference between the references, with the behavior Eloisesearch follows. |

### Layout

```
contracts/
├── cases/<group>.json        cases, grouped by capability (index-lifecycle, documents, ...)
├── fixtures/<name>/          mapping.json + documents.ndjson (frozen corpus)
└── divergences.json          recorded differences between the references
harness/
├── run.mjs                   run cases against one engine, write the report
├── wait.mjs                  wait until an engine is actually ready
├── report.mjs                summarize reports side by side
├── validate.mjs              check case files (part of make check)
└── lib/                      the runner, assertions, HTTP client, engines
test/                         unit tests of the harness (node:test, fake engine)
compose.reference.yml         pinned reference engines
reports/                      run output (git-ignored)
```

The compatibility matrix stays in the `eloisesearch` repository, next to the code
it describes. This repository holds the evidence the matrix cites; it does not
duplicate the matrix.

### Case format

A case file holds one group:

```json
{
  "group": "index-lifecycle",
  "description": "Create, inspect and delete indexes.",
  "fixture": null,
  "cases": [ ... ]
}
```

`fixture` names a corpus under `contracts/fixtures/` that is loaded once per run
before the group's cases, into an index called `{{index}}`; `null` means the
cases create what they need.

A case with a single step:

```json
{
  "id": "get-missing-index",
  "capability": "index.get",
  "description": "Inspecting an index that does not exist is a 404 with the reference error type.",
  "request": { "method": "GET", "path": "/{{scratch}}" },
  "expect": {
    "status": 404,
    "error": { "type": "index_not_found_exception" }
  }
}
```

A case with several steps uses `"steps": [{ "request": ..., "expect": ... }, ...]`
instead of `request` and `expect`. Steps run in order; a step without `expect`
only prepares state (its status must still be 2xx).

**Requests.** `method`, `path`, optional `query` (object, sent as query string),
and a body as either `body` (JSON, sent as `application/json`) or `ndjson` (an
array of objects, sent one per line with a trailing newline as
`application/x-ndjson`, as the Bulk API requires).

**Placeholders.** `{{index}}` is the run's fixture index, `{{scratch}}` a
fresh index name for this case, `{{run}}` the run id. They are replaced in
paths, bodies and expectations. Every index name a run creates starts with
`contract-<run>-`; the harness deletes each one it created, by exact name, after
the case (scratch) or after the run (fixture), so runs never collide and leave
nothing behind.

**Expectations.** Every key is optional; what is absent is not checked.

| Key | Checks |
| --- | --- |
| `status` | HTTP status. |
| `error` | `type` of the error envelope (and of `root_cause[0]` when given as `root_cause_type`). |
| `body` | Values at paths in the response: `{"result": "created", "_shards.failed": 0}`. A value can be a literal or a matcher: `{"exists": true}`, `{"absent": true}`, `{"type": "number"}`. |
| `shape` | Paths that must exist; `[]` means every element: `"hits.hits[]._id"`. |
| `hits.total` | `hits.total.value` (and `relation`, if given as an object). |
| `hits.ids_exact` | The set of returned `_id`s equals the list. |
| `hits.ids_include`, `hits.ids_exclude` | `_id`s that must, or must not, be returned. |
| `hits.ids_ordered` | The returned `_id`s, in this order. Only for cases whose order is part of the contract (sorts with a tie-break). |
| `hits.sorted_by` | Results are ordered by these `_source` fields (`[{"field": "popularity", "order": "desc"}, ...]`). |
| `hits.every` | Predicates every hit's `_source` satisfies: `{"field": "genres", "contains": "Science Fiction"}`, `{"field": "vote_average", "gte": 7}`, `{"fields": ["title", "overview"], "not_matches": "horror"}`. |
| `aggregations` | Buckets per aggregation name, compared as a set of `key`/`doc_count` pairs. |
| `highlight` | Per document `_id` and field: `{"exists": true}` or `{"contains": "<mark>Amélie</mark>"}`. Fragment boundaries are not compared. |
| `suggest` | For a named suggester: `texts_include`, `unique_texts`, `max`. |

**Never compared:** `_score` values, `took`, `timed_out`, `_seq_no`,
`_primary_term`, node and cluster identifiers, and anything else a case does not
name. A full-response snapshot is never an expectation.

**Per-engine differences.** A step may carry
`"engines": {"opensearch": {"expect": {...}, "divergence": "D-003"}}`. The engine's
`expect` replaces the listed top-level keys for that engine only, and must cite a
divergence. A case without that block expects the same answer from every engine.

### Divergences

`contracts/divergences.json` records each difference between the references:

```json
{
  "id": "D-003",
  "capability": "query.simple_query_string",
  "cases": ["quoted-phrase-exclusion"],
  "elasticsearch": "what Elasticsearch 9.5.4 returns",
  "opensearch": "what OpenSearch 3.9.0 returns",
  "decision": "follow-elasticsearch",
  "evidence": "IDs, status or fields observed, with the report it came from"
}
```

`decision` is one of `follow-elasticsearch`, `follow-opensearch`, `partial`,
`unsupported`, `out-of-mvp` or `pending`. The matrix links to the divergence id.
Phase 0 is not closed while any divergence for an MVP capability is `pending`.

### Engines and runs

`harness/lib/engines.mjs` knows each engine: its default URL (Elasticsearch on
`9200`, OpenSearch on `9201` so both can run at once, Eloisesearch on `7700`), the
version it must report, and its readiness check. `ENGINE_URL` overrides the URL.

- **Readiness.** `wait.mjs` polls the readiness endpoint
  (`GET /_cluster/health?wait_for_status=yellow&timeout=5s` for the references)
  until it answers 200, with an overall timeout. An open port is not readiness.
- **Identity.** Before any case, the runner reads `GET /` and records the engine
  name and version (`version.distribution` tells OpenSearch apart). A run against
  a reference whose version differs from the pinned one fails before running
  cases, so a report can never be attributed to the wrong version.
- **Fixtures.** For each fixture used: create `{{index}}` with the fixture's
  mapping, load the documents through `_bulk` with `refresh=true`, check that the
  bulk response has no item errors and that the document count matches. Searches
  therefore never depend on when an automatic refresh happens.
- **Reports.** `reports/<engine>-<version>.json` holds, per case and step, the
  outcome (`pass`, `fail`, `error`), every check with its expected and observed
  value, and a normalized observation (status, error type, ordered `_id`s, total,
  buckets, suggestion texts, the body values the case named). `report.mjs` turns
  all reports into `reports/summary.md`: one row per case, one column per engine,
  and a column that flags cases where the references observed different results.
- **Baselines.** After review, the normalized observations of a reference run
  are committed as `contracts/baselines/<engine>-<version>.json` (no timestamps,
  no run id), so a later run against the same version can be diffed against the
  reviewed baseline and an upgrade of a reference shows exactly what moved.
- **Exit status.** A run exits non-zero when a case fails or errors. Runs against
  Eloisesearch are report-only until a capability is implemented; the `eloisesearch`
  repository decides which of its cases gate its CI.

### Commands

```
make reference-up        start the pinned references and wait until ready
make reference-test      run every case against each reference
make reference-report    write reports/summary.md from the latest reports
make reference-down      stop the references and remove their data
make check               unit tests, case validation, changelog check
```

`REF=elasticsearch` or `REF=opensearch` limits the reference commands to one
engine. CI runs `make check`, and one job per reference that runs
`reference-up`, `reference-test` and `reference-report`, then uploads the reports.

### Adapting the prototype cases

The prototype cases send `q`, `genres` and `minRating` to the prototypes' own
endpoints and read `hits` or `items` envelopes. Each one is rewritten as the
request body the prototypes built for the reference, sent to `/{{index}}/_search`:

- full text: `bool.must` `simple_query_string` over `title^3`,
  `short_description^2`, `overview^2`, `content` with `lenient: true` and the
  default operator the prototypes chose (`OR`, `AND` when the query has an
  exclusion), plus a `multi_match` phrase boost in `bool.should`;
- filters: `terms` on `genres`, `range` on `vote_average`, in `bool.filter`;
- browse: `match_all`, sorted by `popularity` desc then `tmdb_id` asc;
- facets: `terms` on `genres` and a 5-year `histogram` on `year`;
- suggestions: a `completion` suggester on `title.suggest` with
  `skip_duplicates`;
- malformed input: the three incomplete queries through the same body.

The expected IDs come from the prototype contract and are confirmed on both
references before the cases are committed as passing.

### Plan

1. **Harness and environment** (`feat/harness`): this design, the runner and its
   unit tests against an in-process fake engine, the pinned Compose file, the
   Make targets and CI jobs, and the first cases: index lifecycle, documents,
   bulk, refresh and their errors. They need no corpus.
2. **Fixtures and baseline** (`feat/baseline`): the frozen movie corpus and its
   explicit mapping, the prototype cases adapted as above, edge-case documents
   where coverage is missing, a run against both references, the reviewed
   baselines and the first divergences.
3. **Matrix and gate** (core and workspace): resolve the "To decide" rows with
   the reports as evidence, link matrix rows to cases and divergences, and add
   the Phase 0 definition of done to the roadmap.

## Constraints

- **Not in scope:** Eloisesearch's own correctness tests (they live with its code),
  performance measurements, the demo application.
- **Must not:** compare scores or timing; turn a run's output into an
  expectation without review; run against a reference whose version differs from
  the pinned one; delete an index the run did not create; depend on remote
  services, credentials or data outside this repository; add npm dependencies.
- **Single-node references** with security disabled, for local and CI use only.
  This setup is not a deployment recommendation.
- **Images are pinned by version tag.** Pinning by digest is a follow-up once the
  digests are recorded from a first pull.

## Validation

- [ ] Unit tests: placeholders, path lookup, every expectation kind (pass and
      fail), per-engine overrides requiring a divergence, case-file validation
      (unknown keys, duplicate ids, missing fields), report summary.
- [ ] An end-to-end unit test runs real case files against an in-process fake
      engine and checks the report, the cleanup of every created index, and the
      version check.
- [ ] `make reference-up && make reference-test` passes against both references
      locally and in CI, and `make reference-down` leaves nothing running.
- [ ] Every case that names an expectation was confirmed on both references; any
      difference is either an engine override with a divergence or a fixed case.
