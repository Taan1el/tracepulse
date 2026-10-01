import type { SpanRecord } from '../../../shared/types.js';
import { isValidSpanId, isValidTraceId } from './traceparent.js';

export class SpanInputError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireValue(valid: boolean, path: string, requirement: string): asserts valid {
  if (!valid) throw new SpanInputError(`${path} ${requirement}`);
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function timestamp(value: unknown, path: string): asserts value is number {
  requireValue(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER,
    path, 'must be a finite number from 0 through Number.MAX_SAFE_INTEGER');
}

function attributes(value: unknown, path: string): void {
  requireValue(object(value) && Object.values(value).every(item =>
    typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))),
  path, 'must be an object containing only strings, finite numbers, or booleans');
}

export function parseInputSpans(input: unknown): Array<Omit<SpanRecord, 'durationMs'>> {
  requireValue(Array.isArray(input) && input.length > 0, 'spans', 'must be a non-empty array');
  const spans = input.map((span: unknown, index: number) => {
    const path = `spans[${index}]`;
    requireValue(object(span), path, 'must be an object');
    requireValue(typeof span.id === 'string' && isValidSpanId(span.id), `${path}.id`, 'must be a non-zero 16-hex string');
    requireValue(typeof span.traceId === 'string' && isValidTraceId(span.traceId), `${path}.traceId`, 'must be a non-zero 32-hex string');
    requireValue(span.parentSpanId === undefined || span.parentSpanId === null ||
      (typeof span.parentSpanId === 'string' && isValidSpanId(span.parentSpanId)), `${path}.parentSpanId`, 'must be null or a non-zero 16-hex string');
    requireValue(nonBlank(span.serviceName), `${path}.serviceName`, 'must be a non-blank string');
    requireValue(nonBlank(span.name), `${path}.name`, 'must be a non-blank string');
    requireValue(typeof span.kind === 'string' && ['SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL'].includes(span.kind), `${path}.kind`, 'must be a supported span kind');
    requireValue(typeof span.statusCode === 'string' && ['OK', 'ERROR', 'UNSET'].includes(span.statusCode), `${path}.statusCode`, 'must be OK, ERROR, or UNSET');
    requireValue(span.statusMessage === undefined || span.statusMessage === null || typeof span.statusMessage === 'string', `${path}.statusMessage`, 'must be a string or null');
    timestamp(span.startTimeMs, `${path}.startTimeMs`);
    timestamp(span.endTimeMs, `${path}.endTimeMs`);
    requireValue(span.endTimeMs >= span.startTimeMs, `${path}.endTimeMs`, 'must be greater than or equal to startTimeMs');
    if (span.attributes !== undefined) attributes(span.attributes, `${path}.attributes`);
    if (span.events !== undefined) {
      requireValue(Array.isArray(span.events), `${path}.events`, 'must be an array');
      span.events.forEach((event: unknown, eventIndex: number) => {
        const eventPath = `${path}.events[${eventIndex}]`;
        requireValue(object(event), eventPath, 'must be an object');
        requireValue(nonBlank(event.name), `${eventPath}.name`, 'must be a non-blank string');
        timestamp(event.timestampMs, `${eventPath}.timestampMs`);
        if (event.attributes !== undefined) attributes(event.attributes, `${eventPath}.attributes`);
      });
    }
    return {
      ...span,
      id: span.id.toLowerCase(),
      traceId: span.traceId.toLowerCase(),
      parentSpanId: typeof span.parentSpanId === 'string' ? span.parentSpanId.toLowerCase() : span.parentSpanId,
      attributes: span.attributes ?? {},
    } as Omit<SpanRecord, 'durationMs'>;
  });
  const traceId = spans[0].traceId;
  const spanIds = new Set<string>();
  spans.forEach((span, index) => {
    requireValue(span.traceId === traceId, `spans[${index}].traceId`, 'must match the first span traceId');
    requireValue(!spanIds.has(span.id), `spans[${index}].id`, 'must be unique within the batch');
    spanIds.add(span.id);
  });
  validateParentChains(spans);
  return spans;
}

function validateParentChains(spans: Array<Omit<SpanRecord, 'durationMs'>>): void {
  const byId = new Map(spans.map((span, index) => [span.id, { span, index }]));
  const depths = new Map<string, number>();

  // Walk every component iteratively, then reuse resolved ancestor depths.
  for (const entry of byId.values()) {
    const path: Array<typeof entry> = [];
    const visiting = new Set<string>();
    let current: typeof entry | undefined = entry;
    while (current && !depths.has(current.span.id)) {
      requireValue(!visiting.has(current.span.id), `spans[${current.index}].parentSpanId`,
        'must not form a cycle');
      visiting.add(current.span.id);
      path.push(current);
      current = current.span.parentSpanId ? byId.get(current.span.parentSpanId) : undefined;
    }

    let depth = current ? depths.get(current.span.id)! : -1;
    while (path.length > 0) {
      const ancestor = path.pop()!;
      depth++;
      requireValue(depth <= 128, `spans[${ancestor.index}].parentSpanId`,
        'must not exceed 128 parent edges within the batch');
      depths.set(ancestor.span.id, depth);
    }
  }
}
