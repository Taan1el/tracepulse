import React, { useState } from 'react';
import { parseTraceparentHeader, generateW3CContext } from '../services/api.js';
import type { W3CTraceparent } from '../../../shared/types.js';

interface W3CModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const W3CModal: React.FC<W3CModalProps> = ({ isOpen, onClose }) => {
  const [headerInput, setHeaderInput] = useState('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01');
  const [parsed, setParsed] = useState<W3CTraceparent | null>(null);
  const [propagated, setPropagated] = useState<string | null>(null);
  const [newSpanId, setNewSpanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleParse = async () => {
    try {
      setError(null);
      const res = await parseTraceparentHeader(headerInput);
      setParsed(res.parsed);
      setPropagated(res.propagatedHeader);
      setNewSpanId(res.childSpanId);
    } catch (err: any) {
      setError(err.message || 'Parsing failed');
      setParsed(null);
    }
  };

  const handleGenerate = async () => {
    try {
      setError(null);
      const res = await generateW3CContext();
      setHeaderInput(res.traceparent);
      handleParse();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>W3C Trace Context Inspector & Propagator</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            The <code>traceparent</code> HTTP header standardizes distributed context propagation across microservice boundaries according to W3C specifications.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label className="drawer-label">Raw Traceparent Header:</label>
            <input
              type="text"
              className="filter-input"
              value={headerInput}
              onChange={(e) => setHeaderInput(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn btn-primary" onClick={handleParse}>
              Validate & Parse Header
            </button>
            <button className="btn btn-secondary" onClick={handleGenerate}>
              Generate Fresh Context
            </button>
          </div>

          {error && (
            <div style={{ color: 'var(--color-crimson)', fontSize: '0.85rem', fontWeight: 600 }}>
              &times; {error}
            </div>
          )}

          {parsed && (
            <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-cyan)' }}>Decoded W3C Context</h4>
              <div className="drawer-grid">
                <div className="drawer-item">
                  <span className="drawer-label">Version</span>
                  <span className="drawer-val">{parsed.version}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Trace ID (32 hex)</span>
                  <span className="drawer-val" style={{ color: 'var(--color-emerald)' }}>{parsed.traceId}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Parent Span ID (16 hex)</span>
                  <span className="drawer-val">{parsed.parentSpanId}</span>
                </div>
                <div className="drawer-item">
                  <span className="drawer-label">Flags (Sampling)</span>
                  <span className="drawer-val">{parsed.traceFlags === '01' ? '01 (Sampled)' : '00 (Unsampled)'}</span>
                </div>
              </div>

              {propagated && (
                <div style={{ marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  <span className="drawer-label">Downstream Propagated Header (Next Child Span ID: {newSpanId}):</span>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      background: 'var(--bg-card)',
                      padding: '0.5rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      marginTop: '0.25rem',
                      color: 'var(--color-cyan)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {propagated}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
