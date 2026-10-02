export type SpanKind = 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';

export type SpanStatusCode = 'OK' | 'ERROR' | 'UNSET';

export interface SpanEvent {
  name: string;
  timestampMs: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface SpanRecord {
  id: string; // 16 hex chars (e.g. 00f067aa0ba902b7)
  traceId: string; // 32 hex chars (e.g. 4bf92f3577b34da6a3ce929d0e0e4736)
  parentSpanId?: string | null;
  serviceName: string;
  name: string;
  kind: SpanKind;
  startTimeMs: number;
  endTimeMs: number;
  durationMs: number;
  statusCode: SpanStatusCode;
  statusMessage?: string | null;
  attributes: Record<string, string | number | boolean>;
  events?: SpanEvent[];
}

export interface SpanNode extends SpanRecord {
  children: SpanNode[];
  depth: number;
  offsetMs: number;
  durationPercent: number;
  isBottleneck?: boolean;
}

export interface TraceSummary {
  id: string; // traceId
  rootSpanName: string;
  rootServiceName: string;
  startTimeMs: number;
  durationMs: number;
  spanCount: number;
  services: string[];
  hasError: boolean;
  httpStatus?: number | null;
  createdAt: string;
}

export interface TraceDetail {
  summary: TraceSummary;
  rootSpan: SpanNode;
  rawSpans: SpanRecord[];
}

export interface W3CTraceparent {
  version: string;
  traceId: string;
  parentSpanId: string;
  traceFlags: string;
}

export interface ServiceMetric {
  serviceName: string;
  requestCount: number;
  errorCount: number;
  errorRate: number; // percentage 0 - 100
  avgDurationMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface ServiceDependencyEdge {
  id: string;
  source: string;
  target: string;
  callCount: number;
  avgDurationMs: number;
  errorCount: number;
}

export interface ServiceTopologyNode {
  id: string;
  name: string;
  callCount: number;
  errorRate: number;
  avgDurationMs: number;
}

export interface ServiceTopology {
  nodes: ServiceTopologyNode[];
  edges: ServiceDependencyEdge[];
}

export interface IngestTracePayload {
  spans: Array<Omit<SpanRecord, 'durationMs'>>;
}

export interface SimulateRequest {
  flowType?: 'checkout' | 'auth' | 'search' | 'batch';
  injectAnomaly?: boolean;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
