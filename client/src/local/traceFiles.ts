import type { SpanEvent, SpanKind, SpanNode, SpanRecord, SpanStatusCode, TraceDetail } from '../../../shared/types.js';
import { parseInputSpans, SpanInputError } from '../../../shared/span-input.js';

export const MAX_TRACE_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_TRACE_FILE_SPANS = 100_000;
export const TRACE_WORKER_THRESHOLD_BYTES = 1024 * 1024;
const MAX_TIME_NS = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n;

/** Retained through local storage and worker cloning so absolute epoch rounding cannot erase durations. */
export interface TraceFileSpan extends SpanRecord {
  sourceTiming?: { startTimeUnixNano: string; endTimeUnixNano: string };
}

type Attributes = SpanRecord['attributes'];
type InputSpan = Omit<TraceFileSpan, 'durationMs'>;
interface LocatedSpan { span: InputSpan; path: string; fields: Record<string, string> }

function fail(path: string, message: string): never { throw new Error(`${path}: ${message}`); }
function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, 'expected an object');
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  return value;
}
function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'expected a non-empty string');
  return value;
}
function hex(value: unknown, width: number, path: string, jaeger = false): string {
  if (typeof value !== 'string' || !(jaeger ? new RegExp(`^[a-f\\d]{1,${width}}$`, 'i') : new RegExp(`^[a-f\\d]{${width}}$`, 'i')).test(value) || /^0+$/.test(value)) {
    fail(path, `expected a non-zero ${jaeger ? `up to ${width}` : width}-hex identifier`);
  }
  return value.toLowerCase().padStart(width, '0');
}
function nanos(value: unknown, path: string): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail(path, 'expected an unsigned integer string; large numeric timestamps lose precision');
    value = String(value);
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) fail(path, 'expected an unsigned integer nanosecond string');
  const result = BigInt(value);
  if (result > MAX_TIME_NS) fail(path, 'timestamp exceeds the supported millisecond range');
  return result;
}
function micros(value: unknown, path: string): bigint {
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER)) {
    fail(path, 'expected non-negative microseconds; use a string for large values');
  }
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+(?:\.\d{1,3})?$/.test(text)) fail(path, 'expected non-negative microseconds with at most nanosecond precision');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result > MAX_TIME_NS) fail(path, 'timestamp exceeds the supported millisecond range');
  return result;
}
function milliseconds(value: bigint): number {
  // Convert the quotient and remainder separately, avoiding a lossy Number(epochNanoseconds).
  return Number(value / 1_000_000n) + Number(value % 1_000_000n) / 1_000_000;
}
function primitive(value: unknown, path: string): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  return fail(path, 'expected a string, finite number, or boolean');
}
function jaegerTags(value: unknown, path: string): Attributes {
  if (value === undefined) return {};
  const entries = array(value, path).map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const tag = object(item, itemPath);
    return [name(tag.key, `${itemPath}.key`), primitive(tag.value, `${itemPath}.value`)] as const;
  });
  return Object.fromEntries(entries);
}
function flatAttributes(value: unknown, path: string): Attributes {
  return Object.fromEntries(Object.entries(object(value, path)).map(([key, value]) => [key, primitive(value, `${path}.${key}`)]));
}
function otlpValue(value: unknown, path: string, depth = 0): string | number | boolean {
  if (depth > 32) fail(path, 'attribute nesting exceeds 32 levels');
  const item = object(value, path);
  const variants = ['stringValue', 'boolValue', 'intValue', 'doubleValue', 'bytesValue', 'arrayValue', 'kvlistValue'].filter(key => item[key] !== undefined);
  if (variants.length !== 1) fail(path, 'expected one OTLP value field');
  const key = variants[0];
  if (key === 'stringValue' || key === 'bytesValue') {
    if (typeof item[key] !== 'string') fail(`${path}.${key}`, 'expected a string');
    return item[key] as string;
  }
  if (key === 'boolValue') {
    if (typeof item[key] !== 'boolean') fail(`${path}.${key}`, 'expected a boolean');
    return item[key] as boolean;
  }
  if (key === 'doubleValue') {
    if (typeof item[key] !== 'number' || !Number.isFinite(item[key])) fail(`${path}.${key}`, 'expected a finite number');
    return item[key] as number;
  }
  if (key === 'intValue') {
    const raw = item[key];
    if ((typeof raw !== 'string' || !/^-?\d+$/.test(raw)) && (typeof raw !== 'number' || !Number.isSafeInteger(raw))) fail(`${path}.${key}`, 'expected an integer string or safe integer');
    const integer = BigInt(raw as string | number);
    return integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER) ? String(integer) : Number(integer);
  }
  const nested = object(item[key], `${path}.${key}`);
  if (key === 'arrayValue') {
    return JSON.stringify(array(nested.values ?? [], `${path}.${key}.values`).map((entry, index) => otlpValue(entry, `${path}.${key}.values[${index}]`, depth + 1)));
  }
  return JSON.stringify(otlpAttributes(nested.values ?? [], `${path}.${key}.values`, depth + 1));
}
function otlpAttributes(value: unknown, path: string, depth = 0): Attributes {
  if (value === undefined) return {};
  return Object.fromEntries(array(value, path).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const attribute = object(entry, entryPath);
    return [name(attribute.key, `${entryPath}.key`), otlpValue(attribute.value, `${entryPath}.value`, depth)] as const;
  }));
}
function kind(value: unknown, path: string): SpanKind {
  if (value === undefined || value === 0 || value === 'SPAN_KIND_UNSPECIFIED') return 'INTERNAL';
  const kinds: SpanKind[] = ['INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) return kinds[value - 1];
  if (typeof value === 'string') {
    const normalized = value.replace(/^SPAN_KIND_/, '').toUpperCase();
    if (kinds.includes(normalized as SpanKind)) return normalized as SpanKind;
  }
  return fail(path, 'unsupported span kind');
}
function status(value: unknown, path: string): SpanStatusCode {
  if (value === undefined || value === 0 || value === 'STATUS_CODE_UNSET' || value === 'UNSET') return 'UNSET';
  if (value === 1 || value === 'STATUS_CODE_OK' || value === 'OK') return 'OK';
  if (value === 2 || value === 'STATUS_CODE_ERROR' || value === 'ERROR') return 'ERROR';
  return fail(path, 'unsupported span status code');
}
function timing(start: bigint, end: bigint, endPath: string): Pick<InputSpan, 'startTimeMs' | 'endTimeMs' | 'sourceTiming'> {
  if (end < start) fail(endPath, 'must be greater than or equal to the start timestamp');
  if (end > MAX_TIME_NS) fail(endPath, 'timestamp exceeds the supported millisecond range');
  return { startTimeMs: milliseconds(start), endTimeMs: milliseconds(end), sourceTiming: { startTimeUnixNano: String(start), endTimeUnixNano: String(end) } };
}
function readJaeger(input: Record<string, unknown>): LocatedSpan[] {
  const traces = input.data === undefined ? [input] : array(input.data, 'data');
  const result: LocatedSpan[] = [];
  traces.forEach((item, traceIndex) => {
    const tracePath = input.data === undefined ? '$' : `data[${traceIndex}]`;
    const trace = object(item, tracePath);
    const traceId = hex(trace.traceID, 32, `${tracePath}.traceID`, true);
    const processes = trace.processes === undefined ? {} : object(trace.processes, `${tracePath}.processes`);
    array(trace.spans, `${tracePath}.spans`).forEach((entry, spanIndex) => {
      if (result.length >= MAX_TRACE_FILE_SPANS) fail(`${tracePath}.spans`, `maximum ${MAX_TRACE_FILE_SPANS.toLocaleString('en-US')} spans per file`);
      const path = `${tracePath}.spans[${spanIndex}]`;
      const span = object(entry, path);
      const ownTraceId = span.traceID === undefined ? traceId : hex(span.traceID, 32, `${path}.traceID`, true);
      if (ownTraceId !== traceId) fail(`${path}.traceID`, 'must match the enclosing traceID');
      const processId = name(span.processID, `${path}.processID`);
      if (!Object.hasOwn(processes, processId)) fail(`${path}.processID`, `process ${JSON.stringify(processId)} is missing from ${tracePath}.processes`);
      const process = object(processes[processId], `${tracePath}.processes.${processId}`);
      let attributes = { ...jaegerTags(process.tags, `${tracePath}.processes.${processId}.tags`), ...jaegerTags(span.tags, `${path}.tags`) };
      let parentSpanId: string | null = null;
      let parentPath = `${path}.references`;
      if (span.references !== undefined) array(span.references, `${path}.references`).forEach((reference, referenceIndex) => {
        const refPath = `${path}.references[${referenceIndex}]`;
        const ref = object(reference, refPath);
        if (ref.refType !== 'CHILD_OF' && ref.refType !== 'FOLLOWS_FROM') fail(`${refPath}.refType`, 'expected CHILD_OF or FOLLOWS_FROM');
        const refTraceId = ref.traceID === undefined ? traceId : hex(ref.traceID, 32, `${refPath}.traceID`, true);
        const refSpanId = hex(ref.spanID, 16, `${refPath}.spanID`, true);
        if (ref.refType === 'CHILD_OF' && refTraceId === traceId) {
          if (parentSpanId !== null) fail(`${path}.references`, 'a span cannot have multiple local CHILD_OF parents');
          parentSpanId = refSpanId;
          parentPath = `${refPath}.spanID`;
        }
      });
      const start = micros(span.startTime, `${path}.startTime`);
      const duration = micros(span.duration, `${path}.duration`);
      let preciseStart = start;
      let preciseEnd = start + duration;
      // Optional extension on local exports preserves OTLP nanoseconds through Jaeger microsecond fields.
      if (span.startTimeUnixNano !== undefined || span.endTimeUnixNano !== undefined) {
        preciseStart = nanos(span.startTimeUnixNano, `${path}.startTimeUnixNano`);
        preciseEnd = nanos(span.endTimeUnixNano, `${path}.endTimeUnixNano`);
      }
      let statusCode = attributes.error === true || attributes.error === 'true' ? 'ERROR' : status(attributes['otel.status_code'], `${path}.tags.otel.status_code`);
      if (attributes['otel.status_code'] === 'ERROR') statusCode = 'ERROR';
      let statusMessage: string | null | undefined = typeof attributes['otel.status_description'] === 'string' ? attributes['otel.status_description'] : undefined;
      let spanKind = kind(attributes['span.kind'], `${path}.tags.span.kind`);
      let events: SpanEvent[] = span.logs === undefined ? [] : array(span.logs, `${path}.logs`).map((entry, eventIndex) => {
        const eventPath = `${path}.logs[${eventIndex}]`;
        const log = object(entry, eventPath);
        const eventAttributes = jaegerTags(log.fields, `${eventPath}.fields`);
        const eventName = typeof eventAttributes.event === 'string' && eventAttributes.event.trim() ? eventAttributes.event : 'log';
        return { name: eventName, timestampMs: milliseconds(micros(log.timestamp, `${eventPath}.timestamp`)), attributes: eventAttributes };
      });
      if (span.tracepulse !== undefined) {
        const metadataPath = `${path}.tracepulse`;
        const metadata = object(span.tracepulse, metadataPath);
        if (metadata.version !== 1) fail(`${metadataPath}.version`, 'unsupported local metadata version');
        attributes = flatAttributes(metadata.attributes, `${metadataPath}.attributes`);
        statusCode = status(metadata.statusCode, `${metadataPath}.statusCode`);
        spanKind = kind(metadata.kind, `${metadataPath}.kind`);
        if (metadata.statusMessage !== undefined && metadata.statusMessage !== null && typeof metadata.statusMessage !== 'string') fail(`${metadataPath}.statusMessage`, 'expected a string or null');
        statusMessage = metadata.statusMessage as string | null | undefined;
        events = array(metadata.events ?? [], `${metadataPath}.events`).map((entry, eventIndex) => {
          const eventPath = `${metadataPath}.events[${eventIndex}]`;
          const event = object(entry, eventPath);
          if (typeof event.timestampMs !== 'number' || !Number.isFinite(event.timestampMs) || event.timestampMs < 0 || event.timestampMs > Number.MAX_SAFE_INTEGER) fail(`${eventPath}.timestampMs`, 'expected a non-negative safe millisecond timestamp');
          return { name: name(event.name, `${eventPath}.name`), timestampMs: event.timestampMs, ...(event.attributes !== undefined ? { attributes: flatAttributes(event.attributes, `${eventPath}.attributes`) } : {}) };
        });
      }
      result.push({ path, fields: { id: `${path}.spanID`, traceId: `${path}.traceID`, parentSpanId: parentPath, serviceName: `${tracePath}.processes.${processId}.serviceName`, name: `${path}.operationName`, startTimeMs: `${path}.startTime`, endTimeMs: `${path}.duration` }, span: {
        id: hex(span.spanID, 16, `${path}.spanID`, true), traceId, parentSpanId,
        serviceName: name(process.serviceName, `${tracePath}.processes.${processId}.serviceName`), name: name(span.operationName, `${path}.operationName`),
        kind: spanKind, statusCode,
        ...(statusMessage !== undefined ? { statusMessage } : {}), attributes, events,
        ...timing(preciseStart, preciseEnd, `${path}.duration`),
      } });
    });
  });
  return result;
}
function readOtlp(input: Record<string, unknown>): LocatedSpan[] {
  const result: LocatedSpan[] = [];
  array(input.resourceSpans, 'resourceSpans').forEach((entry, resourceIndex) => {
    const resourcePath = `resourceSpans[${resourceIndex}]`;
    const resourceSpan = object(entry, resourcePath);
    const resource = resourceSpan.resource === undefined ? {} : object(resourceSpan.resource, `${resourcePath}.resource`);
    const resourceAttributes = otlpAttributes(resource.attributes, `${resourcePath}.resource.attributes`);
    const serviceName = typeof resourceAttributes['service.name'] === 'string' && resourceAttributes['service.name'].trim() ? resourceAttributes['service.name'] : 'unknown-service';
    array(resourceSpan.scopeSpans, `${resourcePath}.scopeSpans`).forEach((entry, scopeIndex) => {
      const scopePath = `${resourcePath}.scopeSpans[${scopeIndex}]`;
      const scope = object(entry, scopePath);
      array(scope.spans, `${scopePath}.spans`).forEach((entry, spanIndex) => {
        if (result.length >= MAX_TRACE_FILE_SPANS) fail(`${scopePath}.spans`, `maximum ${MAX_TRACE_FILE_SPANS.toLocaleString('en-US')} spans per file`);
        const path = `${scopePath}.spans[${spanIndex}]`;
        const span = object(entry, path);
        const start = nanos(span.startTimeUnixNano, `${path}.startTimeUnixNano`);
        const end = nanos(span.endTimeUnixNano, `${path}.endTimeUnixNano`);
        const spanStatus = span.status === undefined ? {} : object(span.status, `${path}.status`);
        if (spanStatus.message !== undefined && typeof spanStatus.message !== 'string') fail(`${path}.status.message`, 'expected a string');
        const events: SpanEvent[] = span.events === undefined ? [] : array(span.events, `${path}.events`).map((entry, eventIndex) => {
          const eventPath = `${path}.events[${eventIndex}]`;
          const event = object(entry, eventPath);
          return { name: name(event.name, `${eventPath}.name`), timestampMs: milliseconds(nanos(event.timeUnixNano, `${eventPath}.timeUnixNano`)), attributes: otlpAttributes(event.attributes, `${eventPath}.attributes`) };
        });
        const parentSpanId = span.parentSpanId === undefined || span.parentSpanId === '' || span.parentSpanId === '0'.repeat(16) ? null : hex(span.parentSpanId, 16, `${path}.parentSpanId`);
        result.push({ path, fields: { id: `${path}.spanId`, traceId: `${path}.traceId`, startTimeMs: `${path}.startTimeUnixNano`, endTimeMs: `${path}.endTimeUnixNano` }, span: {
          id: hex(span.spanId, 16, `${path}.spanId`), traceId: hex(span.traceId, 32, `${path}.traceId`), parentSpanId,
          serviceName, name: name(span.name, `${path}.name`), kind: kind(span.kind, `${path}.kind`), statusCode: status(spanStatus.code, `${path}.status.code`),
          ...(spanStatus.message !== undefined ? { statusMessage: spanStatus.message as string } : {}),
          attributes: { ...resourceAttributes, ...otlpAttributes(span.attributes, `${path}.attributes`) }, events,
          ...timing(start, end, `${path}.endTimeUnixNano`),
        } });
      });
    });
  });
  return result;
}
function spanTimes(span: SpanRecord): [bigint, bigint] {
  const precise = (span as TraceFileSpan).sourceTiming;
  if (precise) return [BigInt(precise.startTimeUnixNano), BigInt(precise.endTimeUnixNano)];
  const convert = (value: number) => BigInt(Math.trunc(value)) * 1_000_000n + BigInt(Math.round((value % 1) * 1_000_000));
  return [convert(span.startTimeMs), convert(span.endTimeMs)];
}
function traceBounds(spans: SpanRecord[]): [bigint, bigint] {
  let [start, end] = spanTimes(spans[0]);
  for (const span of spans) {
    const [spanStart, spanEnd] = spanTimes(span);
    if (spanStart < start) start = spanStart;
    if (spanEnd > end) end = spanEnd;
  }
  return [start, end];
}
function makeForest(spans: SpanRecord[]): SpanNode[] {
  if (!spans.length) return [];
  const [start, end] = traceBounds(spans);
  const duration = milliseconds(end - start);
  const candidates = spans.filter(span => span.parentSpanId);
  let bottleneck = (candidates.length ? candidates : spans)[0];
  for (const span of candidates.length ? candidates : spans) if (span.durationMs > bottleneck.durationMs) bottleneck = span;
  const nodes = new Map(spans.map(span => [span.id, {
    ...span, children: [] as SpanNode[], depth: 0,
    offsetMs: milliseconds(spanTimes(span)[0] - start),
    durationPercent: duration === 0 ? 0 : Math.min(100, Math.max(0, span.durationMs / duration * 100)),
    isBottleneck: span.id === bottleneck.id,
  }]));
  const roots: SpanNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentSpanId ? nodes.get(node.parentSpanId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (a: SpanNode, b: SpanNode) => a.offsetMs - b.offsetMs || a.id.localeCompare(b.id);
  roots.sort(sort);
  const queue = [...roots];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (visited.has(node.id)) continue;
    visited.add(node.id);
    node.children.sort(sort);
    for (const child of node.children) if (!visited.has(child.id)) { child.depth = node.depth + 1; queue.push(child); }
  }
  return roots;
}

/** Every component is included. Missing parents produce separate roots instead of hidden spans. */
export function buildTraceForest(trace: TraceDetail): SpanNode[] { return makeForest(trace.rawSpans); }

function buildTrace(located: LocatedSpan[]): TraceDetail {
  let validated: Array<Omit<SpanRecord, 'durationMs'>>;
  try { validated = parseInputSpans(located.map(item => item.span)); }
  catch (error) {
    if (!(error instanceof SpanInputError)) throw error;
    const mapped = error.message.replace(/^spans\[(\d+)\](?:\.([A-Za-z]\w*))?/, (_match, index: string, field: string | undefined) => {
      const item = located[Number(index)];
      return field ? item.fields[field] ?? `${item.path}.${field}` : item.path;
    });
    throw new Error(mapped);
  }
  const rawSpans: TraceFileSpan[] = validated.map((span, index) => ({ ...span, sourceTiming: located[index].span.sourceTiming, durationMs: milliseconds(spanTimes(located[index].span as SpanRecord)[1] - spanTimes(located[index].span as SpanRecord)[0]) }));
  const rootSpan = makeForest(rawSpans)[0];
  const [start, end] = traceBounds(rawSpans);
  let httpStatus: number | null = null;
  for (const span of rawSpans) {
    const code = span.attributes['http.response.status_code'] ?? span.attributes['http.status_code'];
    if (typeof code === 'number') httpStatus = code;
  }
  return { rawSpans, rootSpan, summary: {
    id: rawSpans[0].traceId, rootSpanName: rootSpan.name, rootServiceName: rootSpan.serviceName,
    startTimeMs: milliseconds(start), durationMs: milliseconds(end - start), spanCount: rawSpans.length,
    services: [...new Set(rawSpans.map(span => span.serviceName))], hasError: rawSpans.some(span => span.statusCode === 'ERROR'), httpStatus,
    createdAt: new Date().toISOString(),
  } };
}

/** Jaeger query JSON or one OTLP JSON export envelope. Reads only local content. */
export function parseTraceFile(text: string, filename: string): TraceDetail[] {
  try {
    if (text.length > MAX_TRACE_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_TRACE_FILE_BYTES) fail('$', 'maximum file size is 32 MiB');
    let parsed: unknown;
    try { parsed = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { return fail('$', 'invalid JSON; expected a Jaeger or OTLP trace file'); }
    const input = object(parsed, '$');
    const located = input.resourceSpans !== undefined ? readOtlp(input) : input.data !== undefined || input.spans !== undefined ? readJaeger(input) : fail('$', 'unsupported format; expected Jaeger data[].spans[] or OTLP resourceSpans[].scopeSpans[].spans[]');
    if (!located.length) fail('$', 'the file contains no spans');
    const groups = new Map<string, LocatedSpan[]>();
    for (const item of located) {
      const group = groups.get(item.span.traceId) ?? [];
      group.push(item);
      groups.set(item.span.traceId, group);
    }
    return [...groups.values()].map(buildTrace);
  } catch (error) {
    throw new Error(`${filename}: ${error instanceof Error ? error.message : 'could not parse trace file'}`);
  }
}

function microExport(value: bigint): number | string {
  const integer = value / 1000n;
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : String(integer);
}
function tags(attributes: Attributes): Array<{ key: string; type: string; value: string | number | boolean }> {
  return Object.entries(attributes).map(([key, value]) => ({ key, type: typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? Number.isInteger(value) ? 'int64' : 'float64' : 'string', value }));
}

/** Jaeger query JSON. Extra exact nanosecond fields retain sub-microsecond timing on local reimport. */
export function exportTraceFile(traces: TraceDetail[]): string {
  return JSON.stringify({ data: traces.map(trace => {
    const services = [...new Set(trace.rawSpans.map(span => span.serviceName))];
    const processIds = new Map(services.map((service, index) => [service, `p${index + 1}`]));
    return { traceID: trace.summary.id, processes: Object.fromEntries(services.map(service => [processIds.get(service), { serviceName: service, tags: [] }])), spans: trace.rawSpans.map(span => {
      const [start, end] = spanTimes(span);
      return {
        traceID: span.traceId, spanID: span.id, operationName: span.name, processID: processIds.get(span.serviceName),
        references: span.parentSpanId ? [{ refType: 'CHILD_OF', traceID: span.traceId, spanID: span.parentSpanId }] : [],
        startTime: microExport(start), duration: microExport(end - start), startTimeUnixNano: String(start), endTimeUnixNano: String(end),
        tracepulse: { version: 1, attributes: span.attributes, kind: span.kind, statusCode: span.statusCode, ...(span.statusMessage !== undefined ? { statusMessage: span.statusMessage } : {}), events: span.events ?? [] },
        tags: tags({ ...span.attributes, 'span.kind': span.kind.toLowerCase(), 'otel.status_code': span.statusCode, error: span.statusCode === 'ERROR', ...(span.statusMessage != null ? { 'otel.status_description': span.statusMessage } : {}) }),
        logs: (span.events ?? []).map(event => ({ timestamp: microExport(BigInt(Math.trunc(event.timestampMs)) * 1_000_000n + BigInt(Math.round((event.timestampMs % 1) * 1_000_000))), fields: tags({ ...event.attributes, event: event.name }) })),
      };
    }) };
  }) });
}

function readFile(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text().catch(() => { throw new Error(`${file.name}: could not read the local file`); });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`${file.name}: could not read the local file`));
    reader.readAsText(file);
  });
}

export async function parseTraceFileAsync(file: File): Promise<TraceDetail[]> {
  if (file.size > MAX_TRACE_FILE_BYTES) throw new Error(`${file.name}: maximum file size is 32 MiB`);
  if (file.size < TRACE_WORKER_THRESHOLD_BYTES || typeof Worker === 'undefined') return parseTraceFile(await readFile(file), file.name);
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' }); }
    catch { reject(new Error(`${file.name}: could not start the local import worker`)); return; }
    worker.onmessage = (event: MessageEvent<{ traces?: TraceDetail[]; error?: string }>) => {
      worker.terminate();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.traces) resolve(event.data.traces);
      else reject(new Error(`${file.name}: import worker returned no traces`));
    };
    worker.onerror = () => { worker.terminate(); reject(new Error(`${file.name}: local import worker failed`)); };
    worker.postMessage(file);
  });
}
