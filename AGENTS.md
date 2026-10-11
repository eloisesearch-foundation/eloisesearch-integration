# AGENTS.md — eloisesearch-integration contributor guide

This is the single canonical instruction file for AI coding agents working in this
repository (Claude Code, Codex, Cursor, Gemini CLI and other AGENTS-aware tools).
`CLAUDE.md` only imports it. Humans should read it too.

## What this repository is for

Eloisesearch promises a documented subset of the Elasticsearch 9.5.4 REST API and
Query DSL, so teams can migrate by pointing existing applications at it. This
repository turns that promise into evidence: the same HTTP requests run against
Elasticsearch 9.5.4, OpenSearch 3.9.0 and Eloisesearch, over a frozen movie
corpus, and every run produces a report that says which expectations held on
which engine and version.

The first use case is a movie-search app (Rails API + Nuxt frontend): weighted
text search with phrases and exclusions, filters, facets, suggestions,
highlighting and pagination. The cases cover what that app needs, nothing more.

## Repository layout

```
contracts/            cases, fixtures and the divergence register
harness/              the runner and its commands (Node 22, no dependencies)
test/                 unit tests of the harness, with an in-process fake engine
compose.reference.yml the pinned reference engines
scripts/              repository checks
docs/                 design documents
```

Sibling repositories, the roadmap and the cross-repository conventions are in
[`eloisesearch-workspace`](https://github.com/eloisesearch-foundation/eloisesearch-workspace).

## Commands

```bash
make check             # what CI runs: unit tests, case validation, changelog
make reference-up      # pinned references in Docker (REF=elasticsearch|opensearch)
make reference-test    # run the cases against them
make reference-report  # side-by-side summary in reports/summary.md
make reference-down
make help              # everything else
```

Run `make check` before saying a change is done. A change to a case is done only
after it has also run against both references (locally or in CI); say which.

## Invariants (do not violate)

1. **Cases are requests in the compatible API.** A case is an HTTP method, path
   and body that a client of the reference API could send. Never test an
   application's own endpoints or response envelopes here.
2. **Expectations are reviewed, not recorded.** Expected IDs, order and errors
   come from the case author and are confirmed against the references. A report
   from a run is evidence for review, never an automatic snapshot that becomes
   the expectation.
3. **Never compare what the contract does not promise.** No exact `_score`, no
   `took`, no node or cluster identifiers, no timing.
4. **Differences are recorded, not hidden.** When the references disagree, the
   case says which behavior Eloisesearch follows and why. A failing case is
   never "fixed" by loosening its expectation without a recorded decision.
5. **Pinned references.** Reference images use exact versions (never `latest`),
   and every report records the engine name and version it ran against.
6. **Hermetic.** No remote clusters, no credentials, no external data. Each run
   creates its own uniquely named indexes and deletes them afterwards.
7. **No dependencies without a reason.** The harness uses the Node standard
   library (`fetch`, `node:test`, `node:assert`). A dependency needs a recorded
   reason in the design doc.

## Code style

- Match the surrounding code. Comments explain *why*, not *what*.
- ES modules (`.mjs`), Node 22, two-space indentation.
- Small, behavior-scoped changes. No speculative abstractions.

## Project maintenance rules

- **Docs and CHANGELOG move with the change.** A change to the cases, the corpus
  or the harness that changes what is verified adds a `CHANGELOG.md` entry under
  `## [Unreleased]` in the same commit.
- **New features start with a design doc** in `docs/design-<topic>.md`, written in
  four parts: Objective, Method, Constraints, Validation.
- **Third-party names only where compatibility needs them.** Elasticsearch and
  OpenSearch are named here because they are the references; always
  descriptively, never in marketing comparisons, and with the trademark notice in
  user-facing docs. No benchmarks against other products.
- **The human decides.** Agents review, audit and draft; the maintainer approves
  merges.

## Git workflow: branches, grouped commits, pull requests

The rules are the same as in every Eloisesearch repository; see the "Git
workflow" section of the
[workspace AGENTS.md](https://github.com/eloisesearch-foundation/eloisesearch-workspace/blob/main/AGENTS.md).
In short: one branch `<type>/<topic>` per roadmap item, commits in logical
groups that each pass `make check`, a pull request using the template, merged by
the maintainer without squashing. Agents never push to `main`, merge or tag.

## Documentation map

- [`README.md`](README.md): what this repository is for.
- [`docs/design-reference-harness.md`](docs/design-reference-harness.md): case
  format, expectations, divergences, runs and reports.
- [`CHANGELOG.md`](CHANGELOG.md): changes to what is verified.
