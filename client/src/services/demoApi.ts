// In-browser stand-in for services/api.ts, used by the GitHub Pages build
// (import.meta.env.VITE_DEMO_MODE === 'true') where no Express API exists.
// Every export matches api.ts by name and signature. The data layer reuses the
// pure logic in shared/ that the server also runs: trace building, flow
// generation, service metrics, dependencies, filtering and traceparent parsing.
import type { ServiceMetric, ServiceTopology, TraceDetail, TraceSummary } from '../../../shared/types.js';
import { buildFlowSpans, FLOW_TYPES, type FlowEnv, type FlowType } from '../../../shared/flows.js';
import { buildTraceFromInput } from '../../../shared/trace-builder.js';
import { computeDependencies, computeServiceMetrics, filterTraces } from '../../../shared/analytics.js';
import { formatTraceparent, generateSpanId, generateTraceId, parseTraceparent } from '../../../shared/traceparent.js';
import type { GeneratedContext, SimulatePayload, TraceFilters, TraceparentResult } from './api.js';

const SEED = 20261002;
const SAMPLE_START_MS = Date.UTC(2026, 9, 1, 9, 0, 0);
const SAMPLE_TRACE_COUNT = 15;
const SAMPLE_SPACING_MS = 9000;
// Which sample traces carry a failure; fixed so every visit shows the same data.
const SAMPLE_FAILURES = new Set([4, 9, 14]);

/** Small seeded generator (mulberry32): same seed, same sequence. */
export function createRng(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexId(rng: () => number, bytes: number): string {
  let out = '';
  for (let i = 0; i < bytes; i++) out += Math.floor(rng() * 256).toString(16).padStart(2, '0');
  // An all-zero id is invalid in W3C Trace Context; the odds are negligible but cheap to rule out.
  return /^0+$/.test(out) ? '1'.padStart(bytes * 2, '0') : out;
}

interface DemoState {
  traces: Map<string, TraceDetail>;
  rng: () => number;
  env: FlowEnv;
}

function ingest(state: DemoState, flow: FlowType, baseTime: number, anomaly: boolean, now: Date): TraceDetail {
  const spans = buildFlowSpans(state.env, flow, hexId(state.rng, 16), baseTime, anomaly);
  const detail = buildTraceFromInput(spans, now);
  state.traces.set(detail.summary.id, detail);
  return detail;
}

function createState(): DemoState {
  const rng = createRng(SEED);
  const state: DemoState = { traces: new Map(), rng, env: { random: rng, spanId: () => hexId(rng, 8) } };
  for (let i = 0; i < SAMPLE_TRACE_COUNT; i++) {
    const start = SAMPLE_START_MS + i * SAMPLE_SPACING_MS;
    ingest(state, FLOW_TYPES[(i + 1) % FLOW_TYPES.length], start, SAMPLE_FAILURES.has(i), new Date(start));
  }
  return state;
}

let state = createState();

/** Restores the sample traces exactly as they were on first load. */
export function resetDemoData(): void {
  state = createState();
}

function allSpans() {
  return [...state.traces.values()].flatMap((t) => t.rawSpans);
}

export async function fetchTraces(params?: TraceFilters): Promise<TraceSummary[]> {
  const summaries = [...state.traces.values()].map((t) => t.summary);
  return filterTraces(summaries, {
    serviceName: params?.service,
    minDurationMs: params?.minDuration,
    maxDurationMs: params?.maxDuration,
    hasError: params?.hasError,
    limit: params?.limit,
  });
}

export async function fetchTraceById(id: string): Promise<TraceDetail> {
  const trace = state.traces.get(id);
  if (!trace) throw new Error(`Trace not found: ${id}`);
  return trace;
}

export async function fetchServices(): Promise<ServiceMetric[]> {
  return computeServiceMetrics(allSpans());
}

export async function fetchTopology(): Promise<ServiceTopology> {
  const spans = allSpans();
  const nodes = computeServiceMetrics(spans).map((m) => ({
    id: m.serviceName,
    name: m.serviceName,
    callCount: m.requestCount,
    errorRate: m.errorRate,
    avgDurationMs: m.avgDurationMs,
  }));
  return { nodes, edges: computeDependencies(spans) };
}

export async function simulateTraffic(payload: SimulatePayload): Promise<TraceDetail | TraceSummary[]> {
  const flowType = payload.flowType ?? 'checkout';
  const count = payload.batchCount;
  const now = new Date();

  if (flowType === 'batch' || (count !== undefined && count > 1)) {
    const results: TraceSummary[] = [];
    for (let i = 0; i < (count ?? 5); i++) {
      const anomaly = state.rng() < 0.25;
      const base = now.getTime() - Math.floor(state.rng() * 5000);
      results.push(ingest(state, FLOW_TYPES[i % FLOW_TYPES.length], base, anomaly, now).summary);
    }
    return results;
  }

  const base = now.getTime() - Math.floor(state.rng() * 5000);
  return ingest(state, flowType, base, payload.injectAnomaly ?? false, now);
}

export async function parseTraceparentHeader(header: string): Promise<TraceparentResult> {
  if (!header.trim()) throw new Error('Missing traceparent header or query parameter');
  const parsed = parseTraceparent(header);
  if (!parsed) throw new Error('Invalid W3C traceparent header format');

  const childSpanId = generateSpanId();
  return { parsed, propagatedHeader: formatTraceparent({ ...parsed, parentSpanId: childSpanId }), childSpanId };
}

export async function generateW3CContext(): Promise<GeneratedContext> {
  const traceId = generateTraceId();
  const spanId = generateSpanId();
  return {
    traceId,
    spanId,
    traceparent: formatTraceparent({ version: '00', traceId, parentSpanId: spanId, traceFlags: '01' }),
  };
}
