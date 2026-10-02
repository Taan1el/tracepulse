import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const resetDemoData = vi.fn();

vi.mock('../services/index.js', () => ({
  isDemoMode: true,
  resetDemoData: () => resetDemoData(),
}));

import { DemoBanner } from '../components/DemoBanner.js';

describe('DemoBanner in demo mode', () => {
  beforeEach(() => resetDemoData.mockClear());

  it('says the demo runs in the browser and links to the source', () => {
    render(<DemoBanner onReset={() => undefined} />);
    expect(screen.getByText('Demo: everything runs in your browser with sample data.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Source on GitHub' })).toHaveAttribute('href', 'https://github.com/Taan1el/tracepulse');
  });

  it('resets after confirmation only', async () => {
    const onReset = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    const user = userEvent.setup();
    render(<DemoBanner onReset={onReset} />);

    confirm.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(resetDemoData).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Reset sample data' }));
    expect(resetDemoData).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
