import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StoreCombobox } from './StoreCombobox';
import { api } from '../../api/client';

vi.mock('../../api/client', () => ({
  api: {
    firefly: {
      searchExpenseAccounts: vi.fn(),
      getExpenseAccount: vi.fn(),
    },
  },
}));

describe('StoreCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input with placeholder and initial value hint', () => {
    render(
      <StoreCombobox
        value={101}
        accountNameHint="Conad Superstore"
        onChange={vi.fn()}
      />
    );

    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('Conad Superstore');
  });

  it('resolves account name asynchronously when hint is omitted', async () => {
    (api.firefly.getExpenseAccount as any).mockResolvedValue({
      id: 102,
      name: 'Coop Italia',
      active: true,
    });

    render(<StoreCombobox value={102} onChange={vi.fn()} />);

    await waitFor(() => {
      const input = screen.getByRole('combobox') as HTMLInputElement;
      expect(input.value).toBe('Coop Italia');
    });
  });

  it('debounces search requests and renders matching results', async () => {
    (api.firefly.searchExpenseAccounts as any).mockResolvedValue([
      { id: 101, name: 'Conad Via Roma' },
      { id: 102, name: 'Conad City' },
    ]);

    render(<StoreCombobox value={null} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Conad' } });

    // Should not call immediately before debounce time (150ms)
    expect(api.firefly.searchExpenseAccounts).not.toHaveBeenCalled();

    await waitFor(
      () => {
        expect(api.firefly.searchExpenseAccounts).toHaveBeenCalledWith(
          'Conad',
          10,
          expect.any(AbortSignal)
        );
      },
      { timeout: 500 }
    );

    await waitFor(() => {
      expect(screen.getByText('Conad Via Roma')).toBeTruthy();
      expect(screen.getByText('Conad City')).toBeTruthy();
    });
  });

  it('selects option on click and invokes onChange with id and name', async () => {
    (api.firefly.searchExpenseAccounts as any).mockResolvedValue([
      { id: 101, name: 'Conad Via Roma' },
    ]);

    const handleChange = vi.fn();
    render(<StoreCombobox value={null} onChange={handleChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Conad' } });

    await waitFor(() => {
      expect(screen.getByText('Conad Via Roma')).toBeTruthy();
    });

    const option = screen.getByRole('option');
    fireEvent.mouseDown(option);

    expect(handleChange).toHaveBeenCalledWith(101, 'Conad Via Roma');
    expect((input as HTMLInputElement).value).toBe('Conad Via Roma');
  });

  it('clears selection when clear button is clicked', () => {
    const handleChange = vi.fn();
    render(
      <StoreCombobox
        value={101}
        accountNameHint="Conad Via Roma"
        onChange={handleChange}
      />
    );

    const clearButton = screen.getByLabelText('Clear selection');
    fireEvent.click(clearButton);

    expect(handleChange).toHaveBeenCalledWith(null, '');
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('supports keyboard navigation with Arrow keys and Enter', async () => {
    (api.firefly.searchExpenseAccounts as any).mockResolvedValue([
      { id: 101, name: 'First Store' },
      { id: 102, name: 'Second Store' },
    ]);

    const handleChange = vi.fn();
    render(<StoreCombobox value={null} onChange={handleChange} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Store' } });

    await waitFor(() => {
      expect(screen.getByText('First Store')).toBeTruthy();
    });

    // ArrowDown to move to second item
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Enter to select active item
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleChange).toHaveBeenCalledWith(102, 'Second Store');
  });

  it('reverts unselected text on blur/escape', async () => {
    render(
      <StoreCombobox
        value={101}
        accountNameHint="Original Store"
        onChange={vi.fn()}
      />
    );

    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Unfinished query' } });
    expect(input.value).toBe('Unfinished query');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Original Store');
  });

  it('renders empty state when no accounts match query', async () => {
    (api.firefly.searchExpenseAccounts as any).mockResolvedValue([]);

    render(<StoreCombobox value={null} onChange={vi.fn()} />);

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'UnknownPlace' } });

    await waitFor(() => {
      expect(screen.getByText('No matching stores found in Firefly III.')).toBeTruthy();
    });
  });
});
