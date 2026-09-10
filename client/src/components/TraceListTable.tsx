import React from 'react';
import type { TraceSummary } from '../../../shared/types.js';

interface TraceListTableProps {
  traces: TraceSummary[];
  selectedTraceId: string | null;
  onSelectTrace: (id: string) => void;
  loading: boolean;
}

export const TraceListTable: React.FC<TraceListTableProps> = ({
  traces,
  selectedTraceId,
  onSelectTrace,
  loading,
}) => {
  if (loading && traces.length === 0) {
    return (
      <div className="trace-list-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading traces from SQLite WAL...</p>
      </div>
    );
  }

  if (traces.length === 0) {
    return (
      <div className="trace-list-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>No traces match current filters.</p>
      </div>
    );
  }

  return (
    <div className="trace-list-panel">
      <div className="panel-header">
        <div className="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Ingested Traces ({traces.length})
        </div>
      </div>

      <div className="trace-items-scroll">
        {traces.map((trace) => {
          const isSelected = trace.id === selectedTraceId;
          const isSlow = trace.durationMs > 500;

          return (
            <div
              key={trace.id}
              className={`trace-item ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectTrace(trace.id)}
            >
              <div className="trace-item-top">
                <span className="trace-op-name" title={trace.rootSpanName}>
                  {trace.rootSpanName}
                </span>
                <span
                  className="trace-duration-badge"
                  style={{
                    color: isSlow ? 'var(--color-amber)' : 'var(--color-cyan)',
                  }}
                >
                  {trace.durationMs}ms
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {trace.id.substring(0, 12)}...
                </span>
                <span
                  className={`badge-status ${trace.hasError ? 'badge-error' : 'badge-ok'}`}
                >
                  {trace.hasError ? 'ERROR' : 'OK'}
                </span>
              </div>

              <div className="trace-services-tags">
                {trace.services.map((svc) => (
                  <span key={svc} className="service-pill">
                    {svc}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
