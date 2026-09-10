import React, { useState } from 'react';
import type { TraceDetail, SpanNode } from '../../../shared/types.js';

interface TraceWaterfallViewProps {
  trace: TraceDetail | null;
  loading: boolean;
}

const SERVICE_COLORS: Record<string, string> = {
  'api-gateway': '#0284c7',
  'auth-service': '#8b5cf6',
  'inventory-service': '#10b981',
  'payment-service': '#f59e0b',
  'notification-worker': '#ec4899',
  'search-service': '#06b6d4',
  'recommendation-engine': '#a855f7',
  'postgres-db': '#3b82f6',
  'redis-cache': '#ef4444',
};

function getServiceColor(name: string): string {
  return SERVICE_COLORS[name] || '#64748b';
}

export const TraceWaterfallView: React.FC<TraceWaterfallViewProps> = ({ trace, loading }) => {
  const [expandedSpanId, setExpandedSpanId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="waterfall-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading trace waterfall details...</p>
      </div>
    );
  }

  if (!trace) {
    return (
      <div className="waterfall-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Select a trace from the left panel to inspect the execution waterfall.</p>
      </div>
    );
  }

  const { summary, rootSpan } = trace;
  const totalDuration = summary.durationMs;

  // Flatten the tree for linear Gantt rendering
  const flattenedSpans: SpanNode[] = [];
  function collect(node: SpanNode) {
    flattenedSpans.push(node);
    for (const child of node.children) {
      collect(child);
    }
  }
  collect(rootSpan);

  const toggleSpan = (id: string) => {
    setExpandedSpanId(expandedSpanId === id ? null : id);
  };

  return (
    <div className="waterfall-panel">
      {/* Header */}
      <div className="waterfall-header">
        <div className="waterfall-summary-row">
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>{summary.rootSpanName}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.3rem' }}>
              <span className={`badge-status ${summary.hasError ? 'badge-error' : 'badge-ok'}`}>
                {summary.hasError ? 'ERROR' : 'OK'}
              </span>
              <span className="trace-id-badge" title="W3C Trace ID">
                trace:{summary.id}
              </span>
            </div>
          </div>

          <div className="waterfall-metrics-chips">
            <div className="metric-chip">
              <span>Duration:</span>
              <strong style={{ color: summary.durationMs > 500 ? 'var(--color-amber)' : 'var(--color-cyan)' }}>
                {summary.durationMs} ms
              </strong>
            </div>
            <div className="metric-chip">
              <span>Spans:</span>
              <strong>{summary.spanCount}</strong>
            </div>
            <div className="metric-chip">
              <span>Services:</span>
              <strong>{summary.services.length}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline Ruler */}
      <div className="timeline-ruler">
        <span>0 ms</span>
        <span>{(totalDuration * 0.25).toFixed(1)} ms</span>
        <span>{(totalDuration * 0.5).toFixed(1)} ms</span>
        <span>{(totalDuration * 0.75).toFixed(1)} ms</span>
        <span>{totalDuration.toFixed(1)} ms</span>
      </div>

      {/* Spans Gantt list */}
      <div className="spans-container">
        {flattenedSpans.map((span) => {
          const serviceColor = getServiceColor(span.serviceName);
          const isExpanded = expandedSpanId === span.id;
          const leftPercent = Math.min(99, Math.max(0, (span.offsetMs / totalDuration) * 100));
          const widthPercent = Math.min(
            100 - leftPercent,
            Math.max(1.5, (span.durationMs / totalDuration) * 100)
          );

          return (
            <div key={span.id} className="span-row">
              <div className="span-row-main" onClick={() => toggleSpan(span.id)}>
                {/* Span Tree & Service Info */}
                <div className="span-info-col">
                  <div
                    className="span-depth-spacer"
                    style={{ width: `${span.depth * 18}px` }}
                  />
                  {span.depth > 0 && <span className="span-tree-guide">└─</span>}
                  <span
                    className="span-service-tag"
                    style={{
                      background: `${serviceColor}22`,
                      color: serviceColor,
                      border: `1px solid ${serviceColor}55`,
                    }}
                  >
                    {span.serviceName}
                  </span>
                  <span className="span-name-text" title={span.name}>
                    {span.name}
                  </span>
                  {span.isBottleneck && (
                    <span className="bottleneck-flame" title="Identified critical path bottleneck">
                      🔥 BOTTLENECK ({span.durationPercent.toFixed(0)}%)
                    </span>
                  )}
                </div>

                {/* Horizontal Gantt Bar */}
                <div className="span-bar-container">
                  <div
                    className="span-bar"
                    style={{
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      backgroundColor: span.statusCode === 'ERROR' ? 'var(--color-crimson)' : serviceColor,
                    }}
                  >
                    {span.durationMs}ms
                  </div>
                </div>
              </div>

              {/* Span Detail Drawer (Expanded) */}
              {isExpanded && (
                <div className="span-drawer">
                  <div className="drawer-grid">
                    <div className="drawer-item">
                      <span className="drawer-label">Span ID</span>
                      <span className="drawer-val">{span.id}</span>
                    </div>
                    <div className="drawer-item">
                      <span className="drawer-label">Parent Span ID</span>
                      <span className="drawer-val">{span.parentSpanId || '(Root)'}</span>
                    </div>
                    <div className="drawer-item">
                      <span className="drawer-label">Span Kind</span>
                      <span className="drawer-val">{span.kind}</span>
                    </div>
                    <div className="drawer-item">
                      <span className="drawer-label">Status</span>
                      <span
                        className="drawer-val"
                        style={{ color: span.statusCode === 'ERROR' ? 'var(--color-crimson)' : 'var(--color-emerald)' }}
                      >
                        {span.statusCode} {span.statusMessage ? `— ${span.statusMessage}` : ''}
                      </span>
                    </div>
                    <div className="drawer-item">
                      <span className="drawer-label">Relative Offset</span>
                      <span className="drawer-val">+{span.offsetMs} ms</span>
                    </div>
                    <div className="drawer-item">
                      <span className="drawer-label">Duration</span>
                      <span className="drawer-val">
                        {span.durationMs} ms ({span.durationPercent.toFixed(1)}% of trace)
                      </span>
                    </div>
                  </div>

                  {/* Attributes Table */}
                  {Object.keys(span.attributes).length > 0 && (
                    <div>
                      <span className="drawer-label">Span Attributes (OpenTelemetry)</span>
                      <table className="attributes-table">
                        <thead>
                          <tr>
                            <th>Key</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(span.attributes).map(([k, v]) => (
                            <tr key={k}>
                              <td style={{ color: 'var(--color-cyan)' }}>{k}</td>
                              <td>{String(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Events */}
                  {span.events && span.events.length > 0 && (
                    <div>
                      <span className="drawer-label">Span Events</span>
                      <ul style={{ paddingLeft: '1.2rem', marginTop: '0.25rem' }}>
                        {span.events.map((ev, i) => (
                          <li key={i} style={{ color: 'var(--color-amber)', fontFamily: 'var(--font-mono)' }}>
                            {ev.name} ({new Date(ev.timestampMs).toLocaleTimeString()})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
