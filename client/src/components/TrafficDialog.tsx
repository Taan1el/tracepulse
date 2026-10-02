import React, { useState } from 'react';
import { simulateTraffic } from '../services/index.js';
import { Modal } from './Modal.js';

interface TrafficDialogProps {
  onClose: () => void;
  onGenerated: () => void;
}

type Flow = 'checkout' | 'auth' | 'search';

const FLOWS: Array<{ id: Flow; label: string; note: string }> = [
  { id: 'checkout', label: 'Checkout', note: 'gateway, auth, inventory, payment, notification' },
  { id: 'auth', label: 'Sign in', note: 'gateway, cache and database lookup' },
  { id: 'search', label: 'Search and rank', note: 'gateway, search and ranking' },
];

export const TrafficDialog: React.FC<TrafficDialogProps> = ({ onClose, onGenerated }) => {
  const [flow, setFlow] = useState<Flow>('checkout');
  const [failing, setFailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);

  const run = async (payload: Parameters<typeof simulateTraffic>[0], success: string) => {
    try {
      setBusy(true);
      setMessage(null);
      await simulateTraffic(payload);
      setMessage({ text: success, isError: false });
      onGenerated();
    } catch (err) {
      setMessage({ text: `Error: ${err instanceof Error ? err.message : 'Simulation failed'}`, isError: true });
    } finally {
      setBusy(false);
    }
  };

  const label = FLOWS.find((f) => f.id === flow)!.label.toLowerCase();

  return (
    <Modal
      title="Generate traffic"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => run({ flowType: 'batch', batchCount: 10 }, 'Generated 10 traces.')}
          >
            Generate 10 mixed traces
          </button>
          <span className="footer-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              run({ flowType: flow, injectAnomaly: failing }, `Generated one ${label} trace${failing ? ' with a failure' : ''}.`)
            }
          >
            {busy ? 'Generating' : 'Generate trace'}
          </button>
        </>
      }
    >
      <p className="modal-lead">
        Adds sample traces so you can look at waterfalls and service numbers without instrumenting anything.
      </p>

      <fieldset className="radio-set">
        <legend className="field-label">Flow</legend>
        {FLOWS.map((f) => (
          <div key={f.id} className={`choice ${flow === f.id ? 'is-selected' : ''}`}>
            <input
              id={`flow-${f.id}`}
              type="radio"
              name="flow"
              checked={flow === f.id}
              onChange={() => setFlow(f.id)}
            />
            <label htmlFor={`flow-${f.id}`}>
              <strong>{f.label}</strong>
              <span>{f.note}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <div className="checkbox-field">
        <input id="inject-failure" type="checkbox" checked={failing} onChange={(e) => setFailing(e.target.checked)} />
        <label htmlFor="inject-failure">Make this trace fail (timeout or slow dependency)</label>
      </div>

      <output className={`form-message ${message?.isError ? 'is-bad' : ''}`}>{message?.text}</output>
    </Modal>
  );
};
