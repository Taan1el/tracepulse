import type { ServiceDependencyEdge, ServiceMetric, TraceSummary } from './types.js';
import { computeLatencyStats } from './percentile.js';

export interface SpanMetricRow {
  serviceName: string;
  durationMs: number;
  statusCode: string;
}

export interface SpanLinkRow {
  id: string;
  parentSpanId?: string | null;
  serviceName: string;
  durationMs: number;
  statusCode: string;
}

export interface TraceFilter {
  serviceName?: string;
  minDurationMs?: number;
  maxDurationMs?: number;
  hasError?: boolean;
  limit?: number;
}

/** Per-service latency percentiles and error rates over every span row, sorted by service name. */
export function computeServiceMetrics(rows: SpanMetricRow[]): ServiceMetric[] {
  const byService = new Map<string, SpanMetricRow[]>();
  for (const row of rows) {
    const list = byService.get(row.serviceName);
    if (list) list.push(row);
    else byService.set(row.serviceName, [row]);
  }

  return [...byService.keys()].sort().map((serviceName) => {
    const spans = byService.get(serviceName)!;
    const stats = computeLatencyStats(spans.map((s) => s.durationMs));
    const errorCount = spans.filter((s) => s.statusCode === 'ERROR').length;
    return {
      serviceName,
      requestCount: spans.length,
      errorCount,
      errorRate: Math.round((errorCount / spans.length) * 10000) / 100,
      avgDurationMs: stats.avgMs,
      p50Ms: stats.p50Ms,
      p90Ms: stats.p90Ms,
      p95Ms: stats.p95Ms,
      p99Ms: stats.p99Ms,
    };
  });
}

/** Calls between services: a child span whose parent runs in a different service. */
export function computeDependencies(rows: SpanLinkRow[]): ServiceDependencyEdge[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const edgeMap = new Map<string, { source: string; target: string; durations: number[]; errorCount: number }>();

  for (const child of rows) {
    const parent = child.parentSpanId ? byId.get(child.parentSpanId) : undefined;
    if (!parent || parent.serviceName === child.serviceName) continue;
    const key = `${parent.serviceName}->${child.serviceName}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { source: parent.serviceName, target: child.serviceName, durations: [], errorCount: 0 };
      edgeMap.set(key, entry);
    }
    entry.durations.push(child.durationMs);
    if (child.statusCode === 'ERROR') entry.errorCount++;
  }

  return [...edgeMap.entries()].map(([id, entry]) => {
    const sum = entry.durations.reduce((a, b) => a + b, 0);
    return {
      id,
      source: entry.source,
      target: entry.target,
      callCount: entry.durations.length,
      avgDurationMs: Math.round((sum / entry.durations.length) * 100) / 100,
      errorCount: entry.errorCount,
    };
  });
}

/** Same filtering and ordering the SQL query applies: newest first, default limit 50. */
export function filterTraces(traces: TraceSummary[], filter: TraceFilter = {}): TraceSummary[] {
  return traces
    .filter((t) => {
      if (filter.serviceName && t.rootServiceName !== filter.serviceName && !t.services.includes(filter.serviceName)) {
        return false;
      }
      if (filter.minDurationMs !== undefined && t.durationMs < filter.minDurationMs) return false;
      if (filter.maxDurationMs !== undefined && t.durationMs > filter.maxDurationMs) return false;
      if (filter.hasError !== undefined && t.hasError !== filter.hasError) return false;
      return true;
    })
    .sort((a, b) => b.startTimeMs - a.startTimeMs)
    .slice(0, filter.limit || 50);
}
