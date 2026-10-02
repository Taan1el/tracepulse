import React from 'react';
import { Search } from 'lucide-react';

interface TraceFiltersProps {
  services: string[];
  selectedService: string;
  onSelectService: (service: string) => void;
  minDuration: string;
  onMinDurationChange: (val: string) => void;
  errorsOnly: boolean;
  onToggleErrorsOnly: (val: boolean) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export const TraceFilters: React.FC<TraceFiltersProps> = ({
  services,
  selectedService,
  onSelectService,
  minDuration,
  onMinDurationChange,
  errorsOnly,
  onToggleErrorsOnly,
  searchQuery,
  onSearchChange,
}) => (
  <div className="filter-panel" role="search" aria-label="Trace filters">
    <div className="field-pair">
    <div className="field">
      <label className="field-label" htmlFor="filter-service">Service</label>
      <select id="filter-service" value={selectedService} onChange={(e) => onSelectService(e.target.value)}>
        <option value="">All services</option>
        {services.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>

    <div className="field">
      <label className="field-label" htmlFor="filter-duration">Duration</label>
      <select id="filter-duration" value={minDuration} onChange={(e) => onMinDurationChange(e.target.value)}>
        <option value="">Any duration</option>
        <option value="50">50 ms or longer</option>
        <option value="150">150 ms or longer</option>
        <option value="500">500 ms or longer</option>
      </select>
    </div>
    </div>

    <div className="field field-grow">
      <label className="field-label" htmlFor="filter-search">Search loaded traces</label>
      <div className="search-field">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <input
          id="filter-search"
          type="text"
          placeholder="Trace ID, operation or service"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>

    <div className="checkbox-field">
      <input
        id="filter-errors"
        type="checkbox"
        checked={errorsOnly}
        onChange={(e) => onToggleErrorsOnly(e.target.checked)}
      />
      <label htmlFor="filter-errors">Only traces with an error span</label>
    </div>
  </div>
);
