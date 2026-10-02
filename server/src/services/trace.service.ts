import type {
  TraceSummary,
  TraceDetail,
  ServiceMetric,
  ServiceTopology,
} from '../../../shared/types.js';
import { TraceRepository } from '../repositories/trace.repository.js';
import { buildTraceFromInput, buildTraceDetail } from '../../../shared/trace-builder.js';

export class TraceService {
  constructor(private traceRepo: TraceRepository) {}

  ingestSpans(inputSpans: unknown): TraceDetail {
    const detail = buildTraceFromInput(inputSpans);
    this.traceRepo.saveTraceWithSpans(detail.summary, detail.rawSpans);
    return detail;
  }

  getTraceById(traceId: string): TraceDetail | null {
    const summary = this.traceRepo.getTraceSummaryById(traceId);
    if (!summary) return null;

    return buildTraceDetail(summary, this.traceRepo.getSpansByTraceId(traceId));
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
