import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyUpdate, needsUpdateNotice, resetUpdateState, updateReady, watchForUpdates } from '../local/offline.js';
import { UpdateNotice } from '../local/UpdateNotice.js';
import { axe } from './axe.js';

class FakeWorker extends EventTarget {
  postMessage = vi.fn();
  constructor(public state: ServiceWorkerState) { super(); }
  become(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}
class FakeContainer extends EventTarget {
  controller: object | null = {};
}
const asRegistration = (value: FakeRegistration) => value as unknown as ServiceWorkerRegistration;
const asContainer = (value: FakeContainer) => value as unknown as ServiceWorkerContainer;

beforeEach(() => resetUpdateState());
afterEach(() => cleanup());

describe('update state', () => {
  it('announces a waiting worker only when an older one controls the page', () => {
    expect(needsUpdateNotice('installed', true)).toBe(true);
    expect(needsUpdateNotice('installed', false)).toBe(false);
    expect(needsUpdateNotice('installing', true)).toBe(false);
    expect(needsUpdateNotice('activated', true)).toBe(false);
  });

  it('raises the notice for a worker already waiting and for one that finishes installing later', () => {
    const container = new FakeContainer();
    const registration = new FakeRegistration();
    registration.waiting = new FakeWorker('installed');
    watchForUpdates(asRegistration(registration), asContainer(container));
    expect(updateReady()).toBe(true);

    resetUpdateState();
    const next = new FakeRegistration();
    watchForUpdates(asRegistration(next), asContainer(container));
    expect(updateReady()).toBe(false);
    next.installing = new FakeWorker('installing');
    next.dispatchEvent(new Event('updatefound'));
    next.installing.become('installed');
    expect(updateReady()).toBe(true);
  });

  it('stays quiet on the first install, when no worker controls the page yet', () => {
    const container = new FakeContainer();
    container.controller = null;
    const registration = new FakeRegistration();
    watchForUpdates(asRegistration(registration), asContainer(container));
    registration.installing = new FakeWorker('installing');
    registration.dispatchEvent(new Event('updatefound'));
    registration.installing.become('installed');
    expect(updateReady()).toBe(false);
  });

  it('tells the waiting worker to activate and reloads once when control changes, never before', () => {
    const container = new FakeContainer();
    const registration = new FakeRegistration();
    const worker = new FakeWorker('installed');
    registration.waiting = worker;
    watchForUpdates(asRegistration(registration), asContainer(container));
    const reload = vi.fn();

    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    applyUpdate(asContainer(container), reload);
    applyUpdate(asContainer(container), reload);
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('update notice', () => {
  it('shows nothing until a new version waits, then offers Reload without reloading by itself', async () => {
    const user = userEvent.setup();
    const container = new FakeContainer();
    const registration = new FakeRegistration();
    const { container: view } = render(<UpdateNotice />);
    expect(screen.queryByText('A new version is ready.')).not.toBeInTheDocument();

    const worker = new FakeWorker('installed');
    registration.waiting = worker;
    act(() => watchForUpdates(asRegistration(registration), asContainer(container)));
    expect(screen.getByRole('status')).toHaveTextContent('A new version is ready.');
    expect(await axe(view)).toHaveNoViolations();
    expect(worker.postMessage).not.toHaveBeenCalled();

    Object.defineProperty(navigator, 'serviceWorker', { value: container, configurable: true });
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
