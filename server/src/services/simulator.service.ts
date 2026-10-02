import type { TraceDetail } from '../../../shared/types.js';
import { buildFlowSpans, FLOW_TYPES, type FlowEnv, type FlowType } from '../../../shared/flows.js';
import { TraceService } from './trace.service.js';
import { generateTraceId, generateSpanId } from '../../../shared/traceparent.js';

const liveEnv: FlowEnv = { random: Math.random, spanId: generateSpanId };

export class SimulatorService {
  constructor(private traceService: TraceService) {}

  simulateFlow(flowType: FlowType = 'checkout', injectAnomaly = false): TraceDetail {
    const traceId = generateTraceId();
    const now = Date.now() - Math.floor(Math.random() * 5000);
    return this.traceService.ingestSpans(buildFlowSpans(liveEnv, flowType, traceId, now, injectAnomaly));
  }

  simulateBatch(count = 5): TraceDetail[] {
    const results: TraceDetail[] = [];

    for (let i = 0; i < count; i++) {
      const anomaly = Math.random() < 0.25; // a quarter of batch traces carry a failure
      results.push(this.simulateFlow(FLOW_TYPES[i % FLOW_TYPES.length], anomaly));
    }

    return results;
  }
}
