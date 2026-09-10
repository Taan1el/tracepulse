import React from 'react';
import type { ServiceTopology } from '../../../shared/types.js';

interface ServiceTopologyGraphProps {
  topology: ServiceTopology | null;
  loading: boolean;
}

// Fixed or computed coordinates for known microservices
const NODE_COORDINATES: Record<string, { x: number; y: number }> = {
  'api-gateway': { x: 120, y: 220 },
  'auth-service': { x: 380, y: 110 },
  'inventory-service': { x: 380, y: 220 },
  'payment-service': { x: 380, y: 330 },
  'search-service': { x: 380, y: 440 },
  'notification-worker': { x: 680, y: 70 },
  'postgres-db': { x: 680, y: 180 },
  'redis-cache': { x: 680, y: 290 },
  'recommendation-engine': { x: 680, y: 440 },
};

export const ServiceTopologyGraph: React.FC<ServiceTopologyGraphProps> = ({
  topology,
  loading,
}) => {
  if (loading && !topology) {
    return (
      <div className="waterfall-panel" style={{ padding: '3rem', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Deriving service dependency graph...</p>
      </div>
    );
  }

  const nodes = topology?.nodes || [];
  const edges = topology?.edges || [];

  return (
    <div className="waterfall-panel">
      <div className="panel-header">
        <div className="panel-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          Distributed Service Dependency Topology Graph (DAG)
        </div>
      </div>

      <div style={{ padding: '1.5rem', background: '#090e1a', overflowX: 'auto' }}>
        <svg
          viewBox="0 0 860 520"
          style={{ width: '100%', minWidth: '700px', height: 'auto', display: 'block' }}
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="16"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#38bdf8" />
            </marker>
            <linearGradient id="edgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.9" />
            </linearGradient>
          </defs>

          {/* Grid Background Pattern */}
          <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="rgba(30, 45, 77, 0.3)" strokeWidth="0.5" />
          </pattern>
          <rect width="860" height="520" fill="url(#grid)" />

          {/* Render Edges */}
          {edges.map((edge) => {
            const src = NODE_COORDINATES[edge.source] || { x: 100, y: 100 };
            const tgt = NODE_COORDINATES[edge.target] || { x: 500, y: 300 };

            const midX = (src.x + tgt.x) / 2;
            const midY = (src.y + tgt.y) / 2;

            const hasError = edge.errorCount > 0;

            return (
              <g key={edge.id}>
                <line
                  x1={src.x}
                  y1={src.y}
                  x2={tgt.x}
                  y2={tgt.y}
                  stroke={hasError ? '#ef4444' : 'url(#edgeGrad)'}
                  strokeWidth={Math.min(4, Math.max(1.5, Math.log2(edge.callCount + 1)))}
                  markerEnd="url(#arrow)"
                  strokeDasharray={hasError ? '4,4' : undefined}
                />
                {/* Edge Call Badge */}
                <rect
                  x={midX - 34}
                  y={midY - 11}
                  width="68"
                  height="22"
                  rx="4"
                  fill="#0c1322"
                  stroke={hasError ? '#ef4444' : '#1e2d4d'}
                  strokeWidth="1"
                />
                <text
                  x={midX}
                  y={midY + 4}
                  fill={hasError ? '#f87171' : '#94a3b8'}
                  fontSize="10"
                  fontFamily="JetBrains Mono"
                  textAnchor="middle"
                  fontWeight="600"
                >
                  {edge.avgDurationMs}ms ({edge.callCount})
                </text>
              </g>
            );
          })}

          {/* Render Nodes */}
          {nodes.map((node, index) => {
            const coords = NODE_COORDINATES[node.id] || {
              x: 100 + (index % 3) * 260,
              y: 80 + Math.floor(index / 3) * 120,
            };

            const isHighError = node.errorRate > 15;
            const nodeColor = isHighError ? '#ef4444' : '#38bdf8';

            return (
              <g key={node.id} transform={`translate(${coords.x}, ${coords.y})`}>
                <circle
                  r="24"
                  fill="#121a2f"
                  stroke={nodeColor}
                  strokeWidth="2.5"
                  filter="drop-shadow(0 4px 10px rgba(0,0,0,0.5))"
                />
                <text
                  y="4"
                  textAnchor="middle"
                  fill="white"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="JetBrains Mono"
                >
                  {node.callCount}
                </text>

                {/* Node Label Card */}
                <rect
                  x="-75"
                  y="30"
                  width="150"
                  height="34"
                  rx="6"
                  fill="#0f172a"
                  stroke="#1e293b"
                  strokeWidth="1"
                />
                <text
                  x="0"
                  y="45"
                  textAnchor="middle"
                  fill="#f1f5f9"
                  fontSize="11"
                  fontWeight="700"
                  fontFamily="Plus Jakarta Sans"
                >
                  {node.name}
                </text>
                <text
                  x="0"
                  y="58"
                  textAnchor="middle"
                  fill={isHighError ? '#ef4444' : '#10b981'}
                  fontSize="9"
                  fontFamily="JetBrains Mono"
                >
                  {node.avgDurationMs}ms • {node.errorRate}% err
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};
