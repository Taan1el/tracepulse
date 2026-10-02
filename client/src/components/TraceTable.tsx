import React from 'react';
import type { TraceSummary } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

interface TraceTableProps {
  traces: TraceSummary[];
  selectedTraceId: string | null;
  onSelectTrace: (id: string) => void;
  loading: boolean;
}

export const SLOW_TRACE_MS = 500;

export const TraceTable: React.FC<TraceTableProps> = ({ traces, selectedTraceId, onSelectTrace, loading }) => {
  if (traces.length === 0) {
    return (
      <div className="result-empty">
        {loading ? 'Loading traces.' : 'No traces match the current filters.'}
      </div>
    );
  }

  return (
    <div className="table-wrapper table-scroll" role="region" aria-label="Trace list" tabIndex={0}>
      <table className="data-table trace-table">
        <caption className="sr-only">{`Traces, newest first (${formatCount(traces.length, 'trace')})`}</caption>
        <thead>
          <tr>
            <th scope="col">Operation</th>
            <th scope="col">Duration</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => {
            const selected = trace.id === selectedTraceId;
            return (
              <tr key={trace.id} className={selected ? 'is-selected' : undefined}>
                <td className="op-cell">
                  <button
                    type="button"
                    className="row-btn"
                    aria-pressed={selected}
                    onClick={() => onSelectTrace(trace.id)}
                  >
                    <span className="op-name">{trace.rootSpanName}</span>
                    <span className="op-meta">{`${trace.id.slice(0, 8)} · ${formatCount(trace.spanCount, 'span')}`}</span>
                  </button>
                </td>
                <td className={`num-cell ${trace.durationMs > SLOW_TRACE_MS ? 'is-warn' : ''}`}>
                  {`${trace.durationMs} ms`}
                </td>
                <td>
                  <span className="status">
                    <span className={`status-dot ${trace.hasError ? 'bad' : 'ok'}`} aria-hidden="true" />
                    {trace.hasError ? 'Error' : 'OK'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
