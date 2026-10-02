# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-02

### Added
- Express API that ingests OpenTelemetry-style spans, stores them in Node's native SQLite (`node:sqlite`, WAL mode), and rebuilds each trace as a span tree with offsets, durations and a longest-child marker.
- Per-service latency percentiles (P50, P90, P95, P99), error rates, and service-to-service call counts derived from parent and child spans in different services.
- W3C `traceparent` parsing and generation, plus a sample traffic generator for checkout, sign-in and search flows with optional failures.
- Strict input checks: trace query filters, simulation options, span fields and timestamps, trace batch identity, malformed JSON bodies, and cyclic or excessively deep span graphs are rejected with a 400 before anything is stored. Service filters match exact service names.
- React web app with a trace table, a waterfall diagram per trace, a service latency table, a service calls table, and dialogs for generating traffic and inspecting a `traceparent` header.
- In-browser demo mode for GitHub Pages. It runs deterministic sample data through the same pure logic the server uses (`shared/`) and shows a demo bar with "Reset sample data".
- GitHub Actions: CI on Node 22 and 24 (lint, tests, build, Pages build, Docker image build) and a Pages workflow that builds on every push to main and deploys once the repository is public.
- MIT license, package metadata, and `.env.example` files for the client and server.
- Server tests for routes, shared analytics and flow builders, and client tests for the main flows, the demo data layer and the demo bar.

### Changed
- Redesigned the interface: a light paper theme with one orange accent, self-hosted Sora, Geist and Geist Mono fonts, Lucide icons, flat bars instead of gradients and shadows, and numbers set in mono.
- Traces are listed in a table, the waterfall is a flat bar diagram with its durations printed and a text summary, and services and calls are tables. A single stats strip replaces the row of stat cards.
- Every button, input, select and toggle is at least 44px tall, and dialogs trap focus, close on Escape and return focus to the control that opened them.
- Pure trace logic (span validation, tree building, percentiles, `traceparent` handling, flow generation, service metrics and dependencies) moved to `shared/` so the server and the demo run the same code.
- The "errors only" filter and the stats strip now say what they measure: traces that contain an error span, not HTTP status codes.

### Fixed
- The `start` script and the Docker image pointed at `server/dist/index.js`, but the build writes `server/dist/server/src/index.js`, so both failed right after a build.
- `.gitignore` only matched `data/` at the repository root, so the SQLite file written to `server/data/` could be committed.
- Service metrics reported a "throughput" that was the span count divided by a constant 60. The field is removed instead of showing an invented rate.
- "Generate new context" in the traceparent dialog parsed the previous header, because it read state that had not updated yet. It now parses the new header.
- Selecting a trace reloaded the whole trace list, because the list loader depended on the selection. It now loads once per filter change.
- Unexpected server errors returned the raw error message to the client. They are now logged on the server and answered with a fixed message.
- The README, ADRs and interface text claimed sub-millisecond queries, a 40% bottleneck threshold, an interactive topology graph and an 18-test suite that the code or measurements did not support. These claims were removed or corrected.
