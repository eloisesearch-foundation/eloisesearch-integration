# eloisesearch-integration

Evidence that Eloisesearch does what its contract promises, before anyone has to
take it on trust.

An application team that wants to move its search from Elasticsearch or
OpenSearch to Eloisesearch needs to know which of its requests will keep working
and which will not. This repository answers that with tests that run the same
HTTP requests against the reference servers and against Eloisesearch, over a
small, frozen movie corpus, and with the reports those runs produce.

> **Status:** roadmap Phase 0. The reference harness and the first cases (index
> lifecycle, documents, bulk, refresh) exist; the movie corpus and the search
> cases come next. See the
> [roadmap](https://github.com/eloisesearch-foundation/eloisesearch-workspace/blob/main/docs/ROADMAP-MVP.md).

## What lives here

- **The compatibility harness:** a runner that sends each case to Elasticsearch
  9.5.4, OpenSearch 3.9.0 or Eloisesearch and checks the response against the
  case's expectations.
- **The contract fixtures:** the movie corpus, its mapping, and the cases
  expressed as requests in the compatible API.
- **Reports:** reviewed baseline results per reference and version, which the
  [compatibility matrix](https://github.com/eloisesearch-foundation/eloisesearch/blob/main/docs/api-contract.md)
  cites as evidence.
- Later, the movie-search demo (Rails API + Nuxt frontend) and end-to-end tests.

The compatibility matrix itself stays in the `eloisesearch` repository, next to
the code it describes.

## Running the references

Needs Docker (Docker Desktop or OrbStack is fine), Node 22 and about 2 GB of
free memory.

```bash
make reference-up        # start Elasticsearch 9.5.4 (:9200) and OpenSearch 3.9.0 (:9201)
make reference-test      # run every case against both; reports in reports/
make reference-report    # reports/summary.md: one column per engine
make reference-down      # stop them and remove their data
```

`REF=elasticsearch` or `REF=opensearch` limits a command to one engine. A run
refuses a server whose version differs from the pinned one.

Against a local Eloisesearch on port 7700 (report only, while the API is being
built):

```bash
make eloisesearch-test
```

## Other commands

```bash
make check     # what CI runs: harness unit tests, case validation, changelog
make help      # everything else
```

How cases are written, what is compared and how differences between the
references are recorded: [`docs/design-reference-harness.md`](docs/design-reference-harness.md).

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in this project by you, as defined in the Apache-2.0 license, shall be dual
licensed as above, without any additional terms or conditions.

---

Elasticsearch is a trademark of Elasticsearch B.V., registered in the U.S. and in
other countries. OpenSearch is a trademark of LF Projects, LLC. Eloisesearch is an
independent project, not affiliated with or endorsed by either; their names are
used only to describe API compatibility.
