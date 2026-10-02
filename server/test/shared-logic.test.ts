import { describe, expect, it } from 'vitest';
import { computeDependencies, computeServiceMetrics, filterTraces } from '../../shared/analytics.js';
import { buildFlowSpans, FLOW_TYPES, type FlowEnv } from '../../shared/flows.js';
import { buildTraceFromInput } from '../../shared/trace-builder.js';
import { generateSpanId, generateTraceId, isValidSpanId, isValidTraceId } from '../../shared/traceparent.js';
import type { TraceSummary } from '../../shared/types.js';

function sequenceEnv(): FlowEnv {
  let n = 0;
  return {
    random: () => 0.5,
    spanId: () => (++n).toString(16).padStart(16, '0'),
  };
}

function summary(id: string, overrides: Partial<TraceSummary>): TraceSummary {
  return {
    id,
    rootSpanName: 'GET /',
    rootServiceName: 'gateway',
    startTimeMs: 0,
    durationMs: 10,
    spanCount: 1,
    services: ['gateway'],
    hasError: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('computeServiceMetrics', () => {
  it('returns nothing for no spans', () => {
    expect(computeServiceMetrics([])).toEqual([]);
  });

  it('groups by service, sorts by name and computes error rate and percentiles', () => {
    const metrics = computeServiceMetrics([
      { serviceName: 'b', durationMs: 10, statusCode: 'OK' },
      { serviceName: 'a', durationMs: 20, statusCode: 'ERROR' },
      { serviceName: 'a', durationMs: 40, statusCode: 'OK' },
      { serviceName: 'a', durationMs: 60, statusCode: 'OK' },
      { serviceName: 'a', durationMs: 80, statusCode: 'OK' },
    ]);
    expect(metrics.map((m) => m.serviceName)).toEqual(['a', 'b']);
    expect(metrics[0]).toMatchObject({ requestCount: 4, errorCount: 1, errorRate: 25, avgDurationMs: 50, p50Ms: 50 });
    expect(metrics[1]).toMatchObject({ requestCount: 1, errorRate: 0, p99Ms: 10 });
  });
});

describe('computeDependencies', () => {
  const row = (id: string, parentSpanId: string | null, serviceName: string, durationMs: number, statusCode = 'OK') => ({
    id, parentSpanId, serviceName, durationMs, statusCode,
  });

  it('counts only calls that cross a service boundary', () => {
    const edges = computeDependencies([
      row('1', null, 'gateway', 100),
      row('2', '1', 'gateway', 90),
      row('3', '1', 'auth', 20),
      row('4', '1', 'auth', 40, 'ERROR'),
    ]);
    expect(edges).toEqual([
      { id: 'gateway->auth', source: 'gateway', target: 'auth', callCount: 2, avgDurationMs: 30, errorCount: 1 },
    ]);
  });

  it('ignores spans whose parent is missing', () => {
    expect(computeDependencies([row('2', 'ffff', 'auth', 5)])).toEqual([]);
  });
});

describe('filterTraces', () => {
  const traces = [
    summary('a', { startTimeMs: 1, durationMs: 5, services: ['gateway', 'db'] }),
    summary('b', { startTimeMs: 3, durationMs: 50, hasError: true }),
    summary('c', { startTimeMs: 2, durationMs: 500, rootServiceName: 'worker', services: ['worker'] }),
  ];

  it('orders newest first and applies the limit', () => {
    expect(filterTraces(traces).map((t) => t.id)).toEqual(['b', 'c', 'a']);
    expect(filterTraces(traces, { limit: 1 }).map((t) => t.id)).toEqual(['b']);
  });

  it('matches the service as root or member, and applies inclusive duration bounds', () => {
    expect(filterTraces(traces, { serviceName: 'db' }).map((t) => t.id)).toEqual(['a']);
    expect(filterTraces(traces, { serviceName: 'worker' }).map((t) => t.id)).toEqual(['c']);
    expect(filterTraces(traces, { minDurationMs: 50, maxDurationMs: 500 }).map((t) => t.id)).toEqual(['b', 'c']);
  });

  it('filters by error state', () => {
    expect(filterTraces(traces, { hasError: true }).map((t) => t.id)).toEqual(['b']);
    expect(filterTraces(traces, { hasError: false }).map((t) => t.id)).toEqual(['c', 'a']);
  });
});

describe('flow builders', () => {
  it.each(FLOW_TYPES)('%s flow produces a valid, ingestible trace', (flow) => {
    const traceId = '1'.repeat(32);
    const spans = buildFlowSpans(sequenceEnv(), flow, traceId, 1_000_000, false);
    const detail = buildTraceFromInput(spans, new Date('2026-01-01T00:00:00Z'));
    expect(detail.summary.id).toBe(traceId);
    expect(detail.summary.hasError).toBe(false);
    expect(detail.summary.spanCount).toBe(spans.length);
    expect(detail.summary.services.length).toBeGreaterThan(1);
  });

  it.each(FLOW_TYPES)('%s flow with an anomaly carries an error span', (flow) => {
    const spans = buildFlowSpans(sequenceEnv(), flow, '2'.repeat(32), 1_000_000, true);
    expect(buildTraceFromInput(spans).summary.hasError).toBe(true);
  });

  it('is deterministic for a fixed environment', () => {
    const a = buildFlowSpans(sequenceEnv(), 'checkout', '3'.repeat(32), 5, false);
    const b = buildFlowSpans(sequenceEnv(), 'checkout', '3'.repeat(32), 5, false);
    expect(a).toEqual(b);
  });
});

describe('id generation', () => {
  it('produces valid hex ids of the right length', () => {
    expect(isValidTraceId(generateTraceId())).toBe(true);
    expect(isValidSpanId(generateSpanId())).toBe(true);
    expect(generateTraceId()).not.toBe(generateTraceId());
  });
});
