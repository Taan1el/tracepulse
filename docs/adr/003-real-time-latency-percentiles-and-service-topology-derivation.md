# ADR 003: Real-Time Latency Percentiles and Service Topology Derivation

## Status
Accepted

## Context
Average latency figures often hide devastating tail latency spikes that impact end users and violate service level agreements (SLAs). Observability platforms must calculate exact statistical percentiles:
- **P50 (Median)**: The expected typical experience for 50% of requests.
- **P90 & P95**: Crucial for SLA guarantees and identifying recurring degradation.
- **P99 (Tail Latency)**: Extreme latency outliers caused by GC pauses, database locks, or network congestion.

Additionally, microservice architectures evolve continuously; statically configured service maps quickly become obsolete. The platform must dynamically discover service dependencies directly from live trace traffic.

## Decision
1. **In-Engine Statistical Quantile Computation**:
   - Implement numeric interpolation quantile calculation without external heavy libraries.
   - Aggregate spans by `service_name` to report accurate P50, P90, P95, and P99 metrics along with error rates and throughput (RPS).

2. **Dynamic Service Topology Extraction**:
   - Query parent-child span pairs where `parent.service_name != child.service_name`.
   - Aggregate call counts, error rates, and average transition latencies.
   - Project the resulting graph into an interactive SVG Directed Acyclic Graph (DAG) visualizing service interactions, edge volumes, and health indicators.

## Consequences
- **Positive**: Actionable APM insights allowing SREs and developers to spot degraded services before cascading outages occur.
- **Positive**: Zero manual configuration needed for service dependency mapping; automatically discovered as traffic traverses the system.
