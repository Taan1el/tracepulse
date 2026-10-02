import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

const TRACE_ID = 'a'.repeat(32);

function payload(traceId: string, spanIds: [string, string]) {
  return {
    spans: [
      {
        id: spanIds[0], traceId, parentSpanId: null, serviceName: 'gateway', name: 'GET /items',
        kind: 'SERVER', startTimeMs: 1000, endTimeMs: 1100, statusCode: 'OK', attributes: { 'http.status_code': 200 },
      },
      {
        id: spanIds[1], traceId, parentSpanId: spanIds[0], serviceName: 'db', name: 'SELECT',
        kind: 'CLIENT', startTimeMs: 1010, endTimeMs: 1060, statusCode: 'OK', attributes: {},
      },
    ],
  };
}

describe('API routes', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createApp(':memory:', false);
  });

  afterEach(() => {
    ctx.db.close();
    vi.restoreAllMocks();
  });

  it('returns 404 for an unknown trace id', async () => {
    const res = await request(ctx.app).get(`/api/traces/${TRACE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('returns empty collections before anything is ingested', async () => {
    expect((await request(ctx.app).get('/api/traces')).body.data).toEqual([]);
    expect((await request(ctx.app).get('/api/services')).body.data).toEqual([]);
    expect((await request(ctx.app).get('/api/services/graph')).body.data).toEqual({ nodes: [], edges: [] });
  });

  it('rejects an ingest body without a spans array', async () => {
    const res = await request(ctx.app).post('/api/traces').send({ spans: 'nope' });
    expect(res.status).toBe(400);
  });

  it('reports no throughput field in service metrics', async () => {
    await request(ctx.app).post('/api/traces').send(payload(TRACE_ID, ['1'.repeat(16), '2'.repeat(16)]));
    const res = await request(ctx.app).get('/api/services');
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).not.toHaveProperty('throughputRps');
    expect(res.body.data[0]).toMatchObject({ serviceName: 'db', requestCount: 1, errorRate: 0 });
  });

  it('derives topology nodes and cross-service edges from ingested traces', async () => {
    await request(ctx.app).post('/api/traces').send(payload(TRACE_ID, ['1'.repeat(16), '2'.repeat(16)]));
    const res = await request(ctx.app).get('/api/services/graph');
    expect(res.body.data.nodes.map((n: { id: string }) => n.id)).toEqual(['db', 'gateway']);
    expect(res.body.data.edges).toEqual([
      { id: 'gateway->db', source: 'gateway', target: 'db', callCount: 1, avgDurationMs: 50, errorCount: 0 },
    ]);
  });

  it('returns the reconstructed tree with a bottleneck on the slowest child', async () => {
    await request(ctx.app).post('/api/traces').send(payload(TRACE_ID, ['1'.repeat(16), '2'.repeat(16)]));
    const res = await request(ctx.app).get(`/api/traces/${TRACE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.rootSpan.children).toHaveLength(1);
    expect(res.body.data.rootSpan.children[0].isBottleneck).toBe(true);
    expect(res.body.data.summary.httpStatus).toBe(200);
  });

  it('replaces the spans of a trace that is ingested again', async () => {
    await request(ctx.app).post('/api/traces').send(payload(TRACE_ID, ['1'.repeat(16), '2'.repeat(16)]));
    await request(ctx.app).post('/api/traces').send(payload(TRACE_ID, ['3'.repeat(16), '4'.repeat(16)]));
    const res = await request(ctx.app).get(`/api/traces/${TRACE_ID}`);
    expect(res.body.data.rawSpans.map((s: { id: string }) => s.id).sort()).toEqual(['3'.repeat(16), '4'.repeat(16)]);
    expect((await request(ctx.app).get('/api/traces')).body.data).toHaveLength(1);
  });

  it('generates a context that parses back to the same ids', async () => {
    const ctxRes = await request(ctx.app).get('/api/w3c/context');
    const { traceId, spanId, traceparent } = ctxRes.body.data;
    expect(traceparent).toBe(`00-${traceId}-${spanId}-01`);

    const parsed = await request(ctx.app).get('/api/w3c/parse').query({ traceparent });
    expect(parsed.status).toBe(200);
    expect(parsed.body.data.parsed.traceId).toBe(traceId);
    expect(parsed.body.data.propagatedHeader).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(parsed.body.data.propagatedHeader).not.toBe(traceparent);
  });

  it('accepts the traceparent as a request header and rejects invalid or missing values', async () => {
    const ok = await request(ctx.app).get('/api/w3c/parse').set('traceparent', `00-${TRACE_ID}-${'b'.repeat(16)}-00`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.parsed.traceFlags).toBe('00');

    expect((await request(ctx.app).get('/api/w3c/parse')).status).toBe(400);
    expect((await request(ctx.app).get('/api/w3c/parse').query({ traceparent: 'ff-bad' })).status).toBe(400);
    const zero = `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`;
    expect((await request(ctx.app).get('/api/w3c/parse').query({ traceparent: zero })).status).toBe(400);
  });

  it('simulates a single flow and a batch, and stores them', async () => {
    const single = await request(ctx.app).post('/api/simulate').send({ flowType: 'auth', injectAnomaly: true });
    expect(single.status).toBe(200);
    expect(single.body.data.summary.hasError).toBe(true);

    const batch = await request(ctx.app).post('/api/simulate').send({ flowType: 'batch', batchCount: 6 });
    expect(batch.body.count).toBe(6);
    expect((await request(ctx.app).get('/api/traces')).body.data).toHaveLength(7);
  });

  it('hides internal error details on unexpected failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(ctx.traceService, 'getServiceMetrics').mockImplementation(() => {
      throw new Error('disk exploded at /secret/path');
    });
    const res = await request(ctx.app).get('/api/services');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to retrieve services');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
