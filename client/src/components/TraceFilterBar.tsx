import React from 'react';

interface TraceFilterBarProps {
  services: string[];
  selectedService: string;
  onSelectService: (service: string) => void;
  minDuration: string;
  onMinDurationChange: (val: string) => void;
  errorsOnly: boolean;
  onToggleErrorsOnly: (val: boolean) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
}

export const TraceFilterBar: React.FC<TraceFilterBarProps> = ({
  services,
  selectedService,
  onSelectService,
  minDuration,
  onMinDurationChange,
  errorsOnly,
  onToggleErrorsOnly,
  searchQuery,
  onSearchChange,
  onRefresh,
}) => {
  return (
    <div className="filter-bar">
      <div className="filter-group">
        <label className="filter-label">Filter Service:</label>
        <select
          className="filter-select"
          value={selectedService}
          onChange={(e) => onSelectService(e.target.value)}
        >
          <option value="">All Services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Min Latency:</label>
        <select
          className="filter-select"
          value={minDuration}
          onChange={(e) => onMinDurationChange(e.target.value)}
        >
          <option value="">Any Duration</option>
          <option value="50">&gt; 50 ms</option>
          <option value="150">&gt; 150 ms</option>
          <option value="500">&gt; 500 ms (Slow)</option>
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-checkbox-label">
          <input
            type="checkbox"
            checked={errorsOnly}
            onChange={(e) => onToggleErrorsOnly(e.target.checked)}
          />
          <span>Errors Only (HTTP 4xx/5xx)</span>
        </label>
      </div>

      <div className="filter-group" style={{ flex: 1, minWidth: '200px' }}>
        <input
          type="text"
          className="filter-input"
          placeholder="Search by Trace ID or Root Endpoint..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      <button className="btn btn-secondary" onClick={onRefresh} title="Reload traces">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
        Refresh
      </button>
    </div>
  );
};
