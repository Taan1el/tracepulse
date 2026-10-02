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

  return (
    <div className="stats-strip">
      <div className="stat-cell">
        <span className="stat-label">Traces loaded</span>
        <span className="stat-value">{traces.length}</span>
        <span className="stat-note">{formatCount(services.length, 'service')}</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Traces with errors</span>
        <span className={`stat-value ${errorRate > 10 ? 'is-bad' : ''}`}>{`${errorRate.toFixed(1)}%`}</span>
        <span className="stat-note">{`${failed} of ${traces.length}`}</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Mean trace duration</span>
        <span className="stat-value">{`${meanMs.toFixed(1)} ms`}</span>
        <span className="stat-note">loaded traces</span>
      </div>

      <div className="stat-cell">
        <span className="stat-label">Highest P95</span>
        <span className={`stat-value ${slowest && slowest.p95Ms > 500 ? 'is-warn' : ''}`}>
          {`${slowest ? slowest.p95Ms.toFixed(1) : '0.0'} ms`}
        </span>
        <span className="stat-note stat-note-wrap">{slowest ? slowest.serviceName : 'no spans yet'}</span>
      </div>
    </div>
  );
};
