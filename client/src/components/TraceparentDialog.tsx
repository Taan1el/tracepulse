import React, { useState } from 'react';
import { generateW3CContext, parseTraceparentHeader, type TraceparentResult } from '../services/index.js';
import { Modal } from './Modal.js';

interface TraceparentDialogProps {
  onClose: () => void;
}

const SAMPLE_HEADER = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

export const TraceparentDialog: React.FC<TraceparentDialogProps> = ({ onClose }) => {
  const [header, setHeader] = useState(SAMPLE_HEADER);
  const [result, setResult] = useState<TraceparentResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parse = async (value: string) => {
    try {
      setError(null);
      setResult(await parseTraceparentHeader(value));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parsing failed');
      setResult(null);
    }
  };

  const generate = async () => {
    try {
      const context = await generateW3CContext();
      setHeader(context.traceparent);
      // Parse the new value directly: state set above is not visible to this call yet.
      await parse(context.traceparent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate a context');
    }
  };

  return (
    <Modal
      title="Inspect a traceparent header"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={generate}>
            Generate new context
          </button>
          <span className="footer-spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={() => parse(header)}>
            Parse header
          </button>
        </>
      }
    >
      <p className="modal-lead">
        The W3C <code>traceparent</code> header carries the trace across service boundaries. Paste one to split it into
        its fields and get the header a downstream call would send.
      </p>

      <div className="field">
        <label className="field-label" htmlFor="traceparent-input">Header value</label>
        <input
          id="traceparent-input"
          type="text"
          className="mono"
          spellCheck={false}
          value={header}
          onChange={(e) => setHeader(e.target.value)}
        />
      </div>

      {error && <p className="form-message is-bad" role="alert">{error}</p>}

      {result && (
        <dl className="facts result-facts">
          <div className="fact">
            <dt>Version</dt>
            <dd className="mono">{result.parsed.version}</dd>
          </div>
          <div className="fact">
            <dt>Sampling flag</dt>
            <dd className="mono">{result.parsed.traceFlags === '01' ? '01 (sampled)' : `${result.parsed.traceFlags} (not sampled)`}</dd>
          </div>
          <div className="fact fact-wide">
            <dt>Trace ID</dt>
            <dd className="mono id-text">{result.parsed.traceId}</dd>
          </div>
          <div className="fact fact-wide">
            <dt>Parent span ID</dt>
            <dd className="mono id-text">{result.parsed.parentSpanId}</dd>
          </div>
          <div className="fact fact-wide">
            <dt>{`Header for the next call (new span ID ${result.childSpanId})`}</dt>
            <dd className="mono id-text">{result.propagatedHeader}</dd>
          </div>
        </dl>
      )}
    </Modal>
  );
};
