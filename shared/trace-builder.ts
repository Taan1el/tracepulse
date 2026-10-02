import type { SpanRecord, TraceDetail, TraceSummary } from './types.js';
import { buildSpanTree } from './trace-tree.js';
import { parseInputSpans, SpanInputError } from './span-input.js';

/** Builds the stored form of a trace (summary, span tree, raw spans) from a validated span batch. */
export function buildTraceFromInput(inputSpans: unknown, now: Date = new Date()): TraceDetail {
  const processedSpans: SpanRecord[] = parseInputSpans(inputSpans).map((s) => ({
    ...s,
    durationMs: Math.round((s.endTimeMs - s.startTimeMs) * 100) / 100,
  }));

  const treeResult = buildSpanTree(processedSpans);
  const rootNode = treeResult.rootNode;
  if (!rootNode) {
    throw new SpanInputError('Could not construct root node from provided spans');
  }

  const serviceSet = new Set<string>();
  let hasError = false;
  let httpStatus: number | null = null;

  for (const span of processedSpans) {
    serviceSet.add(span.serviceName);
    if (span.statusCode === 'ERROR') hasError = true;
    const status = span.attributes?.['http.status_code'];
    if (typeof status === 'number') httpStatus = status;
  }

  const summary: TraceSummary = {
    id: processedSpans[0].traceId,
    rootSpanName: rootNode.name,
    rootServiceName: rootNode.serviceName,
    startTimeMs: treeResult.startTimeMs,
    durationMs: treeResult.totalDurationMs,
    spanCount: processedSpans.length,
    services: Array.from(serviceSet),
    hasError,
    httpStatus,
    createdAt: now.toISOString(),
  };

  return { summary, rootSpan: rootNode, rawSpans: processedSpans };
}

/** Rebuilds the tree for a stored trace; null when the spans produce no root. */
export function buildTraceDetail(summary: TraceSummary, rawSpans: SpanRecord[]): TraceDetail | null {
  const treeResult = buildSpanTree(rawSpans);
  if (!treeResult.rootNode) return null;
  return { summary, rootSpan: treeResult.rootNode, rawSpans };
}
