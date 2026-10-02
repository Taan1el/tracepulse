import type { SpanRecord, SpanNode } from './types.js';

export function buildSpanTree(spans: SpanRecord[]): {
  rootNode: SpanNode | null;
  totalDurationMs: number;
  startTimeMs: number;
  endTimeMs: number;
  bottleneckSpanId?: string;
} {
  if (!spans || spans.length === 0) {
    return {
      rootNode: null,
      totalDurationMs: 0,
      startTimeMs: 0,
      endTimeMs: 0,
    };
  }

  const startTimeMs = Math.min(...spans.map((s) => s.startTimeMs));
  const endTimeMs = Math.max(...spans.map((s) => s.endTimeMs));
  const totalDurationMs = Math.max(0.1, endTimeMs - startTimeMs);

  // Identify bottleneck: find child/descendant span with the longest duration, or root if single span
  const childSpans = spans.filter((s) => s.parentSpanId);
  const candidateSpans = childSpans.length > 0 ? childSpans : spans;

  let maxDuration = -1;
  let bottleneckSpanId: string | undefined;
  for (const s of candidateSpans) {
    if (s.durationMs > maxDuration) {
      maxDuration = s.durationMs;
      bottleneckSpanId = s.id;
    }
  }

  // Map spans by ID
  const spanMap = new Map<string, SpanRecord>();
  const childrenMap = new Map<string, SpanRecord[]>();

  for (const s of spans) {
    spanMap.set(s.id, s);
    if (s.parentSpanId) {
      const existing = childrenMap.get(s.parentSpanId) || [];
      existing.push(s);
      childrenMap.set(s.parentSpanId, existing);
    }
  }

  // Identify root spans (no parent or parent not in map)
  const rootCandidates = spans.filter(
    (s) => !s.parentSpanId || !spanMap.has(s.parentSpanId)
  );

  // Sort candidate roots by startTimeMs
  rootCandidates.sort((a, b) => a.startTimeMs - b.startTimeMs);
  const primaryRoot = rootCandidates[0];

  function createNode(span: SpanRecord, depth: number): SpanNode {
    const rawChildren = childrenMap.get(span.id) || [];
    rawChildren.sort((a, b) => a.startTimeMs - b.startTimeMs);

    const offsetMs = Math.max(0, Math.round((span.startTimeMs - startTimeMs) * 100) / 100);
    const durationPercent = Math.min(
      100,
      Math.max(0.5, Math.round((span.durationMs / totalDurationMs) * 10000) / 100)
    );

    const children = rawChildren.map((child) => createNode(child, depth + 1));

    return {
      ...span,
      depth,
      offsetMs,
      durationPercent,
      isBottleneck: span.id === bottleneckSpanId,
      children,
    };
  }

  const rootNode = primaryRoot ? createNode(primaryRoot, 0) : null;

  return {
    rootNode,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
    startTimeMs,
    endTimeMs,
    bottleneckSpanId,
  };
}

export function flattenSpanTree(root: SpanNode): SpanNode[] {
  const result: SpanNode[] = [];
  function traverse(node: SpanNode) {
    result.push(node);
    for (const child of node.children) {
      traverse(child);
    }
  }
  traverse(root);
  return result;
}
