import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app.js';
import { parseInputSpans } from '../src/services/span-input.js';

const id = (n: number) => n.toString(16).padStart(16, '0');
const span = (n: number, parent?: number) => ({
  id: id(n), traceId: 'a'.repeat(32), parentSpanId: parent ? id(parent) : undefined,
  serviceName: 'gateway', name: 'request', kind: 'SERVER', statusCode: 'OK',
  startTimeMs: 1000, endTimeMs: 1100, attributes: {},
});
const chain = (depth: number) => Array.from({ length: depth + 1 }, (_, i) => span(i + 1, i));

describe('Span graph validation', () => {
  let ctx: AppContext;
  beforeEach(() => { ctx = createApp(':memory:', false); });
  afterEach(() => { vi.restoreAllMocks(); ctx.db.close(); });

  const invalid = [
    ['self cycle', [span(1, 1)], 'cycle'],
    ['two-span cycle', [span(1, 2), span(2, 1)], 'cycle'],
    ['disconnected cycle', [span(1), span(2, 3), span(3, 2)], 'cycle'],
    ['tail into cycle', [span(1), span(4, 2), span(2, 3), span(3, 2)], 'cycle'],
    ['case-varied cycle', [span(1), { ...span(10, 11), parentSpanId: id(11).toUpperCase() }, span(11, 10)], 'cycle'],
    ['excessive depth', chain(129), '128'],
    ['reverse excessive depth', chain(129).reverse(), '128'],
    ['disconnected excessive depth', [span(1000), ...chain(129)], '128'],
  ] as const;

  it.each(invalid)('rejects %s before persistence', async (_name, spans, message) => {
    ctx.traceService.ingestSpans([span(1)]);
    const before = ctx.traceService.getTraceById('a'.repeat(32));
    const save = vi.spyOn(ctx.traceRepo, 'saveTraceWithSpans');
    const res = await request(ctx.app).post('/api/traces').send({ spans }).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toContain('parentSpanId');
    expect(res.body.error).toContain(message);
    expect(save).not.toHaveBeenCalled();
    expect(ctx.traceService.getTraceById('a'.repeat(32))).toEqual(before);
    expect(ctx.db.prepare('SELECT COUNT(*) AS count FROM spans').get()?.count).toBe(1);
  });

  it.each([false, true])('round-trips the maximum depth with reverse order %s', async reverse => {
    const spans = chain(128);
    if (reverse) spans.reverse();
    await request(ctx.app).post('/api/traces').send({ spans }).expect(201);
    const stored = ctx.traceService.getTraceById('a'.repeat(32))!;
    let node = stored.rootSpan;
    for (let depth = 0; depth <= 128; depth++) {
      expect(node.depth).toBe(depth);
      expect(node.id).toBe(id(depth + 1));
      if (depth < 128) node = node.children[0];
    }
    expect(node.children).toEqual([]);
    expect(stored.rawSpans).toHaveLength(129);
  });

  it('accepts missing parents, multiple roots and shared ancestors', () => {
    const spans = [span(3, 1), span(2, 1), span(1, 100), span(4)];
    expect(parseInputSpans(spans)).toHaveLength(4);
    expect(ctx.traceService.ingestSpans(spans).rootSpan.children).toHaveLength(2);
  });

  it('rejects very deep chains through internal callers without recursion', () => {
    expect(() => ctx.traceService.ingestSpans(chain(20000).reverse())).toThrow('128');
    expect(ctx.traceService.queryTraces()).toEqual([]);
  });
});
