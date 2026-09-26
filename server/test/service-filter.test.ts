import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

describe('Exact trace service filtering', () => {
  let ctx: AppContext;
  let sequence: number;

  beforeEach(() => {
    ctx = createApp(':memory:', false);
    sequence = 0;
  });

  afterEach(() => ctx.db.close());

  function ingest(serviceName: string, durationMs = 10, hasError = false, root = false) {
    const index = ++sequence;
    const traceId = index.toString(16).padStart(32, '0');
    const rootId = (index * 2).toString(16).padStart(16, '0');
    const startTimeMs = index * 1000;
    ctx.traceService.ingestSpans([
      {
        id: rootId, traceId, parentSpanId: null,
        serviceName: root ? serviceName : 'gateway', name: 'request', kind: 'SERVER',
        startTimeMs, endTimeMs: startTimeMs + durationMs,
        statusCode: hasError ? 'ERROR' : 'OK', attributes: {},
      },
      {
        id: (index * 2 + 1).toString(16).padStart(16, '0'), traceId,
        parentSpanId: rootId, serviceName, name: 'process', kind: 'CLIENT',
        startTimeMs, endTimeMs: startTimeMs + durationMs,
        statusCode: 'OK', attributes: {},
      },
    ]);
    return traceId;
  }

  it.each([
    ['billing%', 'billing-worker'],
    ['billing_', 'billing1'],
    ['%', 'unrelated'],
    ['_', 'x'],
    ['Billing', 'billing'],
    ['billing', 'Billing'],
    ['bill"ing', 'billing'],
    ['bill\\ing', 'billing'],
    ['bill\ning', 'billing'],
    ['billing', 'billing-worker'],
    ["billing' OR 1=1 --", 'billing'],
    ['arveldus-õ', 'arveldus-o'],
  ])('matches the literal child service %j only', async (service, other) => {
    const expectedId = ingest(service);
    ingest(other);
    const res = await request(ctx.app).get('/api/traces').query({ service });
    expect(res.status).toBe(200);
    expect(res.body.data.map((trace: { id: string }) => trace.id)).toEqual([expectedId]);
  });

  it('returns each root-service match once even when multiple spans share the service', async () => {
    const expectedId = ingest('billing', 10, false, true);
    ingest('Billing', 10, false, true);
    const res = await request(ctx.app).get('/api/traces').query({ service: 'billing' });
    expect(res.status).toBe(200);
    expect(res.body.data.map((trace: { id: string }) => trace.id)).toEqual([expectedId]);
  });

  it('applies exact membership before duration, error, ordering and limit selection', async () => {
    ingest('worker_', 20, true);
    const expectedId = ingest('worker_', 20, true);
    ingest('worker_', 20, false);
    ingest('worker_', 21, true);
    ingest('worker_', 19, true);
    ingest('worker1', 20, true);
    const res = await request(ctx.app).get('/api/traces').query({
      service: 'worker_', minDuration: 20, maxDuration: 20, hasError: true, limit: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.map((trace: { id: string }) => trace.id)).toEqual([expectedId]);
  });

  it('returns an empty list for an absent service and preserves unfiltered queries', async () => {
    const id = ingest('worker');
    const missing = await request(ctx.app).get('/api/traces').query({ service: 'absent' });
    expect(missing.status).toBe(200);
    expect(missing.body.data).toEqual([]);
    const all = await request(ctx.app).get('/api/traces');
    expect(all.status).toBe(200);
    expect(all.body.data.map((trace: { id: string }) => trace.id)).toEqual([id]);
  });
});
