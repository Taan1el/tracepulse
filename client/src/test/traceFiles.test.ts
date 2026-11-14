import { afterEach, describe, expect, it, vi } from 'vitest';
import jaegerFixture from './fixtures/jaeger-local.json';
import otlpFixture from './fixtures/otlp-local.json';
import { buildTraceForest, describeImport, exportTraceFile, importTraceFile, importTraceFileAsync, MAX_TRACE_FILE_BYTES, parseTraceFile, parseTraceFileAsync, TRACE_WORKER_THRESHOLD_BYTES } from '../local/traceFiles.js';
import { analyzeTrace } from '../local/traceAnalysis.js';
import type { SpanRecord, TraceDetail } from '../../../shared/types.js';

const jaegerText = JSON.stringify(jaegerFixture);
const otlpText = JSON.stringify(otlpFixture);
function mutableJaeger() { return structuredClone(jaegerFixture); }
function mutableOtlp() { return structuredClone(otlpFixture); }
function otlpEnvelope(spans: unknown[]) { return { resourceSpans: [{ scopeSpans: [{ spans }] }] }; }
function otlpSpan(index: number, parent?: number) {
  return { traceId: 'a'.repeat(32), spanId: index.toString(16).padStart(16, '0'), parentSpanId: parent?.toString(16).padStart(16, '0') ?? '', name: `span ${index}`, startTimeUnixNano: '1791054000000000000', endTimeUnixNano: '1791054000010000000' };
}
function simpleTrace(spans: Array<{ id: string; parent?: string; start: number; end: number }>): TraceDetail {
  const rawSpans: SpanRecord[] = spans.map(span => ({ id: span.id, traceId: 'b'.repeat(32), parentSpanId: span.parent ?? null, serviceName: 'service', name: span.id, kind: 'INTERNAL', statusCode: 'UNSET', attributes: {}, startTimeMs: span.start, endTimeMs: span.end, durationMs: span.end - span.start }));
  return { rawSpans, rootSpan: { ...rawSpans[0], children: [], depth: 0, offsetMs: 0, durationPercent: 100 }, summary: { id: 'b'.repeat(32), rootSpanName: 'root', rootServiceName: 'service', startTimeMs: 0, durationMs: 100, spanCount: spans.length, services: ['service'], hasError: false, createdAt: '2026-01-01T00:00:00.000Z' } };
}

describe('local trace files', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('imports multiple Jaeger traces, 64-bit trace IDs, processes, status, and logs', () => {
    const traces = parseTraceFile(jaegerText, 'jaeger.json');
    expect(traces).toHaveLength(2);
    expect(traces[0].summary).toMatchObject({ id: '00000000000000001111111111111111', spanCount: 4, durationMs: 100, services: ['web', 'db'], httpStatus: 200 });
    expect(traces[0].rootSpan.kind).toBe('SERVER');
    expect(traces[0].rawSpans[0].attributes.region).toBe('local');
    expect(traces[0].rawSpans[1]).toMatchObject({ durationMs: 60, attributes: { 'http.status_code': 200 }, events: [{ name: 'cache miss', attributes: { attempt: 1 } }] });
    expect(traces[1].rawSpans[0]).toMatchObject({ statusCode: 'ERROR', statusMessage: 'fixture failure' });
    expect(traces[1].summary.hasError).toBe(true);
  });

  it('keeps orphan components visible and does not invent a parent', () => {
    const [trace] = parseTraceFile(jaegerText, 'jaeger.json');
    const roots = buildTraceForest(trace);
    expect(roots.map(root => root.name)).toEqual(['checkout', 'orphan']);
    expect(roots[0].children.map(span => span.name)).toEqual(['query', 'overlap']);
    expect(roots[1].parentSpanId).toBe('0000000000000099');
    expect(roots[1].offsetMs).toBe(30);
  });

  it('imports OTLP resources and enums, preserving durations from large nanosecond strings', () => {
    const traces = parseTraceFile(otlpText, 'otel.json');
    expect(traces).toHaveLength(2);
    expect(traces[0].summary.durationMs).toBe(12.345678);
    expect(traces[0].rawSpans[0]).toMatchObject({ serviceName: 'gateway', durationMs: 12.345678, kind: 'SERVER', statusCode: 'OK', attributes: { size: '9223372036854775807', labels: '["a",true]' } });
    expect(traces[0].rawSpans[1]).toMatchObject({ durationMs: 0.000005, kind: 'CLIENT', statusCode: 'ERROR', statusMessage: 'precise failure' });
    expect(traces[1].rawSpans[0]).toMatchObject({ serviceName: 'unknown-service', parentSpanId: null, durationMs: 0 });
    expect(buildTraceForest(traces[1])[0].durationPercent).toBe(0);
  });

  it('preserves every normalized span through a Jaeger export roundtrip', () => {
    for (const text of [jaegerText, otlpText]) {
      const original = parseTraceFile(text, 'source.json');
      const reimported = parseTraceFile(exportTraceFile(original), 'roundtrip.json');
      expect(reimported.map(trace => trace.rawSpans)).toEqual(original.map(trace => trace.rawSpans));
      expect(reimported.map(trace => ({ ...trace.summary, createdAt: '' }))).toEqual(original.map(trace => ({ ...trace.summary, createdAt: '' })));
    }
  });

  it('retains attributes that collide with Jaeger status, kind, and log tag names', () => {
    const traces = parseTraceFile(otlpText, 'source.json');
    const span = traces[0].rawSpans[0];
    span.attributes = { error: 'custom value', 'span.kind': 'custom kind', 'otel.status_code': 'custom status', event: 'span event' };
    span.events = [{ name: 'log name', timestampMs: span.startTimeMs, attributes: { event: 'original event', ok: false } }];
    span.statusMessage = null;
    expect(parseTraceFile(exportTraceFile(traces), 'roundtrip.json')[0].rawSpans).toEqual(traces[0].rawSpans);
  });

  it('reports the filename and precise unsupported or invalid field path', () => {
    expect(() => parseTraceFile('{', 'broken.json')).toThrow('broken.json: $: invalid JSON');
    expect(() => parseTraceFile('{}', 'other.json')).toThrow('other.json: $: unsupported format');
    const file = mutableOtlp();
    file.resourceSpans[0].scopeSpans[0].spans[0].traceId = '0'.repeat(32);
    expect(() => parseTraceFile(JSON.stringify(file), 'bad-id.json')).toThrow(/bad-id.json: resourceSpans\[0\].scopeSpans\[0\].spans\[0\].traceId/);
  });

  it('rejects missing process references and malformed timestamps', () => {
    const file = mutableJaeger();
    file.data[0].spans[0].processID = 'missing';
    expect(() => parseTraceFile(JSON.stringify(file), 'process.json')).toThrow(/process.json: data\[0\].spans\[0\].processID.*missing/);
    const otlp = mutableOtlp();
    otlp.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano = '1791054000123000000';
    expect(() => parseTraceFile(JSON.stringify(otlp), 'end.json')).toThrow(/end.json: .*spans\[0\].endTimeUnixNano.*greater than or equal/);
    const negative = { ...otlpSpan(1), startTimeUnixNano: -5 };
    expect(() => parseTraceFile(JSON.stringify(otlpEnvelope([negative])), 'negative.json')).toThrow(/startTimeUnixNano.*non-negative/);
    const text = { ...otlpSpan(1), startTimeUnixNano: 'soon' };
    expect(() => parseTraceFile(JSON.stringify(otlpEnvelope([text])), 'text.json')).toThrow(/startTimeUnixNano.*number or numeric string/);
  });

  it('skips repeated span IDs within a trace, keeps the first, and allows the same ID in distinct traces', () => {
    expect(parseTraceFile(jaegerText, 'multi.json')).toHaveLength(2);
    const first = otlpSpan(1);
    const repeat = { ...otlpSpan(1), name: 'repeat' };
    const result = importTraceFile(JSON.stringify(otlpEnvelope([first, repeat, otlpSpan(2)])), 'duplicate.json');
    expect(result.traces[0].rawSpans.map(span => span.name)).toEqual(['span 1', 'span 2']);
    expect(result.report).toMatchObject({ importedSpans: 2, skippedSpans: 1, skipped: [{ reason: expect.stringContaining('duplicate span ID'), count: 1, example: 'resourceSpans[0].scopeSpans[0].spans[1]' }] });
    expect(describeImport(result.report).headline).toBe('Imported 2 spans, skipped 1: duplicate span ID in the same trace (1).');
  });

  it('rejects cycles, and skips spans deeper than 128 parents with their source path', () => {
    expect(() => parseTraceFile(JSON.stringify(otlpEnvelope([otlpSpan(1, 2), otlpSpan(2, 1)])), 'cycle.json')).toThrow(/cycle.json: .*parentSpanId.*cycle/);
    const spans = Array.from({ length: 130 }, (_, index) => otlpSpan(index + 1, index === 0 ? undefined : index));
    const result = importTraceFile(JSON.stringify(otlpEnvelope(spans)), 'depth.json');
    expect(result.traces[0].rawSpans).toHaveLength(129);
    expect(result.report.skipped).toEqual([expect.objectContaining({ count: 1, example: 'resourceSpans[0].scopeSpans[0].spans[129]' })]);
    expect(result.report.skipped[0].reason).toContain('128 parent levels');
  });

  it('reads line-delimited OTLP JSON from the collector file exporter and merges every line', () => {
    const lines = [otlpSpan(1), otlpSpan(2, 1)].map(span => JSON.stringify(otlpEnvelope([span])));
    const text = `${lines[0]}\n\n${lines[1]}\r\n`;
    const result = importTraceFile(text, 'export.jsonl');
    expect(result.traces).toHaveLength(1);
    expect(result.traces[0].rawSpans.map(span => span.name)).toEqual(['span 1', 'span 2']);
    expect(result.traces[0].rootSpan.children.map(child => child.name)).toEqual(['span 2']);
    const several = parseTraceFile(`${JSON.stringify(otlpFixture)}\n${JSON.stringify(otlpFixture)}`, 'twice.jsonl');
    expect(several.length).toBeGreaterThan(0);
  });

  it('names the failing line of a line-delimited file', () => {
    const good = JSON.stringify(otlpEnvelope([otlpSpan(1)]));
    expect(() => parseTraceFile(`${good}\n${good}\n{"resourceSpans": [\n${good}`, 'bad.jsonl')).toThrow('bad.jsonl: line 3: invalid JSON');
    expect(() => parseTraceFile(`${good}\n{"other":1}`, 'other.jsonl')).toThrow('other.jsonl: line 2: expected an OTLP object with resourceSpans');
    const broken = JSON.stringify(otlpEnvelope([{ ...otlpSpan(2), spanId: 'zz' }]));
    expect(() => parseTraceFile(`${good}\n${broken}`, 'span.jsonl')).toThrow(/span.jsonl: line 2: resourceSpans\[0\].scopeSpans\[0\].spans\[0\].spanId/);
    expect(() => parseTraceFile('{\n  "resourceSpans": [', 'pretty.json')).toThrow('pretty.json: $: invalid JSON');
  });

  it('imports Tempo batches, including the older instrumentationLibrarySpans name', () => {
    const batch = { batches: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'tempo-service' } }] }, scopeSpans: [{ spans: [otlpSpan(1)] }] }] };
    expect(parseTraceFile(JSON.stringify(batch), 'tempo.json')[0].rawSpans[0]).toMatchObject({ serviceName: 'tempo-service', name: 'span 1' });
    const legacy = { batches: [{ instrumentationLibrarySpans: [{ spans: [otlpSpan(2)] }] }] };
    expect(parseTraceFile(JSON.stringify(legacy), 'old-tempo.json')[0].rawSpans[0].name).toBe('span 2');
  });

  it('accepts an empty OTLP value, an empty event name and numeric nanosecond timestamps, and reports each', () => {
    const file = mutableOtlp();
    const span = file.resourceSpans[0].scopeSpans[0].spans[0] as Record<string, unknown>;
    span.attributes = [{ key: 'blank', value: {} }];
    span.events = [{ name: '', timeUnixNano: '1791054000000000100' }];
    const numeric = { ...otlpSpan(7), startTimeUnixNano: 1791054000000000000, endTimeUnixNano: '1791054000010000000.0' };
    file.resourceSpans[0].scopeSpans[0].spans.push(numeric as never);
    const result = importTraceFile(JSON.stringify(file), 'odd.json');
    const parsed = result.traces.flatMap(trace => trace.rawSpans);
    expect(parsed.find(item => item.id === span.spanId)).toMatchObject({ attributes: { blank: '' }, events: [{ name: 'unnamed event' }] });
    expect(parsed.find(item => item.id === numeric.spanId)).toBeDefined();
    expect(result.report.skippedSpans).toBe(0);
    const reasons = result.report.adjusted.map(item => item.reason);
    for (const expected of [/empty attribute value/, /empty event name/, /beyond 2\^53/]) expect(reasons.some(reason => expected.test(reason))).toBe(true);
    expect(describeImport(result.report).details).toHaveLength(3);
  });

  it('uses the first CHILD_OF reference of a Jaeger span and reports the rest', () => {
    const file = mutableJaeger();
    const trace = file.data[0];
    const child = trace.spans[1];
    child.references.push({ refType: 'CHILD_OF', traceID: trace.traceID, spanID: '0000000000000003' });
    const result = importTraceFile(JSON.stringify(file), 'two-parents.json');
    expect(result.traces[0].rawSpans.find(span => span.id === child.spanID.padStart(16, '0'))?.parentSpanId).toBe('0000000000000001');
    expect(result.report.adjusted).toEqual([expect.objectContaining({ count: 1, example: 'data[0].spans[1].references' })]);
  });

  it('takes the HTTP status from the root span, not the last span', () => {
    const root = { ...otlpSpan(1), attributes: [{ key: 'http.status_code', value: { intValue: '200' } }] };
    const downstream = { ...otlpSpan(2, 1), attributes: [{ key: 'http.status_code', value: { intValue: '503' } }], startTimeUnixNano: '1791054000002000000' };
    expect(parseTraceFile(JSON.stringify(otlpEnvelope([root, downstream])), 'status.json')[0].summary.httpStatus).toBe(200);
  });

  it('supports a single Jaeger trace envelope and a UTF-8 BOM', () => {
    expect(parseTraceFile(`\uFEFF${JSON.stringify(jaegerFixture.data[0])}`, 'single.json')).toHaveLength(1);
  });

  it('reads small local files without network access', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const traces = await parseTraceFileAsync(new File([otlpText], 'local.json', { type: 'application/json' }));
    expect(traces).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects oversized files before starting work', async () => {
    await expect(parseTraceFileAsync({ size: MAX_TRACE_FILE_BYTES + 1, name: 'huge.json' } as File)).rejects.toThrow('huge.json: maximum file size is 32 MiB');
  });

  it('measures text limits in UTF-8 bytes, including multibyte characters', () => {
    const text = JSON.stringify({ padding: 'é'.repeat(MAX_TRACE_FILE_BYTES / 2 + 1) });
    expect(text.length).toBeLessThan(MAX_TRACE_FILE_BYTES);
    expect(() => parseTraceFile(text, 'unicode.json')).toThrow('unicode.json: $: maximum file size is 32 MiB');
  });

  it('delegates large files to a same-origin module worker and terminates it', async () => {
    const expected = parseTraceFile(otlpText, 'large.json');
    const terminate = vi.fn();
    const postMessage = vi.fn();
    const construct = vi.fn();
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate = terminate;
      constructor(url: URL, options: WorkerOptions) { construct(url, options); }
      postMessage(file: File) { postMessage(file); queueMicrotask(() => this.onmessage?.({ data: { traces: expected } } as MessageEvent)); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const file = new File([otlpText.padEnd(TRACE_WORKER_THRESHOLD_BYTES, ' ')], 'large.json');
    await expect(parseTraceFileAsync(file)).resolves.toEqual(expected);
    expect(construct.mock.calls[0][0].pathname).toContain('trace.worker.ts');
    expect(construct.mock.calls[0][1]).toEqual({ type: 'module' });
    expect(postMessage).toHaveBeenCalledWith(file);
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('returns worker parse errors and terminates the worker', async () => {
    const terminate = vi.fn();
    class FakeWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      terminate = terminate;
      postMessage() { queueMicrotask(() => this.onmessage?.({ data: { error: 'large.json: $.spans: invalid spans' } } as MessageEvent)); }
    }
    vi.stubGlobal('Worker', FakeWorker);
    await expect(parseTraceFileAsync(new File([' '.repeat(TRACE_WORKER_THRESHOLD_BYTES)], 'large.json'))).rejects.toThrow('large.json: $.spans: invalid spans');
    expect(terminate).toHaveBeenCalledOnce();
  });

  it('can import a wide trace without spreading all timestamps into a function call', () => {
    const spans = Array.from({ length: 12_000 }, (_, index) => otlpSpan(index + 1));
    const [trace] = parseTraceFile(JSON.stringify(otlpEnvelope(spans)), 'wide.json');
    expect(trace.rawSpans).toHaveLength(12_000);
    expect(buildTraceForest(trace)).toHaveLength(12_000);
  });
});

describe('structural trace timing analysis', () => {
  it('ranks every span and chooses the heaviest branch without nested duration double counting', () => {
    const [trace] = parseTraceFile(jaegerText, 'trace.json');
    const result = analyzeTrace(trace);
    expect(result.slowest.map(span => span.durationMs)).toEqual([100, 60, 30, 20]);
    expect(result.criticalPath.map(span => span.name)).toEqual(['checkout', 'query']);
    expect(result.criticalDurationMs).toBe(100);
  });

  it('merges overlapping children before deriving exclusive parent duration', () => {
    const trace = simpleTrace([{ id: 'root', start: 0, end: 100 }, { id: 'a', parent: 'root', start: 10, end: 70 }, { id: 'b', parent: 'root', start: 20, end: 50 }, { id: 'leaf', parent: 'a', start: 25, end: 60 }]);
    expect(analyzeTrace(trace).criticalPath.map(span => span.id)).toEqual(['root', 'a', 'leaf']);
    expect(analyzeTrace(trace).criticalDurationMs).toBe(100);
  });

  it('documents the estimate by omitting sequential sibling branches', () => {
    const trace = simpleTrace([{ id: 'root', start: 0, end: 100 }, { id: 'a', parent: 'root', start: 10, end: 40 }, { id: 'b', parent: 'root', start: 60, end: 90 }]);
    expect(analyzeTrace(trace).criticalDurationMs).toBe(70);
    expect(analyzeTrace(trace).criticalPath.map(span => span.id)).toEqual(['root', 'a']);
  });

  it('considers orphan roots and retains nanosecond duration precision', () => {
    const [trace] = parseTraceFile(otlpText, 'trace.json');
    expect(analyzeTrace(trace).criticalDurationMs).toBe(12.345678);
    const orphan = simpleTrace([{ id: 'root', start: 0, end: 5 }, { id: 'orphan', parent: 'missing', start: 10, end: 100 }]);
    expect(analyzeTrace(orphan).criticalPath.map(span => span.id)).toEqual(['orphan']);
    expect(analyzeTrace(orphan).criticalDurationMs).toBe(90);
  });

  it('does not recurse indefinitely on an unexpected cyclic object', () => {
    const trace = simpleTrace([{ id: 'a', parent: 'b', start: 0, end: 100 }, { id: 'b', parent: 'a', start: 0, end: 50 }]);
    expect(analyzeTrace(trace).criticalPath).toEqual([]);
  });
});
