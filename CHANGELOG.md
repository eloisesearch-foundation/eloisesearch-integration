# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repository holds tests and fixtures, not a released package; entries record
changes to the cases, the corpus and the harness that affect what is verified.

## [Unreleased]

### Added

- Reference harness (Node 22, no dependencies): runs contract cases as HTTP
  requests against one engine, checks status, error envelope, body values,
  hits, aggregations, highlights and suggestions, and writes a report per
  engine and version. It refuses a reference whose version differs from the
  pinned one and deletes every index it creates. Scores and timings are never
  compared.
- First contract cases, needing no corpus: index lifecycle (create, inspect,
  exists, delete, invalid names, unknown settings and field types, malformed
  JSON) and documents (index, replace, generated IDs, realtime GET, `_source`
  filtering, delete, `_create` conflicts, bulk with per-item results, refresh,
  `refresh=true` and `refresh=wait_for`). Expectations are unconfirmed until
  they run against both references.
- Pinned reference engines (`compose.reference.yml`: Elasticsearch 9.5.4 on
  port 9200, OpenSearch 3.9.0 on port 9201) with `make reference-up`,
  `reference-test`, `reference-report` and `reference-down`, and a CI job per
  reference that uploads its reports.
- Divergence register (`contracts/divergences.json`) with the first two
  differences found by the reference run: the error type for an unknown index
  setting (D-001, Eloisesearch follows Elasticsearch) and for malformed JSON
  (D-002, status and envelope only).
- Frozen `movies` fixture (`contracts/fixtures/movies/`): the movie-search
  application's explicit mapping and 15 documents with fixed IDs, including
  boundary documents for rating filters, sort ties and exclusions.
- `search` cases over the movies fixture, written as the `_search` and `_count`
  requests the movie-search application sends: OR and AND semantics, phrases,
  exclusions, prefix, fuzzy, accent folding, genre and rating filters,
  deterministic browse order, pagination, `_source` filtering, facets,
  highlighting, completion suggestions and three incomplete user queries.
  Expected IDs are derived from the corpus.
- `make reference-baseline` writes `contracts/baselines/<engine>-<version>.json`
  from clean reference runs: normalized observations without run ids or
  generated values, so a re-run or a reference upgrade shows as a plain diff.
- Reviewed baselines for Elasticsearch 9.5.4 and OpenSearch 3.9.0: all 44 cases
  pass on both; they differ only in D-001 and D-002.

[Unreleased]: https://github.com/eloisesearch-foundation/eloisesearch-integration/commits/main
