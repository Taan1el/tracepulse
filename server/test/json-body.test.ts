import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

describe.each(['/api/traces', '/api/simulate'])('JSON body errors on %s', endpoint => {
  let ctx: AppContext;

  beforeEach(() => { ctx = createApp(':memory:', false); });
  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  const cases = [
    { name: 'truncated JSON', body: '{"privateValue":"do-not-echo"', status: 400, error: 'Invalid JSON body' },
    { name: 'trailing comma', body: '{"spans":[],}', status: 400, error: 'Invalid JSON body' },
    { name: 'null', body: 'null', status: 400, error: 'Invalid JSON body' },
    { name: 'scalar', body: '42', status: 400, error: 'Invalid JSON body' },
    { name: 'oversized body', body: JSON.stringify({ value: 'x'.repeat(10 * 1024 * 1024) }), status: 413, error: 'JSON body exceeds the 10 MB limit' },
    { name: 'unsupported charset', body: '{}', contentType: 'application/json; charset=iso-8859-1', status: 415, error: 'Unsupported JSON charset' },
    { name: 'unsupported encoding', body: '{}', encoding: 'unsupported', status: 415, error: 'Unsupported content encoding' },
  ];

  it.each(cases)('rejects $name before reaching services', async ({ body, status, error, contentType, encoding }) => {
    const ingest = vi.spyOn(ctx.traceService, 'ingestSpans');
    const simulate = vi.spyOn(ctx.simulatorService, 'simulateFlow');
    const batch = vi.spyOn(ctx.simulatorService, 'simulateBatch');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const req = request(ctx.app).post(endpoint).set('Content-Type', contentType ?? 'application/json');
    if (encoding) req.set('Content-Encoding', encoding);
    const res = await req.send(body);
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ success: false, error });
    expect(ingest).not.toHaveBeenCalled();
    expect(simulate).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(ctx.traceService.queryTraces()).toEqual([]);
    expect(log).not.toHaveBeenCalled();
    expect((await request(ctx.app).get('/api/health')).status).toBe(200);
  });
});

it('does not classify an application SyntaxError as malformed JSON', async () => {
  const ctx = createApp(':memory:', false);
  vi.spyOn(ctx.simulatorService, 'simulateFlow').mockImplementation(() => { throw new SyntaxError('Internal parsing failed'); });
  try {
    const res = await request(ctx.app).post('/api/simulate').send({});
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  } finally {
    vi.restoreAllMocks();
    ctx.db.close();
  }
});
