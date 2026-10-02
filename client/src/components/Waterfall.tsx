import React, { useState } from 'react';
import type { SpanNode, TraceDetail } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

interface WaterfallProps {
  trace: TraceDetail | null;
  loading: boolean;
}

function flatten(root: SpanNode): SpanNode[] {
  const out: SpanNode[] = [];
  const visit = (node: SpanNode) => {
    out.push(node);
    node.children.forEach(visit);
  };
  visit(root);
  return out;
}

const TICKS = [0, 0.25, 0.5, 0.75, 1];

export const Waterfall: React.FC<WaterfallProps> = ({ trace, loading }) => {
  const [openSpanId, setOpenSpanId] = useState<string | null>(null);

  if (!trace) {
    return (
      <div className="result-empty">
        {loading ? 'Loading trace.' : 'Select a trace to see its spans.'}
      </div>
    );
  }

  const { summary, rootSpan } = trace;
  const total = summary.durationMs;
  const spans = flatten(rootSpan);
  const slowestChild = spans.find((s) => s.isBottleneck && s.depth > 0);

  return (
    <section className="waterfall" aria-labelledby="waterfall-title" aria-busy={loading}>
      <div className="waterfall-head">
        <div className="waterfall-title-row">
          <h2 id="waterfall-title" className="panel-heading">{summary.rootSpanName}</h2>
          <span className="status">
            <span className={`status-dot ${summary.hasError ? 'bad' : 'ok'}`} aria-hidden="true" />
            {summary.hasError ? 'Error' : 'OK'}
          </span>
        </div>
        <dl className="facts">
          <div className="fact fact-wide">
            <dt>Trace ID</dt>
            <dd className="mono id-text">{summary.id}</dd>
          </div>
          <div className="fact">
            <dt>Duration</dt>
            <dd className="mono">{`${summary.durationMs} ms`}</dd>
          </div>
          <div className="fact">
            <dt>Spans</dt>
            <dd className="mono">{summary.spanCount}</dd>
          </div>
          <div className="fact">
            <dt>Services</dt>
            <dd className="mono">{summary.services.length}</dd>
          </div>
        </dl>
      </div>

      <figure className="diagram">
        <figcaption className="diagram-caption">
          {`${formatCount(spans.length, 'span')} across ${formatCount(summary.services.length, 'service')}, ${total} ms end to end.`}
          {slowestChild
            ? ` Longest child span: ${slowestChild.name} in ${slowestChild.serviceName}, ${slowestChild.durationMs} ms (${slowestChild.durationPercent.toFixed(0)}% of the trace).`
            : ''}
        </figcaption>

        <div className="ruler" aria-hidden="true">
          <span className="ruler-gap" />
          <span className="ruler-track">
            {TICKS.map((t) => (
              <span key={t} className="ruler-tick mono" style={{ left: `${t * 100}%` }}>
                {(total * t).toFixed(t === 0 ? 0 : 1)}
              </span>
            ))}
          </span>
          <span className="ruler-unit mono">ms</span>
        </div>

        <ol className="span-list">
          {spans.map((span) => {
            const left = Math.min(99, Math.max(0, (span.offsetMs / total) * 100));
            const width = Math.min(100 - left, Math.max(0.8, (span.durationMs / total) * 100));
            const open = openSpanId === span.id;
            const failed = span.statusCode === 'ERROR';

            return (
              <li key={span.id} className="span-item">
                <button
                  type="button"
                  className="span-row"
                  aria-expanded={open}
                  onClick={() => setOpenSpanId(open ? null : span.id)}
                >
                  <span className="span-label" style={{ paddingLeft: `${Math.min(span.depth, 5) * 14}px` }}>
                    <span className="span-name">{span.name}</span>
                    <span className="span-service">{span.serviceName}</span>
                    {span.isBottleneck && span.depth > 0 && <span className="span-flag">longest child</span>}
                  </span>
                  <span className="span-track" aria-hidden="true">
                    <span
                      className={`span-bar ${failed ? 'is-failed' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </span>
                  <span className={`span-duration mono ${failed ? 'is-bad' : ''}`}>{`${span.durationMs} ms`}</span>
                </button>

                {open && (
                  <div className="span-detail">
                    <dl className="facts">
                      <div className="fact fact-wide">
                        <dt>Span ID</dt>
                        <dd className="mono id-text">{span.id}</dd>
                      </div>
                      <div className="fact fact-wide">
                        <dt>Parent span ID</dt>
                        <dd className="mono id-text">{span.parentSpanId || 'none (root)'}</dd>
                      </div>
                      <div className="fact">
                        <dt>Kind</dt>
                        <dd className="mono">{span.kind}</dd>
                      </div>
                      <div className="fact fact-wide">
                        <dt>Status</dt>
                        <dd className={`mono ${failed ? 'is-bad' : ''}`}>
                          {span.statusMessage ? `${span.statusCode}: ${span.statusMessage}` : span.statusCode}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>Starts at</dt>
                        <dd className="mono">{`+${span.offsetMs} ms`}</dd>
                      </div>
                      <div className="fact">
                        <dt>Share of trace</dt>
                        <dd className="mono">{`${span.durationPercent.toFixed(1)}%`}</dd>
                      </div>
                    </dl>

                    {Object.keys(span.attributes).length > 0 && (
                      <table className="data-table attr-table">
                        <caption className="attr-caption">Attributes</caption>
                        <thead>
                          <tr>
                            <th scope="col">Key</th>
                            <th scope="col">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(span.attributes).map(([key, value]) => (
                            <tr key={key}>
                              <td className="mono wrap-text">{key}</td>
                              <td className="mono wrap-text">{String(value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {span.events && span.events.length > 0 && (
                      <div>
                        <h3 className="attr-caption">Events</h3>
                        <ul className="event-list">
                          {span.events.map((event, i) => (
                            <li key={i} className="mono">
                              {`${event.name} at +${Math.max(0, Math.round((event.timestampMs - summary.startTimeMs) * 100) / 100)} ms`}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </figure>
    </section>
  );
};
