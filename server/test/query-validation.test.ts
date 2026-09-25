import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

describe('Trace query filters', () => {
  let ctx: AppContext;

  beforeEach(() => {
    ctx = createApp(':memory:', false);
    for (let i = 1; i <= 55; i++) {
      ctx.traceService.ingestSpans([{
        id: i.toString(16).padStart(16, '0'),
        traceId: i.toString(16).padStart(32, '0'),
        parentSpanId: null,
        serviceName: i % 2 ? 'gateway' : 'worker',
        name: 'process', kind: 'SERVER', startTimeMs: i * 1000,
        endTimeMs: i * 1000 + i + 0.5,
        statusCode: i % 2 ? 'OK' : 'ERROR', attributes: {},
      }]);
    }
  });

  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  it.each([
    'limit=-1', 'limit=0', 'limit=101', 'limit=1.5', 'limit=2junk',
    'limit=', 'limit=NaN', 'limit=Infinity', 'limit=1&limit=2',
    'minDuration=-1', 'minDuration=2ms', 'minDuration=NaN',
    'minDuration=Infinity', 'minDuration=', 'minDuration=%20',
    'maxDuration=-1', 'maxDuration=Infinity', 'maxDuration=3ms',
    'maxDuration=1&maxDuration=2', 'minDuration=1&minDuration=2',
    'minDuration=20&maxDuration=10', 'hasError=1', 'hasError=False',
    'hasError=', 'hasError=true&hasError=false', 'service=',
    'service=%20', 'service=gateway&service=worker',
    'limit[value]=1', 'minDuration[value]=1', 'maxDuration[value]=1',
    'hasError[value]=true', 'service[value]=gateway',
    'minDuration=0x10', 'maxDuration=1e309', 'limit=0x10',
  ])('rejects malformed query %s before accessing storage', async (query) => {
    const spy = vi.spyOn(ctx.traceRepo, 'queryTraces');
    const res = await request(ctx.app).get(`/api/traces?${query}`);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: expect.any(String) });
    expect(spy).not.toHaveBeenCalled();
  });

  it('defaults to 50 results and honors both limit boundaries', async () => {
    for (const [query, count] of [['', 50], ['?limit=1', 1], ['?limit=100', 55]] as const) {
      const res = await request(ctx.app).get(`/api/traces${query}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(count);
    }
  });

  it('combines service, decimal duration bounds and false error filters', async () => {
    const res = await request(ctx.app).get('/api/traces?service=gateway&minDuration=3.5&maxDuration=3.5&hasError=false');
    expect(res.status).toBe(200);
    expect(res.body.data.map((trace: { durationMs: number }) => trace.durationMs)).toEqual([3.5]);
  });

  it('supports zero duration and true error filters', async () => {
    const res = await request(ctx.app).get('/api/traces?minDuration=0&maxDuration=2.5&hasError=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map((trace: { durationMs: number }) => trace.durationMs)).toEqual([2.5]);
  });

  it('keeps unexpected storage failures as server errors', async () => {
    vi.spyOn(ctx.traceRepo, 'queryTraces').mockImplementation(() => { throw new Error('Storage unavailable'); });
    expect((await request(ctx.app).get('/api/traces')).status).toBe(500);
  });
});
