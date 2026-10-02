# ADR 002: W3C Trace Context Propagation and DAG Span Tree Reconstruction

## Status
Accepted

## Context
Distributed tracing systems must be interoperable with the broader cloud-native observability ecosystem. Modern applications adhere to the W3C Trace Context specification (`traceparent: 00-{trace_id}-{parent_id}-{flags}`), which provides a standardized header format to correlate downstream requests across diverse programming languages and network boundaries. Furthermore, incoming spans arrive asynchronously and out-of-order; the system must reconstruct the true execution Directed Acyclic Graph (DAG) and pinpoint critical performance bottlenecks.

## Decision
1. **W3C Trace Context Standard Support**:
   - Implement standard-compliant parser and validator enforcing 32-hex `traceId` and 16-hex `spanId` constraints, validating version `00`, and rejecting invalid/all-zero identifiers.
   - Implement context propagation generating next child span contexts (`traceparent`) for downstream HTTP and messaging calls.

2. **Hierarchical DAG Span Tree & Bottleneck Analysis**:
   - Spans are assembled into a hierarchical tree based on `parentSpanId`.
   - The tree builder calculates relative time offsets from the trace start time (`offsetMs`) and duration proportions (`durationPercent`).
   

## Consequences
- **Positive**: The header format follows the W3C Trace Context fields (version, trace ID, parent ID, flags). Only the `traceparent` header is handled, not `tracestate`.
- **Positive**: The waterfall shows each span's offset and duration within the trace, so a slow downstream service or query is visible next to its parent.
