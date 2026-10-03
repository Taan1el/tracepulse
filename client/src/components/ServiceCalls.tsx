import React from 'react';
import type { ServiceTopology } from '../../../shared/types.js';
import { formatCount } from '../utils/pluralize.js';

interface ServiceCallsProps {
  topology: ServiceTopology | null;
}

export const ServiceCalls: React.FC<ServiceCallsProps> = ({ topology }) => {
  const edges = [...(topology?.edges ?? [])].sort((a, b) => b.callCount - a.callCount);
  const nodes = topology?.nodes ?? [];

  if (edges.length === 0) {
    return <div className="result-empty">No calls between services have been recorded yet.</div>;
  }

  const maxCalls = edges[0].callCount;
  const busiest = edges[0];
  const callers = new Set(edges.map((e) => e.source));
  const leaves = nodes.filter((n) => !callers.has(n.id)).map((n) => n.name);

  return (
    <div>
      <p className="diagram-caption">
        {`${formatCount(nodes.length, 'service')} and ${formatCount(edges.length, 'call path')}. Busiest path: ${busiest.source} to ${busiest.target}, ${formatCount(busiest.callCount, 'call')}.`}
      </p>
      <div className="table-wrapper" role="region" aria-label="Service calls table" tabIndex={0}>
        <table className="data-table">
          <caption className="sr-only">Calls from one service to another, most calls first</caption>
          <thead>
            <tr>
              <th scope="col">Caller</th>
              <th scope="col">Callee</th>
              <th scope="col">Calls</th>
              <th scope="col">Average</th>
              <th scope="col">Errors</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((edge) => (
              <tr key={edge.id}>
                <th scope="row" className="mono service-cell">{edge.source}</th>
                <td className="mono service-cell">{edge.target}</td>
                <td className="calls-cell">
                  <span className="meter" aria-hidden="true">
                    <span className="meter-fill" style={{ width: `${(edge.callCount / maxCalls) * 100}%` }} />
                  </span>
                  <span className="mono">{edge.callCount}</span>
                </td>
                <td className="num-cell">{`${edge.avgDurationMs} ms`}</td>
                <td className={`num-cell ${edge.errorCount > 0 ? 'is-bad' : ''}`}>{edge.errorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {leaves.length > 0 && (
        <p className="table-note">{`Services that call no one else: ${leaves.join(', ')}.`}</p>
      )}
    </div>
  );
};
