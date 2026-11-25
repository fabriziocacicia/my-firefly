import React, { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List, Search } from 'lucide-react';
import { FireflyExpenseAccount } from '../../types';
import { AccountsGridView } from './AccountsGridView';
import { AccountsTableView } from './AccountsTableView';
import { AccountFilter, normalizeRole } from './roleUtils';

const ITEMS_PER_PAGE = 48;
const VIEW_MODE_STORAGE_KEY = 'my-firefly:accounts-view-mode';

const FILTER_OPTIONS: Array<{
  key: AccountFilter;
  label: string;
  activeTextClass: string;
}> = [
  { key: 'all', label: 'All', activeTextClass: 'text-slate-900' },
  { key: 'chains', label: 'Chains', activeTextClass: 'text-indigo-700' },
  { key: 'local_business', label: 'Local Businesses', activeTextClass: 'text-emerald-700' },
  { key: 'ecommerce', label: 'E-Commerce', activeTextClass: 'text-sky-700' },
  { key: 'service', label: 'Services', activeTextClass: 'text-purple-700' },
  { key: 'person', label: 'Persons', activeTextClass: 'text-slate-800' },
  { key: 'unclassified', label: 'Unclassified', activeTextClass: 'text-amber-800' },
];

interface ExpenseAccountsTabProps {
  accounts: FireflyExpenseAccount[];
  loading: boolean;
  search: string;
  filter: AccountFilter;
  onSearchChange: (search: string) => void;
  onFilterChange: (filter: AccountFilter) => void;
  onEditAccount: (account: FireflyExpenseAccount) => void;
}

export const ExpenseAccountsTab: React.FC<ExpenseAccountsTabProps> = ({
  accounts,
  loading,
  search,
  filter,
  onSearchChange,
  onFilterChange,
  onEditAccount,
}) => {
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>(() => {
    try {
      return localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'table' ? 'table' : 'grid';
    } catch {
      return 'grid';
    }
  });

  const handleSetViewMode = (mode: 'grid' | 'table') => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  const counts = useMemo(() => {
    const result: Record<AccountFilter, number> = {
      all: accounts.length,
      chains: 0,
      local_business: 0,
      ecommerce: 0,
      service: 0,
      person: 0,
      unclassified: 0,
    };

    for (const a of accounts) {
      const effectiveRole = normalizeRole(a.role, a.company_id);
      if (effectiveRole === 'chain') result.chains++;
      else result[effectiveRole]++;
    }

    return result;
  }, [accounts]);

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return accounts.filter((a) => {
      const matchesSearch =
        !query ||
        a.name.toLowerCase().includes(query) ||
        (a.company_name && a.company_name.toLowerCase().includes(query)) ||
        (a.category && a.category.toLowerCase().includes(query)) ||
        (a.effective_business_types &&
          a.effective_business_types.some((t) => t.toLowerCase().includes(query))) ||
        (a.business_types && a.business_types.some((t) => t.toLowerCase().includes(query)));

      if (!matchesSearch) return false;
      if (filter === 'all') return true;

      const effectiveRole = normalizeRole(a.role, a.company_id);
      if (filter === 'chains') return effectiveRole === 'chain';
      return effectiveRole === filter;
    });
  }, [accounts, search, filter]);

  const totalPages = Math.ceil(filteredAccounts.length / ITEMS_PER_PAGE) || 1;
  const currentPage = Math.min(page, totalPages);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const paginatedAccounts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredAccounts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAccounts, currentPage]);

  return (
    <>
      {/* Controls & Filter Bar */}
      <div className="mt-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search by name, chain, business type, or category..."
            className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Filter Chips */}
          <div className="flex flex-wrap bg-slate-100 p-1 rounded-lg text-xs font-semibold gap-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => onFilterChange(opt.key)}
                className={`px-2.5 py-1.5 rounded-md transition ${
                  filter === opt.key
                    ? `bg-white ${opt.activeTextClass} shadow-xs`
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label} ({counts[opt.key]})
              </button>
            ))}
          </div>

          {/* Grid / Table View Switcher */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-slate-500">
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              className={`p-1.5 rounded-md transition ${
                viewMode === 'grid' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
              }`}
              title="Grid View (Cards)"
              aria-label="Grid View (Cards)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('table')}
              className={`p-1.5 rounded-md transition ${
                viewMode === 'table' ? 'bg-white text-indigo-600 shadow-xs' : 'hover:text-slate-900'
              }`}
              title="Table View (Dense)"
              aria-label="Table View (Dense)"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-slate-400 text-sm">
          Loading expense accounts from Firefly III...
        </div>
      ) : filteredAccounts.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm bg-white border border-slate-200 rounded-xl mt-6">
          No accounts match the current search or filter.
        </div>
      ) : viewMode === 'grid' ? (
        <AccountsGridView accounts={paginatedAccounts} onEditAccount={onEditAccount} />
      ) : (
        <AccountsTableView
          accounts={paginatedAccounts}
          filter={filter}
          onEditAccount={onEditAccount}
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-4">
          <span className="text-xs text-slate-500">
            Showing{' '}
            <strong className="text-slate-800">{(currentPage - 1) * ITEMS_PER_PAGE + 1}</strong> to{' '}
            <strong className="text-slate-800">
              {Math.min(currentPage * ITEMS_PER_PAGE, filteredAccounts.length)}
            </strong>{' '}
            of <strong className="text-slate-800">{filteredAccounts.length}</strong> accounts
          </span>

          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1.5 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
};
