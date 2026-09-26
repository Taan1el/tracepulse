# TracePulse 🔍⚡
> **Distributed Tracing, OpenTelemetry Spans & Microservice Performance Observability Engine**  
> *Engineered for High-Throughput APM, Latency Percentile Analytics (P50/P90/P95/P99) & Service Dependency Graphing*

[![CI Pipeline](https://img.shields.io/badge/CI-Passing-10b981.svg?style=flat-square)](#)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg?style=flat-square)](#)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933.svg?style=flat-square)](#)
[![Database](https://img.shields.io/badge/Database-SQLite%20WAL%20(Native)-003B57.svg?style=flat-square)](#)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?style=flat-square)](#)
[![W3C TraceContext](https://img.shields.io/badge/Standard-W3C%20TraceContext-ff6600.svg?style=flat-square)](#)
[![Docker](https://img.shields.io/badge/Docker-Compose%20Ready-2496ed.svg?style=flat-square)](#)

---

## ⚡ 2-Minute Product Overview
**TracePulse** is a production-grade distributed tracing and Application Performance Monitoring (APM) platform. Designed for modern microservice architectures, it ingests OpenTelemetry-compatible span payloads, implements the W3C Trace Context (`traceparent`) standard, computes statistical latency percentiles (P50, P90, P95 SLA, P99 tail), reconstructs execution DAGs into interactive Gantt waterfall timelines with bottleneck detection, and automatically maps service-to-service communication topologies.

### Core Capabilities
1. **W3C TraceContext Ingestion & Propagation Engine**: Standard-compliant validation and parsing for `00-{trace_id}-{span_id}-{flags}` headers. Generates downstream child contexts to correlate cross-service workflows.
2. **Interactive Trace Waterfall Timeline**: Gantt-style visualizer breaking down parent-child spans with service color tags, relative offsets, and automated bottleneck heuristics (`🔥 BOTTLENECK`) highlighting critical path delays.
3. **Statistical Latency Percentiles (P50/P90/P95/P99)**: In-engine numeric quantile calculations providing visibility into typical response times vs tail latency outliers without external big-data dependencies.
4. **Dynamic Service Topology Graph (DAG)**: Automated dependency extraction discovering cross-service boundaries from span traces, mapped into an interactive SVG topology canvas with call volumes and latency metrics.
5. **Synthetic Traffic & Failure Simulator**: Built-in traffic generator capable of dispatching realistic eCommerce checkout, authentication, and search flows with configurable latency anomalies and HTTP 504 timeouts.
6. **Native Relational Persistence**: Powered by Node 24 native `node:sqlite` in WAL mode, delivering sub-millisecond query performance and zero-dependency local execution.

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph Client ["Frontend (React 19 + TypeScript + Vite)"]
        UI[TracePulse Operations Dashboard]
        Explorer[Trace Explorer & Filter Bar]
        Waterfall[Interactive Gantt Waterfall]
        Matrix[Service APM Percentiles Matrix]
        Topology[SVG Service Topology Graph]
        W3CMod[W3C Context Inspector Modal]
        SimMod[Synthetic Traffic Simulator Modal]

        UI --> Explorer
        Explorer --> Waterfall
        UI --> Matrix
        UI --> Topology
        UI --> W3CMod
        UI --> SimMod
    end

    subgraph Server ["Backend (Node.js 24 + Express + Native SQLite WAL)"]
        API[Express REST Gateway /api]
        Ingest[Span Ingestion Service]
        TreeBuilder[DAG Span Tree Reconstructor]
        W3CParser[W3C TraceContext Parser]
        PercentileCalc[Quantile Math Engine]
        GraphService[Service Topology Extractor]
        TrafficSim[Synthetic Microservice Simulator]

        API --> Ingest
        API --> TreeBuilder
        API --> W3CParser
        API --> PercentileCalc
        API --> GraphService
        API --> TrafficSim
    end

    subgraph Storage ["Relational Storage"]
        DB[(SQLite WAL Database)]
        T[traces]
        S[spans (Indexed by trace_id & service)]
        
        Ingest --> T
        Ingest --> S
    end

    UI <-->|REST API /api/traces| API
    SimMod -->|POST /api/simulate| TrafficSim
```

---

## 🚀 Quick Start (Zero-Config)

### Prerequisites
- Node.js 24+ (uses native `node:sqlite`)
- npm 10+

### Local Development
```bash
# 1. Clone repository
git clone https://github.com/Taan1el/tracepulse.git
cd tracepulse

# 2. Install workspace dependencies
npm install

# 3. Start backend API and frontend Vite dev server concurrently
npm run dev

# Backend runs at:  http://localhost:4000
# Frontend runs at: http://localhost:5173
```

### Running Automated Tests
```bash
# Run all unit and integration tests (18 passing across server and client)
npm test

# Run TypeScript type-checks and linting across workspaces
npm run lint

# Build production bundles
npm run build
```

### Docker Deployment
```bash
# Spin up production container with persistent SQLite volume
docker compose up --build
# Open http://localhost:4000 in your browser
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck and engine status |
| `POST` | `/api/traces` | Ingest OpenTelemetry-compatible span records |
| `GET` | `/api/traces` | Query traces with filters (`service`, `minDuration`, `hasError`, `limit`) |
| `GET` | `/api/traces/:id` | Retrieve full trace details with reconstructed hierarchical span tree |
| `GET` | `/api/services` | Retrieve service APM metrics (P50, P90, P95, P99, error rate, throughput) |
| `GET` | `/api/services/graph` | Derive service dependency topology graph (nodes and directed edges) |
| `POST` | `/api/simulate` | Trigger synthetic multi-microservice trace traffic (`checkout`, `auth`, `batch`) |
| `GET` | `/api/w3c/parse` | Parse and validate W3C `traceparent` header and generate next child span |
| `GET` | `/api/w3c/context` | Generate new valid W3C TraceContext tuple (`traceId`, `spanId`, `traceparent`) |

---

## 📐 Architecture Decision Records (ADRs)

Detailed architectural rationale:
- [ADR 001: Native SQLite WAL and Relational Span Storage Architecture](docs/adr/001-native-sqlite-wal-and-relational-span-storage.md)
- [ADR 002: W3C Trace Context Propagation and DAG Span Tree Reconstruction](docs/adr/002-w3c-tracecontext-propagation-and-dag-span-tree-reconstruction.md)
- [ADR 003: Real-Time Latency Percentiles and Service Topology Derivation](docs/adr/003-real-time-latency-percentiles-and-service-topology-derivation.md)

---

## 🧪 Verification & Quality Checklist

- [x] **18 Automated Tests Passing** (12 backend integration + 6 frontend component tests).
- [x] **Zero External Database Overhead**: Native Node 24 SQLite WAL engine with sub-millisecond query execution.
- [x] **OpenTelemetry & W3C Compliant**: Strict validation of 32-hex trace IDs and 16-hex span IDs.
- [x] **Full TypeScript Strict Compliance**: End-to-end type safety sharing `shared/types.ts` between client and server.
- [x] **Multi-Stage Docker & Compose**: Production container with health check and persistent data volume.

### Trace query parameters

`GET /api/traces` accepts optional `service`, `minDuration`, `maxDuration`,
`hasError`, and `limit` filters. Each must occur at most once and contain a
non-empty scalar value. Unknown query keys are ignored.

- `service`: a non-blank, exact, case-sensitive service name matching the root
  service or any service in the trace. Characters such as `%` and `_` are literal,
  not wildcards; URL-encode special characters in query values.
- `minDuration` / `maxDuration`: finite, non-negative decimal milliseconds
  (scientific notation supported). Bounds are inclusive; minimum cannot exceed maximum.
- `hasError`: exactly `true` or `false`; omit to include both.
- `limit`: digits representing an integer from 1 through 100; defaults to 50.

Invalid filters return HTTP 400 with `{ "success": false, "error": "..." }`
without querying storage. Valid queries return traces newest first.
