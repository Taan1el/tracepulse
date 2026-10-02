import React from 'react';
import type { ServiceMetric } from '../../../shared/types.js';

interface ServicesTableProps {
  metrics: ServiceMetric[];
}

export const HIGH_ERROR_RATE = 15;
export const SLOW_P95_MS = 500;

function health(m: ServiceMetric): { label: string; tone: 'ok' | 'warn' | 'bad' } {
  if (m.errorRate > HIGH_ERROR_RATE) return { label: 'High errors', tone: 'bad' };
  if (m.p95Ms > SLOW_P95_MS) return { label: 'Slow', tone: 'warn' };
  return { label: 'Healthy', tone: 'ok' };
}

export const ServicesTable: React.FC<ServicesTableProps> = ({ metrics }) => {
  if (metrics.length === 0) {
    return <div className="result-empty">No spans yet, so there are no service numbers to show.</div>;
  }

  return (
    <div>
      <div className="table-wrapper">
        <table className="data-table">
          <caption className="sr-only">Latency and errors per service</caption>
          <thead>
            <tr>
              <th scope="col">Service</th>
              <th scope="col">Spans</th>
              <th scope="col">Errors</th>
              <th scope="col">Average</th>
              <th scope="col">P50</th>
              <th scope="col">P90</th>
              <th scope="col">P95</th>
              <th scope="col">P99</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => {
              const h = health(m);
              return (
                <tr key={m.serviceName}>
                  <th scope="row" className="mono service-cell">{m.serviceName}</th>
                  <td className="num-cell">{m.requestCount}</td>
                  <td className="num-cell">{`${m.errorCount} (${m.errorRate}%)`}</td>
                  <td className="num-cell">{`${m.avgDurationMs} ms`}</td>
                  <td className="num-cell">{`${m.p50Ms} ms`}</td>
                  <td className="num-cell">{`${m.p90Ms} ms`}</td>
                  <td className="num-cell">{`${m.p95Ms} ms`}</td>
                  <td className="num-cell">{`${m.p99Ms} ms`}</td>
                  <td>
                    <span className="status">
                      <span className={`status-dot ${h.tone}`} aria-hidden="true" />
                      {h.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="table-note">
        {`Percentiles are computed over every stored span of the service. High errors means an error rate above ${HIGH_ERROR_RATE}%; Slow means a P95 above ${SLOW_P95_MS} ms.`}
      </p>
    </div>
  );
};
