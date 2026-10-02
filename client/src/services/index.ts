// The one place that decides whether the app talks to the Express API or to
// the in-browser demo. Components import from here, never directly from
// ./api.js or ./demoApi.js.
import * as realApi from './api.js';
import * as demoApi from './demoApi.js';

export type { TraceFilters, SimulatePayload, TraceparentResult, GeneratedContext } from './api.js';

export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';

const impl = isDemoMode ? demoApi : realApi;

export const fetchTraces = impl.fetchTraces;
export const fetchTraceById = impl.fetchTraceById;
export const fetchServices = impl.fetchServices;
export const fetchTopology = impl.fetchTopology;
export const simulateTraffic = impl.simulateTraffic;
export const parseTraceparentHeader = impl.parseTraceparentHeader;
export const generateW3CContext = impl.generateW3CContext;

// Only the demo has sample data to reset; the banner is the only caller.
export const resetDemoData = demoApi.resetDemoData;
