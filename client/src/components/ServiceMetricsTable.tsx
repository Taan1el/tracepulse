import React from 'react';
import type { ServiceMetric } from '../../../shared/types.js';

interface ServiceMetricsTableProps {
  metrics: ServiceMetric[];
  loading: boolean;
}

export const ServiceMetricsTable: React.FC<ServiceMetricsTableProps> = ({ metrics, loading }) => {
  if (loading && metrics.length === 0) {
    return (
      <div className="waterfall-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Calculating service APM percentiles...</p>
      </div>
    );
  }

  return (
    <div className="waterfall-panel">
      <div className="panel-header">
        <div className="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="2" width="20" height="8" rx="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          Service Latency Percentiles & APM Performance Matrix
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="attributes-table" style={{ margin: 0, width: '100%' }}>
          <thead>
            <tr>
              <th style={{ padding: '0.8rem 1rem' }}>Service Name</th>
              <th>Requests</th>
              <th>Error Rate</th>
              <th>Avg Latency</th>
              <th>P50 (Median)</th>
              <th>P90</th>
              <th>P95 (SLA)</th>
              <th>P99 (Tail)</th>
              <th>Throughput</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const isHighError = m.errorRate > 15;
              const isHighP95 = m.p95Ms > 500;

              return (
                <tr key={m.serviceName} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.8rem 1rem', fontWeight: 700, color: 'var(--color-cyan)' }}>
                    {m.serviceName}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.requestCount}</td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: isHighError ? 'var(--color-crimson)' : 'var(--color-emerald)',
                      fontWeight: 700,
                    }}
                  >
                    {m.errorRate}% ({m.errorCount})
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.avgDurationMs} ms</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.p50Ms} ms</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.p90Ms} ms</td>
                  <td
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: isHighP95 ? 'var(--color-amber)' : 'var(--text-primary)',
                      fontWeight: 700,
                    }}
                  >
                    {m.p95Ms} ms
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.p99Ms} ms</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>{m.throughputRps} rps</td>
                  <td>
                    {isHighError ? (
                      <span className="badge-status badge-error">Degraded</span>
                    ) : isHighP95 ? (
                      <span className="badge-status" style={{ background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24' }}>
                        Warning
                      </span>
                    ) : (
                      <span className="badge-status badge-ok">Healthy</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
