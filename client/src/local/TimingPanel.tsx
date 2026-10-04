import type { TraceDetail } from '../../../shared/types.js';
import { analyzeTrace } from './traceAnalysis.js';
import { useMemo } from 'react';

export function TraceAnalysis({ trace }: { trace: TraceDetail | null }) {
  const analysis = useMemo(() => trace ? analyzeTrace(trace) : null, [trace]);
  if (!trace || !trace.rawSpans.length || !analysis) return null;
  return <section className="trace-analysis" aria-label="Trace timing analysis">
    <h2 className="panel-heading">Slowest spans</h2>
    <p className="section-description">Up to 10 spans, ranked by duration across this trace.</p>
    <ol className="timing-list">{analysis.slowest.slice(0, 10).map((span) => <li key={span.id}>
      <span>{span.name} <span className="mono">{span.serviceName}</span></span>
      <span className="mono">{span.durationMs} ms</span>
    </li>)}</ol>
    <h2 className="panel-heading">Critical path estimate</h2>
    <p className="section-description">Heaviest parent chain using exclusive time, with overlapping child intervals counted once. This structural estimate cannot infer causality from concurrent spans.</p>
    <p className="mono wrap-text">{analysis.criticalPath.map((span) => span.name).join(' → ')} ({analysis.criticalDurationMs} ms)</p>
  </section>;
}
