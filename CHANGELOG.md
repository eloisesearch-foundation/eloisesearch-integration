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
  pinned one and deletes every index it creates. `scores` and timings are never
  compared.

[Unreleased]: https://github.com/eloisesearch-foundation/eloisesearch-integration/commits/main
