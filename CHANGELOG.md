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

[Unreleased]: https://github.com/eloisesearch-foundation/eloisesearch-integration/commits/main
