type Listener = () => void;

const listeners = new Set<Listener>();
let waiting: ServiceWorker | null = null;
let reloading = false;

/** A waiting worker is worth announcing only when an older one controls the page; the first install is not an update. */
export function needsUpdateNotice(state: ServiceWorkerState, hasController: boolean): boolean {
  return state === 'installed' && hasController;
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function updateReady(): boolean { return waiting !== null; }

function setWaiting(worker: ServiceWorker | null): void {
  if (waiting === worker) return;
  waiting = worker;
  listeners.forEach((listener) => listener());
}

/** Raises the update notice when a new worker finishes installing next to the one in control. */
export function watchForUpdates(registration: ServiceWorkerRegistration, container: ServiceWorkerContainer = navigator.serviceWorker): void {
  const check = (worker: ServiceWorker | null) => {
    if (worker && needsUpdateNotice(worker.state, Boolean(container.controller))) setWaiting(worker);
  };
  check(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    worker?.addEventListener('statechange', () => check(worker));
  });
}

/** Asks the waiting worker to take over, then reloads once when it does. Never reloads without this call. */
export function applyUpdate(container: ServiceWorkerContainer = navigator.serviceWorker, reload: () => void = () => window.location.reload()): void {
  const worker = waiting;
  if (!worker || reloading) return;
  container.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    reload();
  }, { once: true });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

/** Test helper: forgets the waiting worker and the reload guard. */
export function resetUpdateState(): void {
  waiting = null;
  reloading = false;
  listeners.forEach((listener) => listener());
}

export function registerOffline(): void {
  if (import.meta.env.MODE !== 'pages' || !('serviceWorker' in navigator)) return;

  const register = () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
    }).then((registration) => watchForUpdates(registration)).catch((error: unknown) => {
      console.error('Offline storage could not start.', error);
    });
  };

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}
