import type { SpanRecord, TraceDetail } from '../../../shared/types.js';
import type { TraceFileSpan } from './traceFiles.js';

type Interval = [bigint, bigint];
function times(span: SpanRecord): Interval {
  const precise = (span as TraceFileSpan).sourceTiming;
  if (precise) return [BigInt(precise.startTimeUnixNano), BigInt(precise.endTimeUnixNano)];
  const convert = (value: number) => BigInt(Math.trunc(value)) * 1_000_000n + BigInt(Math.round((value % 1) * 1_000_000));
  return [convert(span.startTimeMs), convert(span.endTimeMs)];
}
function exclusiveTime(span: SpanRecord, children: SpanRecord[]): bigint {
  const [start, end] = times(span);
  const intervals: Interval[] = children.map(child => {
    const [childStart, childEnd] = times(child);
    return [childStart > start ? childStart : start, childEnd < end ? childEnd : end] as Interval;
  }).filter(([from, to]) => to > from).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  let covered = 0n;
  let intervalEnd = start;
  for (const [from, to] of intervals) {
    if (to <= intervalEnd) continue;
    covered += to - (from > intervalEnd ? from : intervalEnd);
    intervalEnd = to;
  }
  return end > start ? end - start - covered : 0n;
}

/**
 * Structural critical-path estimate: exclusive parent time plus the heaviest child branch.
 * Merged, clipped direct-child intervals avoid counting nested or overlapping children twice.
 * This is not a causal latency measurement: sequential sibling work is omitted, and skewed
 * clocks or descendants outside parent bounds can distort the estimate. Orphans compete as roots.
 */
export function analyzeTrace(trace: TraceDetail): { slowest: SpanRecord[]; criticalPath: SpanRecord[]; criticalDurationMs: number } {
  const slowest = [...trace.rawSpans].sort((a, b) => b.durationMs - a.durationMs || a.startTimeMs - b.startTimeMs || a.id.localeCompare(b.id));
  const byId = new Map(trace.rawSpans.map(span => [span.id, span]));
  const children = new Map<string, SpanRecord[]>();
  const roots: SpanRecord[] = [];
  for (const span of byId.values()) {
    if (!span.parentSpanId || !byId.has(span.parentSpanId)) roots.push(span);
    else {
      const siblings = children.get(span.parentSpanId) ?? [];
      siblings.push(span);
      children.set(span.parentSpanId, siblings);
    }
  }
  const scores = new Map<string, { score: bigint; next?: string }>();
  const visited = new Set<string>();
  const order: SpanRecord[] = [];
  const stack = [...roots];
  while (stack.length) {
    const span = stack.pop()!;
    if (visited.has(span.id)) continue;
    visited.add(span.id);
    order.push(span);
    for (const child of children.get(span.id) ?? []) stack.push(child);
  }
  for (let index = order.length - 1; index >= 0; index--) {
    const span = order[index];
    const direct = children.get(span.id) ?? [];
    let largest = 0n;
    let next: string | undefined;
    for (const child of direct) {
      const childScore = scores.get(child.id)?.score ?? 0n;
      if (next === undefined || childScore > largest) { largest = childScore; next = child.id; }
    }
    scores.set(span.id, { score: exclusiveTime(span, direct) + largest, next });
  }
  let chosen: SpanRecord | undefined;
  let largest = 0n;
  for (const root of roots) {
    const score = scores.get(root.id)?.score ?? 0n;
    if (chosen === undefined || score > largest) { chosen = root; largest = score; }
  }
  const criticalPath: SpanRecord[] = [];
  const pathIds = new Set<string>();
  while (chosen && !pathIds.has(chosen.id)) {
    pathIds.add(chosen.id);
    criticalPath.push(chosen);
    const next: string | undefined = scores.get(chosen.id)?.next;
    chosen = next ? byId.get(next) : undefined;
  }
  return { slowest, criticalPath, criticalDurationMs: Number(largest / 1_000_000n) + Number(largest % 1_000_000n) / 1_000_000 };
}
