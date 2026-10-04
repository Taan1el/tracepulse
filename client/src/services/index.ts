// The one place that decides whether the app talks to the Express API or to
// the in-browser demo. Components import from here, never directly from
// ./api.js or ./demoApi.js.
import * as realApi from './api.js';
import * as demoApi from './demoApi.js';
import { initializeWorkspace, workspaceMode, localTraceSummaries, localTraceDetail,
  localServiceMetrics, localServiceTopology } from '../local/traceWorkspace.js';

export type { TraceFilters, SimulatePayload, TraceparentResult, GeneratedContext } from './api.js';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const impl = isDemoMode ? demoApi : realApi;

async function inWorkspace(): Promise<boolean> {
  if (!isDemoMode) return false;
  await initializeWorkspace();
  return workspaceMode() === 'workspace';
}

export const fetchTraces: typeof impl.fetchTraces = async (params) =>
  await inWorkspace() ? localTraceSummaries(params) : impl.fetchTraces(params);
export const fetchTraceById: typeof impl.fetchTraceById = async (id) =>
  await inWorkspace() ? localTraceDetail(id) : impl.fetchTraceById(id);
export const fetchServices: typeof impl.fetchServices = async () =>
  await inWorkspace() ? localServiceMetrics() : impl.fetchServices();
export const fetchTopology: typeof impl.fetchTopology = async () =>
  await inWorkspace() ? localServiceTopology() : impl.fetchTopology();
export const simulateTraffic: typeof impl.simulateTraffic = async (payload) => {
  if (await inWorkspace()) throw new Error('Generate traffic in Sample data mode. Your workspace contains imported traces.');
  return impl.simulateTraffic(payload);
};
export const parseTraceparentHeader = impl.parseTraceparentHeader;
export const generateW3CContext = impl.generateW3CContext;

// Only the demo has sample data to reset; the banner is the only caller.
export const resetDemoData = demoApi.resetDemoData;
