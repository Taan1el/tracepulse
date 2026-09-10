import React from 'react';
import type { ServiceMetric, TraceSummary } from '../../../shared/types.js';

interface MetricsRibbonProps {
  traces: TraceSummary[];
  services: ServiceMetric[];
}

export const MetricsRibbon: React.FC<MetricsRibbonProps> = ({ traces, services }) => {
  const totalTraces = traces.length;
  const errorTraces = traces.filter((t) => t.hasError).length;
  const errorRate = totalTraces > 0 ? ((errorTraces / totalTraces) * 100).toFixed(1) : '0.0';

  const durations = traces.map((t) => t.durationMs);
  const avgLatency =
    durations.length > 0
      ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1)
      : '0.0';

  // Compute aggregate p95 across services
  const maxP95 = services.length > 0 ? Math.max(...services.map((s) => s.p95Ms)).toFixed(1) : '0.0';

  return (
    <section className="metrics-ribbon">
      <div className="metric-card">
        <div className="metric-title">Observed Traces</div>
        <div className="metric-val" style={{ color: 'var(--color-cyan)' }}>
          {totalTraces}
        </div>
        <div className="metric-foot">
          <span>{services.length} Microservices</span>
          <span>SQLite WAL</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-title">Global Error Rate</div>
        <div
          className="metric-val"
          style={{ color: parseFloat(errorRate) > 10 ? 'var(--color-crimson)' : 'var(--color-emerald)' }}
        >
          {errorRate}%
        </div>
        <div className="metric-foot">
          <span>{errorTraces} Failed Spans</span>
          <span>HTTP 4xx/5xx</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-title">Mean Latency</div>
        <div className="metric-val" style={{ color: 'var(--text-primary)' }}>
          {avgLatency} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>ms</span>
        </div>
        <div className="metric-foot">
          <span>Across all spans</span>
          <span>Rolling window</span>
        </div>
      </div>

      <div className="metric-card">
        <div className="metric-title">P95 Peak Latency</div>
        <div
          className="metric-val"
          style={{ color: parseFloat(maxP95) > 500 ? 'var(--color-amber)' : 'var(--color-cyan)' }}
        >
          {maxP95} <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>ms</span>
        </div>
        <div className="metric-foot">
          <span>Slowest microservice</span>
          <span>Tail latency</span>
        </div>
      </div>
    </section>
  );
};
