import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';

const root = () => ({
  id: 'abcdef1234567890', traceId: 'a'.repeat(32), serviceName: 'gateway',
  name: 'GET /orders', kind: 'SERVER', statusCode: 'OK',
  startTimeMs: 1000, endTimeMs: 1100, attributes: {},
});
const child = () => ({ ...root(), id: 'bbbbbbbbbbbbbbbb', parentSpanId: root().id });

describe('Span batch identity', () => {
  let ctx: AppContext;
  beforeEach(() => { ctx = createApp(':memory:', false); });
  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  const invalidBatches = [
    ['mixed trace IDs', [root(), { ...child(), traceId: 'b'.repeat(32) }], 'spans[1].traceId'],
    ['identical duplicate', [root(), root()], 'spans[1].id'],
    ['conflicting duplicate', [root(), { ...root(), name: 'replacement' }], 'spans[1].id'],
    ['case variant duplicate', [root(), { ...root(), id: root().id.toUpperCase() }], 'spans[1].id'],
    ['non-adjacent duplicate', [root(), child(), root()], 'spans[2].id'],
  ] as const;

  it.each(invalidBatches)('rejects %s without saving', async (_name, spans, field) => {
    const save = vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans');
    const res = await request(ctx.app).post('/api/traces').send({ spans }).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain(field);
    expect(save).not.toHaveBeenCalled();
    expect(ctx.traceService.queryTraces()).toEqual([]);
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM spans').get()?.count).toBe(0);
  });

  it.each(invalidBatches)('preserves existing data after %s', async (_name, spans) => {
    ctx.traceService.ingestSpans([root(), child()]);
    const before = ctx.traceService.getTraceById(root().traceId);
    await request(ctx.app).post('/api/traces').send({ spans }).expect(400);
    expect(ctx.traceService.getTraceById(root().traceId)).toEqual(before);
    expect(ctx.traceService.queryTraces()).toHaveLength(1);
  });

  it('canonicalizes hexadecimal IDs and links a child submitted before its parent', async () => {
    const spans = [
      { ...child(), traceId: root().traceId.toUpperCase(), parentSpanId: root().id.toUpperCase() },
      { ...root(), id: root().id.toUpperCase() },
    ];
    const res = await request(ctx.app).post('/api/traces').send({ spans }).expect(201);
    expect(res.body.data.summary.id).toBe(root().traceId);
    expect(res.body.data.summary.spanCount).toBe(2);
    expect(res.body.data.rootSpan.id).toBe(root().id);
    expect(res.body.data.rootSpan.children[0].id).toBe(child().id);
    const stored = ctx.traceService.getTraceById(root().traceId)!;
    expect(stored.rawSpans).toHaveLength(2);
    expect(stored.rootSpan.children[0].parentSpanId).toBe(root().id);
    expect(spans[1].id).toBe(root().id.toUpperCase());
  });

  it('also rejects invalid batches from internal callers', () => {
    const save = vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans');
    for (const [, spans, field] of invalidBatches) {
      expect(() => ctx.traceService.ingestSpans(spans)).toThrow(field);
    }
    expect(save).not.toHaveBeenCalled();
  });
});
