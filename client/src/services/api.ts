import type {
  TraceSummary,
  TraceDetail,
  ServiceMetric,
  ServiceTopology,
  W3CTraceparent,
  ApiResponse,
} from '../../../shared/types.js';

const API_BASE = '/api';

export async function fetchHealth(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

export async function fetchTraces(params?: {
  service?: string;
  minDuration?: number;
  maxDuration?: number;
  hasError?: boolean;
  limit?: number;
}): Promise<TraceSummary[]> {
  const query = new URLSearchParams();
  if (params?.service) query.set('service', params.service);
  if (params?.minDuration !== undefined) query.set('minDuration', String(params.minDuration));
  if (params?.maxDuration !== undefined) query.set('maxDuration', String(params.maxDuration));
  if (params?.hasError !== undefined) query.set('hasError', String(params.hasError));
  if (params?.limit !== undefined) query.set('limit', String(params.limit));

  const res = await fetch(`${API_BASE}/traces?${query.toString()}`);
  const json: ApiResponse<TraceSummary[]> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch traces');
  return json.data;
}

export async function fetchTraceById(id: string): Promise<TraceDetail> {
  const res = await fetch(`${API_BASE}/traces/${id}`);
  const json: ApiResponse<TraceDetail> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch trace details');
  return json.data;
}

export async function fetchServices(): Promise<ServiceMetric[]> {
  const res = await fetch(`${API_BASE}/services`);
  const json: ApiResponse<ServiceMetric[]> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch services');
  return json.data;
}

export async function fetchTopology(): Promise<ServiceTopology> {
  const res = await fetch(`${API_BASE}/services/graph`);
  const json: ApiResponse<ServiceTopology> = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to fetch topology');
  return json.data;
}

export async function simulateTraffic(payload: {
  flowType?: 'checkout' | 'auth' | 'search' | 'batch';
  injectAnomaly?: boolean;
  batchCount?: number;
}): Promise<TraceDetail | TraceSummary[]> {
  const res = await fetch(`${API_BASE}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Simulation failed');
  return json.data;
}

export async function parseTraceparentHeader(header: string): Promise<{
  parsed: W3CTraceparent;
  propagatedHeader: string;
  childSpanId: string;
}> {
  const res = await fetch(`${API_BASE}/w3c/parse?traceparent=${encodeURIComponent(header)}`);
  const json = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to parse traceparent');
  return json.data;
}

export async function generateW3CContext(): Promise<{
  traceId: string;
  spanId: string;
  traceparent: string;
}> {
  const res = await fetch(`${API_BASE}/w3c/context`);
  const json = await res.json();
  if (!json.success || !json.data) throw new Error(json.error || 'Failed to generate context');
  return json.data;
}
