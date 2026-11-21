import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { FireflyExpenseAccount, Company } from '../types';
import { CompanyCombobox, CompanySelection } from '../components/common/CompanyCombobox';
import {
  Building2,
  Store,
  Search,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  Unlink,
  X,
  AlertCircle,
} from 'lucide-react';

export const StoresPage: React.FC = () => {
  const [accounts, setAccounts] = useState<FireflyExpenseAccount[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'chains' | 'independent'>('all');
  const [activeTab, setActiveTab] = useState<'directory' | 'companies'>('directory');
  const [page, setPage] = useState(1);
  const ITEMS_PER_PAGE = 48;

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // Company Link Modal
  const [assigningAccount, setAssigningAccount] = useState<FireflyExpenseAccount | null>(null);
  const [companySelection, setCompanySelection] = useState<CompanySelection | null>(null);
  const [savingLink, setSavingLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Manage Companies State
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [compFormName, setCompFormName] = useState('');
  const [compFormCategory, setCompFormCategory] = useState('');
  const [savingCompany, setSavingCompany] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [accs, comps] = await Promise.all([
        api.firefly.listExpenseAccounts(),
        api.companies.list(),
      ]);
      setAccounts(accs);
      setCompanies(comps);
    } catch (err) {
      console.error('Failed to load accounts and companies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAssignModal = (acc: FireflyExpenseAccount) => {
    setAssigningAccount(acc);
    setCompanySelection({
      companyId: acc.company_id ?? null,
      companyName: acc.company_name ?? '',
      isNew: false,
    });
    setLinkError(null);
  };

  const handleSaveCompanyAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assigningAccount) return;

    setSavingLink(true);
    setLinkError(null);
    try {
      let targetCompanyId = companySelection?.companyId ?? null;

      // If user typed a new company name to create
      if (companySelection?.isNew && companySelection.companyName.trim()) {
        const created = await api.companies.create({
          name: companySelection.companyName.trim(),
        });
        targetCompanyId = created.id;
      }

      await api.companies.assignAccountCompany(assigningAccount.id, {
        company_id: targetCompanyId,
      });

      setAssigningAccount(null);
      await loadData();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to assign company');
    } finally {
      setSavingLink(false);
    }
  };

  const handleUnlinkCompany = async (accountId: number) => {
    setSavingLink(true);
    setLinkError(null);
    try {
      await api.companies.assignAccountCompany(accountId, { company_id: null });
      setAssigningAccount(null);
      await loadData();
    } catch (err: any) {
      setLinkError(err.message || 'Failed to unlink company');
    } finally {
      setSavingLink(false);
    }
  };

  const openCompanyModal = (comp?: Company) => {
    if (comp) {
      setEditingCompany(comp);
      setCompFormName(comp.name);
      setCompFormCategory(comp.default_category || '');
    } else {
      setEditingCompany(null);
      setCompFormName('');
      setCompFormCategory('');
    }
    setCompanyError(null);
    setCompanyModalOpen(true);
  };

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compFormName.trim()) return;

    setSavingCompany(true);
    setCompanyError(null);
    try {
      if (editingCompany) {
        await api.companies.update(editingCompany.id, {
          name: compFormName.trim(),
          default_category: compFormCategory.trim() || undefined,
        });
      } else {
        await api.companies.create({
          name: compFormName.trim(),
          default_category: compFormCategory.trim() || undefined,
        });
      }
      setCompanyModalOpen(false);
      await loadData();
    } catch (err: any) {
      setCompanyError(err.message || 'Failed to save company');
    } finally {
      setSavingCompany(false);
    }
  };

  const handleDeleteCompany = async (comp: Company) => {
    if (
      !window.confirm(
        `Are you sure you want to delete "${comp.name}"? Stores linked to this company will become unlinked.`
      )
    ) {
      return;
    }

    try {
      await api.companies.delete(comp.id);
      await loadData();
    } catch (err: any) {
      alert(`Failed to delete company: ${err.message}`);
    }
  };

  const filteredAccounts = accounts.filter(a => {
    const query = search.toLowerCase();
    const matchesSearch =
      a.name.toLowerCase().includes(query) ||
      (a.company_name && a.company_name.toLowerCase().includes(query));
    if (!matchesSearch) return false;

    if (filter === 'chains') return Boolean(a.company_id);
    if (filter === 'independent') return !a.company_id;
    return true;
  });

  const totalPages = Math.ceil(filteredAccounts.length / ITEMS_PER_PAGE) || 1;
  const paginatedAccounts = useMemo(() => {
    const start = (page - 1) * ITEMS_PER_PAGE;
    return filteredAccounts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredAccounts, page]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-200 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Store Directory & Companies
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Browse all Firefly III expense accounts live. Link optional parent companies (e.g.,
            Conad, Lidl) to group branches for comparative price intelligence.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="inline-flex items-center px-3.5 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-xs transition"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Sync from Firefly
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex border-b border-slate-200 gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('directory')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'directory'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Store className="w-4 h-4" />
          Store Directory ({accounts.length})
        </button>

        <button
          onClick={() => setActiveTab('companies')}
          className={`pb-3 border-b-2 flex items-center gap-2 transition ${
            activeTab === 'companies'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Parent Companies ({companies.length})
        </button>
      </div>

      {activeTab === 'directory' ? (
        <>
          {/* Directory Filter Bar */}
          <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by store or company name..."
                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex bg-slate-100 p-1 rounded-lg text-xs font-semibold">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1.5 rounded-md transition ${
                  filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                All ({accounts.length})
              </button>
              <button
                onClick={() => setFilter('chains')}
                className={`px-3 py-1.5 rounded-md transition ${
                  filter === 'chains' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600'
                }`}
              >
                Chain Stores ({accounts.filter(a => a.company_id).length})
              </button>
              <button
                onClick={() => setFilter('independent')}
                className={`px-3 py-1.5 rounded-md transition ${
                  filter === 'independent' ? 'bg-white text-slate-800 shadow-xs' : 'text-slate-600'
                }`}
              >
                Independent ({accounts.filter(a => !a.company_id).length})
              </button>
            </div>
          </div>

          {/* Accounts Grid */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              <div className="col-span-full py-16 text-center text-slate-400 text-sm">
                Loading expense accounts from Firefly III...
              </div>
            ) : filteredAccounts.length === 0 ? (
              <div className="col-span-full py-16 text-center text-slate-400 text-sm">
                No stores match the current search or filter.
              </div>
            ) : (
              paginatedAccounts.map(acc => (
                <div
                  key={acc.id}
                  className="p-4 rounded-xl border bg-white border-slate-200 hover:border-slate-300 shadow-xs transition flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start space-x-2.5 min-w-0">
                        <div
                          className={`p-2 rounded-lg shrink-0 mt-0.5 ${
                            acc.company_id
                              ? 'bg-indigo-50 text-indigo-600'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          <Store className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-semibold text-sm text-slate-900 leading-snug truncate">
                            {acc.name}
                          </h3>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-slate-400 font-mono">#{acc.id}</span>
                            {!acc.active && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                                Inactive
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => openAssignModal(acc)}
                        className="text-xs px-2.5 py-1 rounded-md font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 shrink-0 transition"
                      >
                        {acc.company_id ? 'Edit Link' : 'Link Company'}
                      </button>
                    </div>

                    {acc.company_id && (
                      <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                        <div className="flex items-center gap-1.5 truncate">
                          <Building2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span className="truncate">
                            Company: <strong className="text-slate-800">{acc.company_name}</strong>
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 pt-4">
              <span className="text-xs text-slate-500">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filteredAccounts.length)} of {filteredAccounts.length} stores
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Previous
                </button>
                <span className="text-xs font-semibold text-slate-700 px-2">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        /* Companies Management Tab */
        <div className="mt-6 space-y-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Parent companies organize multiple physical stores into a single analytical group for
              product price tracking across branches.
            </p>
            <button
              onClick={() => openCompanyModal()}
              className="inline-flex items-center px-3.5 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Company
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companies.length === 0 ? (
              <div className="col-span-full py-12 text-center text-slate-400 text-sm">
                No companies created yet. Click "New Company" to create one.
              </div>
            ) : (
              companies.map(comp => (
                <div
                  key={comp.id}
                  className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs flex items-center justify-between"
                >
                  <div className="flex items-center space-x-3 truncate">
                    <div className="p-2.5 rounded-lg bg-indigo-50 text-indigo-600 shrink-0">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div className="truncate">
                      <h4 className="font-bold text-sm text-slate-900 truncate">{comp.name}</h4>
                      <p className="text-xs text-slate-500">
                        {comp.store_count ?? 0} {(comp.store_count === 1 ? 'store' : 'stores')} linked
                        {comp.default_category ? ` • ${comp.default_category}` : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-1 shrink-0 ml-2">
                    <button
                      onClick={() => openCompanyModal(comp)}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition"
                      aria-label="Edit company"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCompany(comp)}
                      className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                      aria-label="Delete company"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Assign Company Modal */}
      {assigningAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Link Store to Company</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Store: <strong className="text-slate-800">{assigningAccount.name}</strong>
                </p>
              </div>
              <button
                onClick={() => setAssigningAccount(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCompanyAssignment} className="mt-5 space-y-4">
              {linkError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{linkError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Parent Company
                </label>
                <CompanyCombobox
                  companies={companies}
                  selectedCompanyId={companySelection?.companyId ?? null}
                  initialNewName={companySelection?.isNew ? companySelection.companyName : ''}
                  onChange={(sel) => setCompanySelection(sel)}
                  placeholder="Search or create parent company (e.g. Conad, Lidl)..."
                />
                <p className="mt-1.5 text-[11px] text-slate-400">
                  Select an existing chain, choose Independent to unlink, or type a new name to create it.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                {assigningAccount.company_id ? (
                  <button
                    type="button"
                    onClick={() => handleUnlinkCompany(assigningAccount.id)}
                    disabled={savingLink}
                    className="inline-flex items-center text-xs font-medium text-red-600 hover:text-red-700 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition"
                  >
                    <Unlink className="w-3.5 h-3.5 mr-1" />
                    Unlink
                  </button>
                ) : <span />}

                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setAssigningAccount(null)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingLink}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                  >
                    {savingLink ? 'Saving...' : 'Save Link'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Company Modal */}
      {companyModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-100">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-bold text-slate-900">
                {editingCompany ? 'Edit Company' : 'New Parent Company'}
              </h2>
              <button
                onClick={() => setCompanyModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {companyError && (
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{companyError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCompany} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Company Name *</label>
                <input
                  type="text"
                  required
                  value={compFormName}
                  onChange={(e) => setCompFormName(e.target.value)}
                  placeholder="e.g. Conad, Carrefour, Lidl"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Default Category (Optional)
                </label>
                <input
                  type="text"
                  value={compFormCategory}
                  onChange={(e) => setCompFormCategory(e.target.value)}
                  placeholder="e.g. Supermarket, Pharmacy, Electronics"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-3 flex justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setCompanyModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCompany}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
                >
                  {savingCompany ? 'Saving...' : editingCompany ? 'Update Company' : 'Create Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
