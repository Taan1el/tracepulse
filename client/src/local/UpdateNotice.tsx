import { useSyncExternalStore } from 'react';
import { applyUpdate, subscribeUpdate, updateReady } from './offline.js';

/** Quiet notice shown once a new version is installed and waiting. The page reloads only when Reload is pressed. */
export function UpdateNotice() {
  const ready = useSyncExternalStore(subscribeUpdate, updateReady, () => false);
  return (
    <div role="status">
      {ready && <div className="demo-bar update-notice">
        <div className="demo-bar-inner">
          <span>A new version is ready.</span>
          <button type="button" className="btn btn-secondary" onClick={() => applyUpdate()}>Reload</button>
        </div>
      </div>}
    </div>
  );
}
