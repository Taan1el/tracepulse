import React from 'react';
import type { ServiceMetric, TraceSummary } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

interface StatsStripProps {
  traces: TraceSummary[];
  services: ServiceMetric[];
}

export const StatsStrip: React.FC<StatsStripProps> = ({ traces, services }) => {
  const failed = traces.filter((t) => t.hasError).length;
  const errorRate = traces.length > 0 ? (failed / traces.length) * 100 : 0;
  const meanMs =
    traces.length > 0 ? traces.reduce((sum, t) => sum + t.durationMs, 0) / traces.length : 0;
  const slowest = services.reduce<ServiceMetric | null>(
    (best, s) => (best === null || s.p95Ms > best.p95Ms ? s : best),
    null
  );

  const cell = (label: string, value: string | number, note: string, tone = '') => (
    <div className="stat-cell">
      <dt className="stat-label">{label}</dt>
      <dd className={`stat-value ${tone}`}>{value}</dd>
      <dd className="stat-note">{note}</dd>
    </div>
  );

  return (
    <dl className="readout">
      {cell('Traces loaded', traces.length, formatCount(services.length, 'service'))}
      {cell('Traces with errors', `${errorRate.toFixed(1)}%`, `${failed} of ${traces.length}`, errorRate > 10 ? 'is-bad' : '')}
      {cell('Mean trace duration', `${meanMs.toFixed(1)} ms`, 'loaded traces')}
      {cell(
        'Highest P95',
        `${slowest ? slowest.p95Ms.toFixed(1) : '0.0'} ms`,
        slowest ? slowest.serviceName : 'no spans yet',
        slowest && slowest.p95Ms > 500 ? 'is-warn' : ''
      )}
    </dl>
  );
};
