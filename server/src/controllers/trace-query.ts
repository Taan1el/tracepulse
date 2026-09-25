export class TraceQueryError extends Error {}

function optionalString(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TraceQueryError(`Parameter '${key}' must be a single non-empty string`);
  }
  return value;
}

function duration(query: Record<string, unknown>, key: string): number | undefined {
  const value = optionalString(query, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)
    || !Number.isFinite(parsed) || parsed < 0) {
    throw new TraceQueryError(`Parameter '${key}' must be a finite non-negative decimal number`);
  }
  return parsed;
}

export function parseTraceQuery(query: Record<string, unknown>) {
  const serviceName = optionalString(query, 'service');
  const minDurationMs = duration(query, 'minDuration');
  const maxDurationMs = duration(query, 'maxDuration');
  if (minDurationMs !== undefined && maxDurationMs !== undefined && minDurationMs > maxDurationMs) {
    throw new TraceQueryError("Parameter 'minDuration' cannot exceed 'maxDuration'");
  }

  const rawError = optionalString(query, 'hasError');
  if (rawError !== undefined && rawError !== 'true' && rawError !== 'false') {
    throw new TraceQueryError("Parameter 'hasError' must be 'true' or 'false'");
  }

  const rawLimit = optionalString(query, 'limit');
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if ((rawLimit !== undefined && !/^\d+$/.test(rawLimit))
    || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new TraceQueryError("Parameter 'limit' must be an integer between 1 and 100");
  }

  return {
    serviceName, minDurationMs, maxDurationMs,
    hasError: rawError === undefined ? undefined : rawError === 'true',
    limit,
  };
}
