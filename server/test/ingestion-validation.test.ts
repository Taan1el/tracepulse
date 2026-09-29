import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

const validSpan = () => ({
  id: '1111111111111111', traceId: 'a'.repeat(32), serviceName: 'gateway',
  name: 'GET /orders', kind: 'SERVER', statusCode: 'OK',
  startTimeMs: 1000, endTimeMs: 1100, attributes: {},
});

describe('Span ingestion validation', () => {
  let ctx: AppContext;
  beforeEach(() => { ctx = createApp(':memory:', false); });
  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  const invalidFields: Array<[string, unknown]> = [
    ...['serviceName', 'name'].flatMap(field => [undefined, null, '', '  ', 42, [], {}].map(value => [field, value] as [string, unknown])),
    ...['startTimeMs', 'endTimeMs'].flatMap(field => [undefined, null, '1000', true, -1, Number.MAX_VALUE].map(value => [field, value] as [string, unknown])),
    ...['id', 'traceId'].flatMap(field => [undefined, null, 1111111111111111, [], 'invalid', '0'.repeat(field === 'id' ? 16 : 32)].map(value => [field, value] as [string, unknown])),
    ...[false, '', 1111111111111111, [], '0'.repeat(16)].map(value => ['parentSpanId', value] as [string, unknown]),
    ...[undefined, null, 'server', 'INVALID', 1].map(value => ['kind', value] as [string, unknown]),
    ...[undefined, null, 'ok', 'INVALID', 1].map(value => ['statusCode', value] as [string, unknown]),
    ...[false, {}, []].map(value => ['statusMessage', value] as [string, unknown]),
    ...[null, [], 'text', { nested: {} }, { list: [] }, { value: null }].map(value => ['attributes', value] as [string, unknown]),
    ...[null, {}, 'text', [null], [{}], [{ name: '', timestampMs: 1000 }], [{ name: 'retry', timestampMs: '1000' }], [{ name: 'retry', timestampMs: -1 }], [{ name: 'retry', timestampMs: 1000, attributes: [] }]].map(value => ['events', value] as [string, unknown]),
  ];

  it.each(invalidFields)('rejects invalid %s value %j before saving any span', async (field, value) => {
    const save = vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans');
    const res = await request(ctx.app).post('/api/traces').send({ spans: [validSpan(), { ...validSpan(), id: '2222222222222222', [field]: value }] });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain(`spans[1].${field}`);
    expect(save).not.toHaveBeenCalled();
    expect(ctx.traceService.queryTraces()).toEqual([]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM spans').get()?.count).toBe(0);
  });

  it.each([null, [], 42, 'span'])('rejects a non-object span %j', async value => {
    const res = await request(ctx.app).post('/api/traces').send({ spans: [value] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('spans[0]');
  });

  it('rejects reversed timestamps without replacing an existing trace', async () => {
    await request(ctx.app).post('/api/traces').send({ spans: [validSpan()] }).expect(201);
    const before = ctx.traceService.getTraceById(validSpan().traceId);
    await request(ctx.app).post('/api/traces').send({ spans: [{ ...validSpan(), endTimeMs: 999 }] }).expect(400);
    expect(ctx.traceService.getTraceById(validSpan().traceId)).toEqual(before);
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite values from internal callers: %s', value => {
    const save = vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans');
    expect(() => ctx.traceService.ingestSpans([{ ...validSpan(), startTimeMs: value } as any])).toThrow('startTimeMs');
    expect(() => ctx.traceService.ingestSpans([{ ...validSpan(), attributes: { value } } as any])).toThrow('attributes');
    expect(() => ctx.traceService.ingestSpans([{ ...validSpan(), events: [{ name: 'retry', timestampMs: value }] } as any])).toThrow('timestampMs');
    expect(save).not.toHaveBeenCalled();
  });

  it('round-trips fractional and zero durations, scalar attributes, and optional fields', async () => {
    const root = { ...validSpan(), startTimeMs: 0, endTimeMs: 0.125, attributes: { text: 'ok', count: 2.5, flag: false }, statusMessage: null,
      events: [{ name: 'start', timestampMs: 0, attributes: { cached: true } }] };
    const child = { ...validSpan(), id: '2222222222222222', parentSpanId: root.id, startTimeMs: 0, endTimeMs: 0, attributes: undefined };
    const res = await request(ctx.app).post('/api/traces').send({ spans: [root, child] }).expect(201);
    expect(res.body.data.rawSpans.map((s: { durationMs: number }) => s.durationMs)).toEqual([0.13, 0]);
    const stored = ctx.traceService.getTraceById(root.traceId)!;
    expect(stored.rawSpans[0].attributes).toEqual(root.attributes);
    expect(stored.rawSpans[0].events).toEqual(root.events);
    expect(stored.rawSpans[1].attributes).toEqual({});
  });

  it.each(['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'])('accepts kind %s and each status', async kind => {
    for (const statusCode of ['OK', 'ERROR', 'UNSET']) {
      await request(ctx.app).post('/api/traces').send({ spans: [{ ...validSpan(), kind, statusCode }] }).expect(201);
    }
  });

  it('classifies unexpected persistence failures as server errors', async () => {
    vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans').mockImplementation(() => { throw new Error('private database path'); });
    const res = await request(ctx.app).post('/api/traces').send({ spans: [validSpan()] });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, error: 'Ingestion failed' });
  });
});
