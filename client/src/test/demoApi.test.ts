import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRng,
  fetchTraces,
  fetchTraceById,
  fetchServices,
  fetchTopology,
  simulateTraffic,
  parseTraceparentHeader,
  generateW3CContext,
  resetDemoData,
} from '../services/demoApi.js';
import type { TraceDetail, TraceSummary } from '../../../shared/types.js';

// The demo data layer is the whole backend on GitHub Pages, so it gets the
// coverage the server's integration tests give the real API.
describe('demoApi', () => {
  beforeEach(() => resetDemoData());

  it('seeded generator repeats its sequence', () => {
    const a = createRng(7);
    const b = createRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(createRng(8)()).not.toBe(createRng(7)());
  });

  it('starts with the same 15 sample traces every time', async () => {
    const first = await fetchTraces();
    resetDemoData();
    const second = await fetchTraces();

    expect(first).toHaveLength(15);
    expect(second.map((t) => t.id)).toEqual(first.map((t) => t.id));
    expect(first.filter((t) => t.hasError)).toHaveLength(3);
    expect(first.every((t) => /^[0-9a-f]{32}$/.test(t.id))).toBe(true);
    // Newest first.
    expect(first.map((t) => t.startTimeMs)).toEqual([...first.map((t) => t.startTimeMs)].sort((a, b) => b - a));
  });

  it('filters like the server query', async () => {
    const all = await fetchTraces();
    const errors = await fetchTraces({ hasError: true });
    expect(errors.every((t) => t.hasError)).toBe(true);

    const slow = await fetchTraces({ minDuration: 500 });
    expect(slow.length).toBeGreaterThan(0);
    expect(slow.every((t) => t.durationMs >= 500)).toBe(true);

    const postgres = await fetchTraces({ service: 'postgres-db' });
    expect(postgres.length).toBeGreaterThan(0);
    expect(postgres.every((t) => t.services.includes('postgres-db'))).toBe(true);

    expect(await fetchTraces({ limit: 4 })).toHaveLength(4);
    expect(await fetchTraces({ service: 'missing-service' })).toEqual([]);
    expect(all.length).toBe(15);
  });

  it('returns a trace tree and rejects unknown ids', async () => {
    const [first] = await fetchTraces();
    const detail = await fetchTraceById(first.id);
    expect(detail.summary.id).toBe(first.id);
    expect(detail.rootSpan.depth).toBe(0);
    expect(detail.rawSpans).toHaveLength(first.spanCount);

    await expect(fetchTraceById('f'.repeat(32))).rejects.toThrow(/Trace not found/);
  });

  it('computes service metrics and call edges from the sample spans', async () => {
    const services = await fetchServices();
    expect(services.map((s) => s.serviceName)).toContain('api-gateway');
    expect(services.every((s) => s.p50Ms <= s.p95Ms && s.p95Ms <= s.p99Ms)).toBe(true);
    expect(services.some((s) => s.errorCount > 0)).toBe(true);

    const topology = await fetchTopology();
    expect(topology.nodes).toHaveLength(services.length);
    expect(topology.edges.some((e) => e.source === 'api-gateway' && e.target === 'auth-service')).toBe(true);
  });

  it('simulates a single trace of the requested flow, with a failure on request', async () => {
    const trace = (await simulateTraffic({ flowType: 'auth', injectAnomaly: true })) as TraceDetail;
    expect(trace.rootSpan.name).toBe('POST /auth/token');
    expect(trace.summary.hasError).toBe(true);
    expect(await fetchTraces()).toHaveLength(16);
    expect((await fetchTraces())[0].id).toBe(trace.summary.id);
  });

  it('simulates batches', async () => {
    const batch = (await simulateTraffic({ flowType: 'batch', batchCount: 10 })) as TraceSummary[];
    expect(batch).toHaveLength(10);
    expect(await fetchTraces({ limit: 100 })).toHaveLength(25);
    expect(((await simulateTraffic({ flowType: 'batch' })) as TraceSummary[])).toHaveLength(5);
  });

  it('resets back to the sample traces', async () => {
    await simulateTraffic({ flowType: 'batch', batchCount: 3 });
    resetDemoData();
    expect(await fetchTraces({ limit: 100 })).toHaveLength(15);
  });

  it('parses traceparent headers and generates new contexts', async () => {
    const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const result = await parseTraceparentHeader(header);
    expect(result.parsed.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(result.propagatedHeader).toBe(`00-4bf92f3577b34da6a3ce929d0e0e4736-${result.childSpanId}-01`);

    await expect(parseTraceparentHeader('nope')).rejects.toThrow('Invalid W3C traceparent header format');
    await expect(parseTraceparentHeader('  ')).rejects.toThrow('Missing traceparent');
    await expect(parseTraceparentHeader(`00-${'0'.repeat(32)}-00f067aa0ba902b7-01`)).rejects.toThrow('Invalid');

    const context = await generateW3CContext();
    expect(context.traceparent).toBe(`00-${context.traceId}-${context.spanId}-01`);
    expect((await parseTraceparentHeader(context.traceparent)).parsed.traceId).toBe(context.traceId);
  });
});
