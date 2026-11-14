import type { TraceDetail, TraceSummary } from '../../../shared/types.js';
import { computeServiceMetrics, filterTraces } from '../../../shared/analytics.js';
import { importTraceFileAsync, restoreTrace, storableTrace, type StoredTrace } from './traceFiles.js';
import { clearWorkspace, loadMode, loadWorkspace, saveMode, saveWorkspace, SavedWorkspaceError } from './workspace.js';
import type { TraceFilters } from '../services/api.js';

export type WorkspaceMode = 'sample' | 'workspace';
/** Version 2 keeps the normalized spans. Version 1 kept an exported Jaeger file that had to be parsed again on every start. */
type StoredTraces = { version: 2; traces: StoredTrace[] } | { version: 1; source: string };
let mode: WorkspaceMode = 'sample';
let traces: TraceDetail[] = [];
let ready: Promise<void> | undefined;
const listeners = new Set<() => void>();

export function subscribeWorkspace(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify(): void { listeners.forEach((listener) => listener()); }
export function workspaceMode(): WorkspaceMode { return mode; }
export function workspaceTraces(): TraceDetail[] { return traces; }

function unreadable(detail: string): SavedWorkspaceError {
  return new SavedWorkspaceError(`The saved workspace in this browser cannot be read (${detail}). Clear it to start again, or import a backup file to replace it.`);
}

async function readSaved(saved: StoredTraces): Promise<TraceDetail[]> {
  if (saved.version === 2) {
    if (!Array.isArray(saved.traces)) throw unreadable('its trace list is missing');
    try { return saved.traces.map(restoreTrace); }
    catch (error) { throw unreadable(error instanceof Error ? error.message : 'invalid stored trace'); }
  }
  if (saved.version !== 1 || typeof saved.source !== 'string') {
    throw new SavedWorkspaceError('The saved workspace in this browser has an unsupported format. Clear it to start again, or import a backup file to replace it.');
  }
  // Older saves hold a Jaeger file. Read it in the import worker, then keep the normalized form so the next start needs no parsing.
  let parsed: TraceDetail[];
  try { parsed = (await importTraceFileAsync(new File([saved.source], 'Saved workspace'))).traces; }
  catch (error) { throw unreadable(error instanceof Error ? error.message : 'invalid saved file'); }
  void saveWorkspace<StoredTraces>({ version: 2, traces: parsed.map(storableTrace) }).catch(() => undefined);
  return parsed;
}

export function initializeWorkspace(): Promise<void> {
  ready ??= (async () => {
    const [savedMode, saved] = await Promise.all([loadMode(), loadWorkspace<StoredTraces>()]);
    traces = saved ? await readSaved(saved) : [];
    mode = savedMode;
    notify();
  })().catch((error: unknown) => { ready = undefined; throw error; });
  return ready;
}

export async function chooseWorkspaceMode(next: WorkspaceMode): Promise<void> {
  await initializeWorkspace();
  await saveMode(next);
  mode = next;
  notify();
}

/** Replace only after the entire file is parsed and the storage write succeeds. */
export async function replaceWorkspace(next: TraceDetail[]): Promise<void> {
  // An explicit import can replace an unreadable saved workspace with a valid backup.
  await initializeWorkspace().catch(() => undefined);
  await saveWorkspace<StoredTraces>({ version: 2, traces: next.map(storableTrace) }, { mode: 'workspace' });
  traces = next;
  mode = 'workspace';
  ready = Promise.resolve();
  notify();
}

export async function removeWorkspace(): Promise<void> {
  // A workspace that cannot be read must still be possible to clear.
  await initializeWorkspace().catch(() => undefined);
  await clearWorkspace();
  traces = [];
  mode = await loadMode().catch(() => mode);
  ready = Promise.resolve();
  notify();
}

export async function localTraceSummaries(params?: TraceFilters): Promise<TraceSummary[]> {
  await initializeWorkspace();
  return filterTraces(traces.map((trace) => trace.summary), {
    serviceName: params?.service, minDurationMs: params?.minDuration,
    maxDurationMs: params?.maxDuration, hasError: params?.hasError,
    limit: params?.limit ?? Math.max(1, traces.length),
  });
}

export async function localTraceDetail(id: string): Promise<TraceDetail> {
  await initializeWorkspace();
  const trace = traces.find((item) => item.summary.id === id);
  if (!trace) throw new Error('The selected trace is no longer in this workspace.');
  return trace;
}

export async function localServiceMetrics() {
  await initializeWorkspace();
  return computeServiceMetrics(traces.flatMap((trace) => trace.rawSpans));
}

export async function localServiceTopology() {
  await initializeWorkspace();
  const metrics = await localServiceMetrics();
  // Span IDs are scoped to a trace, so compute calls within each trace first.
  const edges = new Map<string, { id: string; source: string; target: string; callCount: number; sum: number; errorCount: number }>();
  for (const trace of traces) {
    const byId = new Map(trace.rawSpans.map((span) => [span.id, span]));
    for (const child of trace.rawSpans) {
      const parent = child.parentSpanId ? byId.get(child.parentSpanId) : undefined;
      if (!parent || parent.serviceName === child.serviceName) continue;
      const id = JSON.stringify([parent.serviceName, child.serviceName]);
      const edge = edges.get(id) ?? { id, source: parent.serviceName, target: child.serviceName, callCount: 0, sum: 0, errorCount: 0 };
      edge.callCount++; edge.sum += child.durationMs;
      if (child.statusCode === 'ERROR') edge.errorCount++;
      edges.set(id, edge);
    }
  }
  return {
    nodes: metrics.map((item) => ({ id: item.serviceName, name: item.serviceName,
      callCount: item.requestCount, errorRate: item.errorRate, avgDurationMs: item.avgDurationMs })),
    edges: [...edges.values()].map(({ sum, ...edge }) => ({ ...edge, avgDurationMs: Math.round(sum / edge.callCount * 100) / 100 })),
  };
}
