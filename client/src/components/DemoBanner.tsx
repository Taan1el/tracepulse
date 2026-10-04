import React from 'react';
import { isDemoMode, resetDemoData } from '../services/index.js';

interface DemoBannerProps {
  onReset: () => void;
  mode?: 'sample' | 'workspace';
}

export const DemoBanner: React.FC<DemoBannerProps> = ({ onReset, mode = 'sample' }) => {
  if (!isDemoMode) return null;

  const handleReset = () => {
    if (window.confirm('Reset the traces back to the original sample data?')) {
      resetDemoData();
      onReset();
    }
  };

  return (
    <div className="demo-bar">
      <div className="demo-bar-inner">
        <span>{mode === 'sample' ? 'Demo: everything runs in your browser with sample data.' : 'Your workspace: recorded traces saved in this browser.'}</span>
        <span className="demo-bar-links">
          <button type="button" className="link-btn" onClick={handleReset}>
            Reset sample data
          </button>
          <a href="https://github.com/Taan1el/tracepulse" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </span>
      </div>
    </div>
  );
};
