import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

describe('Simulation request validation', () => {
  let ctx: AppContext;

  beforeEach(() => { ctx = createApp(':memory:', false); });
  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  const invalid = [
    [], [{ flowType: 'auth' }],
    ...['', 'unknown', 'Checkout', null, 1, false, [], {}].map(flowType => ({ flowType })),
    ...['false', 'true', 0, 1, null, [], {}].map(injectAnomaly => ({ injectAnomaly })),
    ...[0, -1, 21, 1.5, '2', '', null, false, [], {}, 1e100].map(batchCount => ({ batchCount })),
    { flowType: 'batch', injectAnomaly: 'false' },
    { flowType: 'unknown', batchCount: 2 },
  ];

  it.each(invalid.map(body => ({ body })))('rejects invalid payload $body without generating or storing traces', async ({ body }) => {
    const flow = vi.spyOn(ctx.simulatorService, 'simulateFlow');
    const batch = vi.spyOn(ctx.simulatorService, 'simulateBatch');
    const res = await request(ctx.app).post('/api/simulate').send(body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
    expect(flow).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(ctx.traceService.queryTraces()).toEqual([]);
  });

  it('preserves default simulation for an absent body', async () => {
    const res = await request(ctx.app).post('/api/simulate');
    expect(res.status).toBe(200);
    expect(res.body.data.summary.hasError).toBe(false);
    expect(ctx.traceService.queryTraces()).toHaveLength(1);
  });

  it('defaults an empty object to one healthy checkout trace', async () => {
    const res = await request(ctx.app).post('/api/simulate').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.summary.rootSpanName).toBe('POST /api/v1/checkout');
    expect(res.body.data.summary.hasError).toBe(false);
    expect(ctx.traceService.queryTraces()).toHaveLength(1);
  });

  it.each(['checkout', 'auth', 'search'])('honors both anomaly booleans for %s', async flowType => {
    for (const injectAnomaly of [false, true]) {
      const res = await request(ctx.app).post('/api/simulate').send({ flowType, injectAnomaly });
      expect(res.status).toBe(200);
      expect(res.body.data.summary.hasError).toBe(injectAnomaly);
    }
    expect(ctx.traceService.queryTraces()).toHaveLength(2);
  });

  it.each([1, 20])('honors batch count boundary %i', async batchCount => {
    const res = await request(ctx.app).post('/api/simulate').send({ flowType: 'batch', batchCount });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(batchCount);
    expect(res.body.data).toHaveLength(batchCount);
    expect(ctx.traceService.queryTraces()).toHaveLength(batchCount);
  });

  it('defaults explicit batches to five traces', async () => {
    const res = await request(ctx.app).post('/api/simulate').send({ flowType: 'batch' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(5);
    expect(ctx.traceService.queryTraces()).toHaveLength(5);
  });

  it('preserves count-based batch selection', async () => {
    const res = await request(ctx.app).post('/api/simulate').send({ batchCount: 2 });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(ctx.traceService.queryTraces()).toHaveLength(2);
  });

  it('preserves single-flow selection with count one', async () => {
    const res = await request(ctx.app).post('/api/simulate').send({ flowType: 'auth', batchCount: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.summary.rootSpanName).toBe('POST /auth/token');
    expect(ctx.traceService.queryTraces()).toHaveLength(1);
  });

  it('keeps unexpected generation failures as server errors', async () => {
    vi.spyOn(ctx.simulatorService, 'simulateFlow').mockImplementation(() => { throw new Error('Storage unavailable'); });
    const res = await request(ctx.app).post('/api/simulate').send({});
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
