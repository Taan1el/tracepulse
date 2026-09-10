# ADR 001: Native SQLite WAL and Relational Span Storage Architecture

## Status
Accepted

## Context
High-throughput distributed tracing and APM platforms need to ingest hundreds to thousands of span records per minute, persist hierarchical parent-child relationships, record span attributes (HTTP status, database statements, error details), and allow rapid ad-hoc querying by service name, duration thresholds, and error conditions. Standard enterprise systems often introduce complex multi-node ClickHouse or Elasticsearch clusters, making local development heavyweight and brittle.

For TracePulse, we required:
1. Zero-dependency local developer execution (`npm run dev` functioning out of the box with zero external databases or containers).
2. Strict ACID relational integrity with cascading deletions when traces are purged.
3. Sub-millisecond indexed lookups by `trace_id`, `service_name`, and `start_time_ms`.

## Decision
1. **Node.js 24 Native `node:sqlite` in WAL Mode**:
   - Utilize Node.js's built-in `DatabaseSync` engine in Write-Ahead Logging mode (`PRAGMA journal_mode = WAL;`).
   - Enforce relational constraints and foreign keys via `PRAGMA foreign_keys = ON;`.
   - Separate data into `traces` (aggregated trace metadata, participating service names, total duration) and `spans` (individual unit of execution, parent ID, timestamps, attributes, and events).

2. **Atomic Ingestion Transactions**:
   - Trace batches are committed within atomic database transactions (`BEGIN TRANSACTION ... COMMIT;`), ensuring a trace summary and all corresponding spans are persisted atomically.

## Consequences
- **Positive**: Blazing fast sub-millisecond trace hydration and persistence with zero setup friction.
- **Positive**: Unit and integration test suites can instantiate `:memory:` databases with complete isolation.
- **Trade-off**: For ultra-high volume planetary telemetry (millions of spans/sec), ingestion can be fronted by a streaming buffer (Kafka) and offloaded to columnar storage like ClickHouse.
