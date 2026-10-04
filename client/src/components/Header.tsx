import React from 'react';
import { Play, ScanLine } from 'lucide-react';

interface HeaderProps {
  onOpenTraffic: () => void;
  onOpenTraceparent: () => void;
  workspace?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onOpenTraffic, onOpenTraceparent, workspace = false }) => (
  <header className="app-header">
    <div className="header-inner">
      <div className="brand">
        <h1 className="brand-name">TracePulse</h1>
        <p className="brand-subtitle">Read a trace as a waterfall, then check latency per service.</p>
      </div>

      <div className="header-actions">
        <button type="button" className="btn btn-secondary" onClick={onOpenTraceparent}>
          <ScanLine size={16} strokeWidth={1.75} aria-hidden="true" />
          Inspect traceparent
        </button>
        <button type="button" className="btn btn-primary" onClick={onOpenTraffic} disabled={workspace} title={workspace ? 'Generate sample traces in Sample data mode' : undefined}>
          <Play size={16} strokeWidth={1.75} aria-hidden="true" />
          Generate traffic
        </button>
      </div>
    </div>
  </header>
);
