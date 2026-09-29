import type {
  SpanRecord,
  TraceSummary,
  TraceDetail,
  ServiceMetric,
  ServiceTopology,
} from '../../../shared/types.js';
import { TraceRepository } from '../repositories/trace.repository.js';
import { buildSpanTree } from './trace-tree.js';
import { parseInputSpans, SpanInputError } from './span-input.js';

export class TraceService {
  constructor(private traceRepo: TraceRepository) {}

  ingestSpans(inputSpans: unknown): TraceDetail {
    const processedSpans: SpanRecord[] = parseInputSpans(inputSpans).map((s) => {
      const durationMs = Math.round((s.endTimeMs - s.startTimeMs) * 100) / 100;

      return {
        ...s,
        durationMs,
      };
    });

    const primaryTraceId = processedSpans[0].traceId;
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
      if (span.statusCode === 'ERROR') {
        hasError = true;
      }
      if (span.attributes && typeof span.attributes['http.status_code'] === 'number') {
        httpStatus = span.attributes['http.status_code'] as number;
      }
    }

    const summary: TraceSummary = {
      id: primaryTraceId,
      rootSpanName: rootNode.name,
      rootServiceName: rootNode.serviceName,
      startTimeMs: treeResult.startTimeMs,
      durationMs: treeResult.totalDurationMs,
      spanCount: processedSpans.length,
      services: Array.from(serviceSet),
      hasError,
      httpStatus,
      createdAt: new Date().toISOString(),
    };

    this.traceRepo.saveTraceWithSpans(summary, processedSpans);

    return {
      summary,
      rootSpan: rootNode,
      rawSpans: processedSpans,
    };
  }

  getTraceById(traceId: string): TraceDetail | null {
    const summary = this.traceRepo.getTraceSummaryById(traceId);
    if (!summary) return null;

    const rawSpans = this.traceRepo.getSpansByTraceId(traceId);
    const treeResult = buildSpanTree(rawSpans);

    if (!treeResult.rootNode) return null;

    return {
      summary,
      rootSpan: treeResult.rootNode,
      rawSpans,
    };
  }

  queryTraces(filter?: {
    serviceName?: string;
    minDurationMs?: number;
    maxDurationMs?: number;
    hasError?: boolean;
    limit?: number;
  }): TraceSummary[] {
    return this.traceRepo.queryTraces(filter);
  }

  getServiceMetrics(): ServiceMetric[] {
    return this.traceRepo.getServiceMetrics();
  }

  getServiceTopology(): ServiceTopology {
    const edges = this.traceRepo.getServiceDependencies();
    const metrics = this.traceRepo.getServiceMetrics();

    const nodes = metrics.map((m) => ({
      id: m.serviceName,
      name: m.serviceName,
      callCount: m.requestCount,
      errorRate: m.errorRate,
      avgDurationMs: m.avgDurationMs,
    }));

    return {
      nodes,
      edges,
    };
  }
}
