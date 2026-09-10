import React, { useState } from 'react';
import { simulateTraffic } from '../services/api.js';

interface TrafficSimModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTrafficGenerated: () => void;
}

export const TrafficSimModal: React.FC<TrafficSimModalProps> = ({
  isOpen,
  onClose,
  onTrafficGenerated,
}) => {
  const [flowType, setFlowType] = useState<'checkout' | 'auth' | 'search'>('checkout');
  const [injectAnomaly, setInjectAnomaly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSimulateSingle = async () => {
    try {
      setLoading(true);
      setMessage(null);
      await simulateTraffic({ flowType, injectAnomaly });
      setMessage(`Successfully generated ${flowType.toUpperCase()} distributed trace!`);
      onTrafficGenerated();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleSimulateBatch = async () => {
    try {
      setLoading(true);
      setMessage(null);
      await simulateTraffic({ flowType: 'batch', batchCount: 10 });
      setMessage('Successfully generated batch of 10 multi-service traces!');
      onTrafficGenerated();
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Synthetic Microservice Traffic Simulator</h3>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Simulate realistic distributed trace transactions traversing API Gateways, Auth verification, SQL databases, Redis caching layers, and external payment APIs.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label className="drawer-label">Select Business Transaction Flow:</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <button
                className={`btn ${flowType === 'checkout' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFlowType('checkout')}
                style={{ justifyContent: 'center' }}
              >
                Checkout Flow
              </button>
              <button
                className={`btn ${flowType === 'auth' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFlowType('auth')}
                style={{ justifyContent: 'center' }}
              >
                Auth Login
              </button>
              <button
                className={`btn ${flowType === 'search' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setFlowType('search')}
                style={{ justifyContent: 'center' }}
              >
                Search & Rank
              </button>
            </div>
          </div>

          <div style={{ background: 'var(--bg-secondary)', padding: '0.9rem', borderRadius: '8px' }}>
            <label className="filter-checkbox-label" style={{ fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={injectAnomaly}
                onChange={(e) => setInjectAnomaly(e.target.checked)}
              />
              <span style={{ color: injectAnomaly ? 'var(--color-crimson)' : 'var(--text-primary)' }}>
                Inject Downstream Failure / Latency Spike (e.g. 504 Gateway Timeout or DB Lock)
              </span>
            </label>
          </div>

          {message && (
            <div
              style={{
                fontSize: '0.85rem',
                padding: '0.6rem 0.9rem',
                borderRadius: '6px',
                background: message.startsWith('Error') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: message.startsWith('Error') ? '#f87171' : '#34d399',
                border: `1px solid ${message.startsWith('Error') ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)'}`,
              }}
            >
              {message}
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-secondary" onClick={handleSimulateBatch} disabled={loading}>
            Generate 10 Synthetic Traces
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleSimulateSingle} disabled={loading}>
              {loading ? 'Dispatching...' : 'Dispatch Flow'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
