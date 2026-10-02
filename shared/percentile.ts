export interface LatencyStats {
  count: number;
  avgMs: number;
  p50Ms: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

export function calculatePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  const result = sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  return Math.round(result * 100) / 100;
}

export function computeLatencyStats(durations: number[]): LatencyStats {
  if (!durations || durations.length === 0) {
    return {
      count: 0,
      avgMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    };
  }

  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, val) => acc + val, 0);
  const avgMs = Math.round((sum / sorted.length) * 100) / 100;

  return {
    count: sorted.length,
    avgMs,
    p50Ms: calculatePercentile(sorted, 50),
    p90Ms: calculatePercentile(sorted, 90),
    p95Ms: calculatePercentile(sorted, 95),
    p99Ms: calculatePercentile(sorted, 99),
    minMs: Math.round(sorted[0] * 100) / 100,
    maxMs: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}
