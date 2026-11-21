import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompanyCombobox } from './CompanyCombobox';
import { Company } from '../../types';

const mockCompanies: Company[] = [
  { id: 1, name: 'Conad', store_count: 5 },
  { id: 2, name: 'Coop', store_count: 3 },
  { id: 3, name: 'Lidl', store_count: 2 },
];

describe('CompanyCombobox', () => {
  it('renders with initial selected company', () => {
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={1}
        onChange={vi.fn()}
      />
    );

    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('Conad');
  });

  it('filters existing companies when typing in search input', () => {
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={null}
        onChange={vi.fn()}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'co' } });

    expect(screen.getByText('Conad')).toBeTruthy();
    expect(screen.getByText('Coop')).toBeTruthy();
    expect(screen.queryByText('Lidl')).toBeNull();
  });

  it('selects existing company on click', () => {
    const handleChange = vi.fn();
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={null}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    const coopOption = screen.getByText('Coop');
    fireEvent.mouseDown(coopOption);

    expect(handleChange).toHaveBeenCalledWith({
      companyId: 2,
      companyName: 'Coop',
      isNew: false,
    });
  });

  it('surfaces inline creation option when query does not match any company', () => {
    const handleChange = vi.fn();
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={null}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Esselunga' } });

    const createOption = screen.getByText(/Create new company/i);
    expect(createOption).toBeTruthy();
    expect(screen.getByText('Esselunga')).toBeTruthy();

    fireEvent.mouseDown(createOption);
    expect(handleChange).toHaveBeenCalledWith({
      companyId: null,
      companyName: 'Esselunga',
      isNew: true,
    });
  });

  it('allows unlinking / selecting independent option', () => {
    const handleChange = vi.fn();
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={1}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    const independentOption = screen.getByText(/No parent company \(Independent\)/i);
    fireEvent.mouseDown(independentOption);

    expect(handleChange).toHaveBeenCalledWith({
      companyId: null,
      companyName: '',
      isNew: false,
    });
  });

  it('supports keyboard navigation and selection with Enter', () => {
    const handleChange = vi.fn();
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={null}
        onChange={handleChange}
      />
    );

    const input = screen.getByRole('combobox');
    fireEvent.focus(input);

    // Option 0: Independent
    // Option 1: Conad
    // Option 2: Coop
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 0
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // 1 (Conad)
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(handleChange).toHaveBeenCalledWith({
      companyId: 1,
      companyName: 'Conad',
      isNew: false,
    });
  });

  it('clears selection via clear button', () => {
    const handleChange = vi.fn();
    render(
      <CompanyCombobox
        companies={mockCompanies}
        selectedCompanyId={1}
        onChange={handleChange}
      />
    );

    const clearBtn = screen.getByLabelText('Clear company selection');
    fireEvent.click(clearBtn);

    expect(handleChange).toHaveBeenCalledWith({
      companyId: null,
      companyName: '',
      isNew: false,
    });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.value).toBe('');
  });
});
