export class SimulationRequestError extends Error {}

export function parseSimulationRequest(body: unknown): {
  flowType: 'checkout' | 'auth' | 'search' | 'batch';
  injectAnomaly: boolean;
  batchCount?: number;
} {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new SimulationRequestError('Expected a simulation options object');
  }

  const { flowType = 'checkout', injectAnomaly = false, batchCount } = body as Record<string, unknown>;
  if (flowType !== 'checkout' && flowType !== 'auth' && flowType !== 'search' && flowType !== 'batch') {
    throw new SimulationRequestError('flowType must be checkout, auth, search, or batch');
  }
  if (typeof injectAnomaly !== 'boolean') {
    throw new SimulationRequestError('injectAnomaly must be a boolean');
  }
  if (batchCount !== undefined && (typeof batchCount !== 'number' || !Number.isInteger(batchCount) || batchCount < 1 || batchCount > 20)) {
    throw new SimulationRequestError('batchCount must be an integer from 1 through 20');
  }

  return { flowType, injectAnomaly, batchCount };
}
